import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import {
  SafeAreaProvider,
  SafeAreaView,
  initialWindowMetrics,
} from 'react-native-safe-area-context';
import {
  FINNHUB_TOKEN_KEY,
  MARKET_REFRESH_MS,
  fetchPortfolioQuotes,
  openFinnhubTrades,
  quoteStatusText,
} from './src/market-data';
import {
  configureNotificationsAsync,
  evaluateAlerts,
  getRule,
  normalizeAlerts,
  presentAlertEvents,
  sendTestNotificationAsync,
  upsertRule,
} from './src/alert-engine';
import {
  BACKGROUND_ALERT_TASK,
  STORAGE_KEY,
  syncBackgroundAlertTask,
} from './src/background-alert-task';
import { exportBackupAsync, pickBackupAsync } from './src/backup';

const VERSION = '0.4.0';
const EMPTY_STATE = {
  schemaVersion: 4,
  transactions: [],
  prices: {},
  meta: { lastCheckedAt: null, errors: [] },
  alerts: normalizeAlerts(null),
};

const valid = (value) => value !== null
  && value !== undefined
  && Number.isFinite(Number(value));
const positive = (value) => valid(value) && Number(value) > 0;

const cash = (value, currency = 'EUR') => valid(value)
  ? new Intl.NumberFormat('el-GR', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number(value))
  : '—';

const quotePrice = (value, currency = 'EUR') => valid(value)
  ? new Intl.NumberFormat('el-GR', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 3,
    }).format(Number(value))
  : '—';

const pct = (value) => valid(value)
  ? `${Number(value) > 0 ? '+' : ''}${Number(value).toFixed(2)}%`
  : '—';

const when = (value) => value ? new Date(value).toLocaleString('el-GR') : '—';

const parseNum = (value) => {
  const raw = String(value ?? '').trim();
  if (!raw) return 0;
  const normalized = raw.includes(',')
    ? raw.replace(/\./g, '').replace(',', '.')
    : raw;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : 0;
};

const optionalNumber = (value) => {
  const number = parseNum(value);
  return number > 0 ? number : null;
};

function normalizeState(raw) {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_STATE };
  return {
    schemaVersion: 4,
    transactions: Array.isArray(raw.transactions) ? raw.transactions : [],
    prices: raw.prices && typeof raw.prices === 'object' ? raw.prices : {},
    meta: {
      lastCheckedAt: raw.meta?.lastCheckedAt || null,
      errors: Array.isArray(raw.meta?.errors) ? raw.meta.errors : [],
    },
    alerts: normalizeAlerts(raw.alerts),
  };
}

function positionsFrom(state) {
  const ledger = {};
  [...state.transactions]
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .forEach((transaction) => {
      if (!['buy', 'sell'].includes(transaction.type)) return;
      const symbol = String(transaction.symbol || '').trim().toUpperCase();
      const quantity = Number(transaction.quantity || 0);
      if (!symbol || quantity <= 0) return;

      const position = ledger[symbol] || {
        symbol,
        company: transaction.company || symbol,
        currency: transaction.currency || (symbol.endsWith('.US') ? 'USD' : 'EUR'),
        quantity: 0,
        cost: 0,
      };
      const total = valid(transaction.total)
        ? Number(transaction.total)
        : quantity * Number(transaction.price || 0) + Number(transaction.fees || 0);

      if (transaction.type === 'buy') {
        position.quantity += quantity;
        position.cost += total;
      } else if (position.quantity > 0) {
        const sold = Math.min(quantity, position.quantity);
        position.cost -= (position.cost / position.quantity) * sold;
        position.quantity -= sold;
      }
      ledger[symbol] = position;
    });

  return Object.values(ledger)
    .filter((position) => position.quantity > 0)
    .map((position) => {
      const quote = state.prices[position.symbol];
      const usable = quote?.usable === true;
      const nativePrice = usable ? Number(quote.nativePrice) : null;
      const eurPrice = usable ? Number(quote.price) : null;
      const fxRate = position.currency === 'USD' ? Number(quote?.fxRate || 0) : 1;
      const nativeValue = nativePrice === null ? null : nativePrice * position.quantity;
      const eurValue = eurPrice === null ? null : eurPrice * position.quantity;
      const nativePnl = nativeValue === null ? null : nativeValue - position.cost;
      const eurCost = position.currency === 'USD' && fxRate > 0
        ? position.cost / fxRate
        : position.cost;
      return {
        ...position,
        quote,
        nativePrice,
        eurPrice,
        nativeValue,
        eurValue,
        nativePnl,
        nativePct: nativePnl === null ? null : (nativePnl / position.cost) * 100,
        eurCost,
        eurPnl: eurValue === null ? null : eurValue - eurCost,
        average: position.quantity > 0 ? position.cost / position.quantity : 0,
      };
    });
}

function Badge({ quote }) {
  const text = quoteStatusText(quote);
  const bad = quote?.status === 'stale';
  return (
    <View style={[styles.badge, bad && styles.badgeBad]}>
      <Text style={[styles.badgeText, bad && styles.badgeBadText]}>{text}</Text>
    </View>
  );
}

function Metric({ label, value, negative, compact }) {
  return (
    <View style={[styles.metric, compact && styles.metricCompact]}>
      <Text style={styles.muted}>{label}</Text>
      <Text
        style={[styles.metricValue, negative && styles.red]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.66}
      >
        {value}
      </Text>
    </View>
  );
}

function Position({ item, compact }) {
  const stale = item.quote && !item.quote.usable;
  const changeNegative = Number(item.quote?.changePct) < 0;
  return (
    <View style={styles.card}>
      <View style={styles.rowTop}>
        <View style={styles.grow}>
          <Text style={styles.cardTitle}>{item.company}</Text>
          <Text style={styles.muted}>
            {item.symbol} · {item.quantity.toLocaleString('el-GR')} μετοχές
          </Text>
        </View>
        <Badge quote={item.quote} />
      </View>

      <View style={styles.priceRow}>
        <View style={styles.grow}>
          <Text style={styles.muted}>Τρέχουσα τιμή</Text>
          <Text style={styles.big} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.66}>
            {stale ? '—' : quotePrice(item.nativePrice, item.currency)}
          </Text>
          {item.currency === 'USD' && !stale ? (
            <Text style={styles.muted}>≈ {quotePrice(item.eurPrice, 'EUR')}</Text>
          ) : null}
        </View>
        <Text style={[styles.change, changeNegative ? styles.red : styles.green]}>
          {stale ? '—' : pct(item.quote?.changePct)}
        </Text>
      </View>

      <View style={styles.grid}>
        <Metric compact={compact} label="Αξία θέσης" value={cash(item.nativeValue, item.currency)} />
        <Metric compact={compact} label="Συνολικό κόστος" value={cash(item.cost, item.currency)} />
        <Metric compact={compact} label="Κέρδος / Ζημία" value={cash(item.nativePnl, item.currency)} negative={Number(item.nativePnl) < 0} />
        <Metric compact={compact} label="Μέση τιμή" value={quotePrice(item.average, item.currency)} />
      </View>

      {item.currency === 'USD' && item.eurValue !== null ? (
        <Text style={styles.note}>
          Σε ευρώ: αξία ≈ {cash(item.eurValue)} · αποτέλεσμα ≈ {cash(item.eurPnl)}
        </Text>
      ) : null}
      <Text style={styles.source}>
        Πηγή: {item.quote?.source || '—'}
        {item.quote?.updatedAt
          ? `\nΤιμή: ${when(item.quote.updatedAt)} · Έλεγχος: ${when(item.quote.checkedAt)}`
          : ''}
      </Text>
      {stale ? <Text style={styles.warning}>Η τιμή είναι παρωχημένη και δεν υπολογίζεται.</Text> : null}
    </View>
  );
}

function Field({ label, value, onChangeText, keyboardType = 'default', autoCapitalize = 'sentences', placeholder }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        placeholder={placeholder}
        placeholderTextColor="#97a2b3"
      />
    </View>
  );
}

function TransactionModal({ visible, onClose, onSave }) {
  const initial = () => ({
    type: 'buy', symbol: '', company: '', date: new Date().toISOString().slice(0, 10),
    quantity: '', price: '', fees: '0', currency: 'EUR', broker: '',
  });
  const [form, setForm] = useState(initial);
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const close = () => { setForm(initial()); onClose(); };
  const save = () => {
    const quantity = parseNum(form.quantity);
    const priceValue = parseNum(form.price);
    const fees = parseNum(form.fees);
    const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(form.date);
    if (!form.symbol.trim() || quantity <= 0 || priceValue <= 0 || !dateOk) {
      Alert.alert('Λείπουν στοιχεία', 'Συμπλήρωσε σωστά σύμβολο, ημερομηνία, ποσότητα και τιμή.');
      return;
    }
    const gross = quantity * priceValue;
    onSave({
      id: `tx-${Date.now()}`,
      type: form.type,
      symbol: form.symbol.trim().toUpperCase(),
      company: form.company.trim() || form.symbol.trim().toUpperCase(),
      date: form.date,
      quantity,
      currency: form.currency,
      price: priceValue,
      fees,
      total: form.type === 'buy' ? gross + fees : Math.max(0, gross - fees),
      broker: form.broker.trim(),
    });
    close();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <View style={styles.overlay}>
        <KeyboardAvoidingView style={styles.keyboardLayer} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <SafeAreaView style={styles.sheet} edges={['bottom', 'left', 'right']}>
            <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <View style={styles.rowTop}>
                <Text style={styles.section}>Νέα συναλλαγή</Text>
                <Pressable onPress={close} hitSlop={12}><Text style={styles.link}>Κλείσιμο</Text></Pressable>
              </View>
              <View style={styles.segmentRow}>
                {[['buy', 'Αγορά'], ['sell', 'Πώληση']].map(([key, label]) => (
                  <Pressable key={key} style={[styles.segment, form.type === key && styles.segmentOn]} onPress={() => set('type', key)}>
                    <Text style={[styles.segmentText, form.type === key && styles.white]}>{label}</Text>
                  </Pressable>
                ))}
              </View>
              <Field label="Σύμβολο" placeholder="π.χ. SPCE.US" value={form.symbol} onChangeText={(value) => set('symbol', value)} autoCapitalize="characters" />
              <Field label="Εταιρεία" value={form.company} onChangeText={(value) => set('company', value)} />
              <Field label="Ημερομηνία (YYYY-MM-DD)" value={form.date} onChangeText={(value) => set('date', value)} autoCapitalize="none" />
              <Field label="Μετοχές" value={form.quantity} onChangeText={(value) => set('quantity', value)} keyboardType="decimal-pad" />
              <Field label="Τιμή ανά μετοχή" value={form.price} onChangeText={(value) => set('price', value)} keyboardType="decimal-pad" />
              <Field label="Προμήθεια / έξοδα" value={form.fees} onChangeText={(value) => set('fees', value)} keyboardType="decimal-pad" />
              <Field label="Broker / τράπεζα" value={form.broker} onChangeText={(value) => set('broker', value)} />
              <View style={styles.segmentRow}>
                {['EUR', 'USD'].map((currency) => (
                  <Pressable key={currency} onPress={() => set('currency', currency)} style={[styles.segment, form.currency === currency && styles.segmentOn]}>
                    <Text style={[styles.segmentText, form.currency === currency && styles.white]}>{currency}</Text>
                  </Pressable>
                ))}
              </View>
              <Pressable style={styles.primary} onPress={save}><Text style={styles.whiteStrong}>Αποθήκευση</Text></Pressable>
            </ScrollView>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

function AlertRuleModal({ visible, position, rule, onClose, onSave }) {
  const [form, setForm] = useState({ enabled: true, above: '', below: '', dailyPct: '5' });
  useEffect(() => {
    if (!visible || !position) return;
    setForm({
      enabled: rule?.enabled !== false,
      above: positive(rule?.above) ? String(rule.above) : '',
      below: positive(rule?.below) ? String(rule.below) : '',
      dailyPct: positive(rule?.dailyPct) ? String(rule.dailyPct) : '',
    });
  }, [visible, position, rule]);
  if (!position) return null;

  const save = () => {
    const next = {
      symbol: position.symbol,
      enabled: form.enabled,
      above: optionalNumber(form.above),
      below: optionalNumber(form.below),
      dailyPct: optionalNumber(form.dailyPct),
    };
    if (next.enabled && !next.above && !next.below && !next.dailyPct) {
      Alert.alert('Χωρίς όριο', 'Βάλε τουλάχιστον ένα όριο ή απενεργοποίησε τον κανόνα.');
      return;
    }
    onSave(next);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <KeyboardAvoidingView style={styles.keyboardLayer} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <SafeAreaView style={styles.sheet} edges={['bottom', 'left', 'right']}>
            <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
              <View style={styles.rowTop}>
                <View style={styles.grow}>
                  <Text style={styles.section}>Όρια {position.symbol}</Text>
                  <Text style={styles.muted}>Τρέχουσα τιμή: {quotePrice(position.nativePrice, position.currency)}</Text>
                </View>
                <Pressable onPress={onClose}><Text style={styles.link}>Κλείσιμο</Text></Pressable>
              </View>
              <Pressable style={[styles.toggleButton, form.enabled && styles.toggleButtonOn]} onPress={() => setForm((x) => ({ ...x, enabled: !x.enabled }))}>
                <Text style={[styles.toggleText, form.enabled && styles.whiteStrong]}>{form.enabled ? 'Κανόνας ενεργός' : 'Κανόνας ανενεργός'}</Text>
              </Pressable>
              <Field label={`Ειδοποίηση πάνω από (${position.currency})`} value={form.above} onChangeText={(value) => setForm((x) => ({ ...x, above: value }))} keyboardType="decimal-pad" placeholder="π.χ. 3,20" />
              <Field label={`Ειδοποίηση κάτω από (${position.currency})`} value={form.below} onChangeText={(value) => setForm((x) => ({ ...x, below: value }))} keyboardType="decimal-pad" placeholder="π.χ. 2,40" />
              <Field label="Ημερήσια μεταβολή ±%" value={form.dailyPct} onChangeText={(value) => setForm((x) => ({ ...x, dailyPct: value }))} keyboardType="decimal-pad" placeholder="π.χ. 5" />
              <Text style={styles.note}>Η ειδοποίηση τιμής ενεργοποιείται όταν το όριο διασχιστεί. Η ημερήσια μεταβολή ειδοποιεί μία φορά ανά ημέρα.</Text>
              <Pressable style={styles.primary} onPress={save}><Text style={styles.whiteStrong}>Αποθήκευση ορίων</Text></Pressable>
            </ScrollView>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

function MainApp() {
  const { width } = useWindowDimensions();
  const compactMetrics = width < 360;
  const [state, setState] = useState(EMPTY_STATE);
  const stateRef = useRef(EMPTY_STATE);
  const [tab, setTab] = useState('summary');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [transactionModal, setTransactionModal] = useState(false);
  const [alertPosition, setAlertPosition] = useState(null);
  const [token, setToken] = useState('');
  const [notificationStatus, setNotificationStatus] = useState('unknown');
  const [backgroundRegistered, setBackgroundRegistered] = useState(false);
  const tokenRef = useRef('');
  const appState = useRef(AppState.currentState);

  const persist = useCallback(async (next) => {
    const normalized = normalizeState(next);
    stateRef.current = normalized;
    setState(normalized);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [saved, secret, permission] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEY),
          SecureStore.getItemAsync(FINNHUB_TOKEN_KEY),
          configureNotificationsAsync({ request: false }),
        ]);
        const next = normalizeState(saved ? JSON.parse(saved) : null);
        stateRef.current = next;
        setState(next);
        tokenRef.current = secret || '';
        setToken(secret || '');
        setNotificationStatus(permission);
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        const registered = await syncBackgroundAlertTask(next.alerts.backgroundEnabled);
        setBackgroundRegistered(registered);
      } catch (error) {
        Alert.alert('Εκκίνηση', `Δεν φορτώθηκαν σωστά τα τοπικά δεδομένα.\n${error.message}`);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const applyQuotes = useCallback(async (current, quotes, checkedAt, errors, { silent = false, background = false } = {}) => {
    const prices = { ...current.prices, ...quotes };
    const evaluated = evaluateAlerts(current.alerts, prices, { background });
    const next = {
      ...current,
      prices,
      alerts: evaluated.alerts,
      meta: { lastCheckedAt: checkedAt, errors },
    };
    await persist(next);
    await presentAlertEvents(evaluated.events);
    if (!silent && errors.length) Alert.alert('Μερική ενημέρωση', errors.join('\n'));
    return next;
  }, [persist]);

  const refresh = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setRefreshing(true);
    try {
      const current = stateRef.current;
      const symbols = [...new Set(current.transactions.map((transaction) => String(transaction.symbol || '').trim().toUpperCase()).filter(Boolean))];
      if (!symbols.length) {
        await persist({ ...current, meta: { lastCheckedAt: new Date().toISOString(), errors: [] } });
        return;
      }
      const result = await fetchPortfolioQuotes(symbols, { finnhubToken: tokenRef.current });
      await applyQuotes(current, result.quotes, result.checkedAt, result.errors, { silent });
    } catch (error) {
      if (!silent) Alert.alert('Ανανέωση', error.message);
    } finally {
      if (!silent) setRefreshing(false);
    }
  }, [applyQuotes, persist]);

  useEffect(() => {
    if (loading) return undefined;
    refresh({ silent: true });
    const interval = setInterval(() => refresh({ silent: true }), MARKET_REFRESH_MS);
    const subscription = AppState.addEventListener('change', async (nextState) => {
      if (appState.current.match(/inactive|background/) && nextState === 'active') {
        const saved = await AsyncStorage.getItem(STORAGE_KEY);
        if (saved) {
          const restored = normalizeState(JSON.parse(saved));
          stateRef.current = restored;
          setState(restored);
        }
        refresh({ silent: true });
      }
      appState.current = nextState;
    });
    return () => { clearInterval(interval); subscription.remove(); };
  }, [loading, refresh]);

  useEffect(() => {
    if (loading || token.trim().length < 20) return undefined;
    return openFinnhubTrades(token.trim(), ['SPCE'], async (trade) => {
      const current = stateRef.current;
      const old = current.prices['SPCE.US'];
      const fxRate = Number(old?.fxRate || 0);
      if (!fxRate) return;
      const previousClose = Number(old?.nativePreviousClose || 0);
      const quote = {
        ...old,
        nativePrice: trade.price,
        price: trade.price / fxRate,
        updatedAt: new Date(trade.timestamp).toISOString(),
        checkedAt: new Date().toISOString(),
        source: 'Finnhub WebSocket real-time trade',
        quality: 'realtime',
        status: 'live',
        usable: true,
        ageSeconds: 0,
        changePct: previousClose > 0 ? ((trade.price - previousClose) / previousClose) * 100 : old?.changePct,
      };
      await applyQuotes(current, { 'SPCE.US': quote }, new Date().toISOString(), current.meta.errors || [], { silent: true });
    });
  }, [applyQuotes, loading, token]);

  const positions = useMemo(() => positionsFrom(state), [state]);
  const valuesReady = positions.every((position) => position.eurValue !== null);
  const costsReady = positions.every((position) => valid(position.eurCost));
  const totalValue = positions.length === 0 ? 0 : valuesReady ? positions.reduce((sum, position) => sum + position.eurValue, 0) : null;
  const totalCost = positions.length === 0 ? 0 : costsReady ? positions.reduce((sum, position) => sum + position.eurCost, 0) : null;
  const totalPnl = totalValue !== null && totalCost !== null ? totalValue - totalCost : null;

  const saveToken = async () => {
    const clean = token.trim();
    if (clean) await SecureStore.setItemAsync(FINNHUB_TOKEN_KEY, clean);
    else await SecureStore.deleteItemAsync(FINNHUB_TOKEN_KEY);
    tokenRef.current = clean;
    Alert.alert('Αποθηκεύτηκε', 'Το Finnhub token παραμένει κρυπτογραφημένο μόνο σε αυτή τη συσκευή.');
    refresh();
  };

  const addTransaction = async (transaction) => {
    if (transaction.type === 'sell') {
      const currentPosition = positions.find((position) => position.symbol === transaction.symbol);
      if (!currentPosition || transaction.quantity > currentPosition.quantity) {
        Alert.alert('Μη έγκυρη πώληση', `Διαθέσιμες μετοχές ${transaction.symbol}: ${currentPosition?.quantity || 0}.`);
        return;
      }
    }
    await persist({ ...stateRef.current, transactions: [...stateRef.current.transactions, transaction] });
    refresh({ silent: true });
  };

  const deleteTransaction = (transaction) => {
    Alert.alert('Διαγραφή συναλλαγής', `Να διαγραφεί η συναλλαγή ${transaction.company};`, [
      { text: 'Άκυρο', style: 'cancel' },
      { text: 'Διαγραφή', style: 'destructive', onPress: async () => {
        await persist({
          ...stateRef.current,
          transactions: stateRef.current.transactions.filter((item) => item.id !== transaction.id),
        });
        refresh({ silent: true });
      } },
    ]);
  };

  const saveAlertRule = async (rule) => {
    const alerts = upsertRule(stateRef.current.alerts, rule);
    await persist({ ...stateRef.current, alerts });
    const status = await configureNotificationsAsync({ request: true });
    setNotificationStatus(status);
    if (status !== 'granted') {
      Alert.alert('Χωρίς άδεια', 'Ο κανόνας αποθηκεύτηκε, αλλά το Android δεν θα εμφανίζει ειδοποιήσεις μέχρι να δοθεί άδεια.');
    }
    refresh({ silent: true });
  };

  const requestNotificationPermission = async () => {
    const status = await configureNotificationsAsync({ request: true });
    setNotificationStatus(status);
    Alert.alert(status === 'granted' ? 'Ενεργές ειδοποιήσεις' : 'Η άδεια δεν δόθηκε', status === 'granted'
      ? 'Η συσκευή μπορεί να εμφανίζει ειδοποιήσεις τιμών.'
      : 'Άνοιξε τις ρυθμίσεις Android της εφαρμογής για να επιτρέψεις ειδοποιήσεις.');
  };

  const toggleBackground = async () => {
    const enable = !stateRef.current.alerts.backgroundEnabled;
    if (enable) {
      const status = await configureNotificationsAsync({ request: true });
      setNotificationStatus(status);
      if (status !== 'granted') {
        Alert.alert('Απαιτείται άδεια', 'Δεν ενεργοποιήθηκε ο έλεγχος παρασκηνίου.');
        return;
      }
    }
    const alerts = { ...stateRef.current.alerts, backgroundEnabled: enable };
    await persist({ ...stateRef.current, alerts });
    try {
      const registered = await syncBackgroundAlertTask(enable);
      setBackgroundRegistered(registered);
      Alert.alert(enable ? 'Έλεγχος παρασκηνίου ενεργός' : 'Έλεγχος παρασκηνίου ανενεργός', enable
        ? 'Το Android θα ελέγχει περίπου ανά 15 λεπτά ή αργότερα, ανάλογα με μπαταρία και περιορισμούς συσκευής.'
        : 'Δεν θα γίνονται έλεγχοι όταν η εφαρμογή δεν είναι ενεργή.');
    } catch (error) {
      await persist({ ...stateRef.current, alerts: { ...alerts, backgroundEnabled: false } });
      setBackgroundRegistered(false);
      Alert.alert('Αποτυχία παρασκηνίου', error.message);
    }
  };

  const testNotification = async () => {
    const ok = await sendTestNotificationAsync();
    setNotificationStatus(ok ? 'granted' : 'denied');
    if (!ok) Alert.alert('Αποτυχία', 'Δεν υπάρχει άδεια ειδοποιήσεων.');
  };

  const clearAlertHistory = async () => {
    await persist({ ...stateRef.current, alerts: { ...stateRef.current.alerts, history: [] } });
  };

  const exportBackup = async () => {
    try {
      await exportBackupAsync(stateRef.current, VERSION);
    } catch (error) {
      Alert.alert('Αντίγραφο ασφαλείας', error.message);
    }
  };

  const importBackup = async () => {
    try {
      const payload = await pickBackupAsync();
      if (!payload) return;
      Alert.alert(
        'Επαναφορά αντιγράφου',
        `Θα αντικατασταθούν οι ${stateRef.current.transactions.length} τωρινές συναλλαγές με ${payload.data.transactions.length} συναλλαγές του αντιγράφου. Το Finnhub token δεν αλλάζει.`,
        [
          { text: 'Άκυρο', style: 'cancel' },
          { text: 'Επαναφορά', onPress: async () => {
            const restoredAlerts = normalizeAlerts({
              ...payload.data.alerts,
              backgroundEnabled: false,
              runtime: {},
            });
            const next = normalizeState({
              transactions: payload.data.transactions,
              prices: {},
              meta: { lastCheckedAt: null, errors: [] },
              alerts: restoredAlerts,
            });
            await syncBackgroundAlertTask(false);
            setBackgroundRegistered(false);
            await persist(next);
            setTab('summary');
            refresh({ silent: true });
          } },
        ],
      );
    } catch (error) {
      Alert.alert('Μη έγκυρο αντίγραφο', error.message);
    }
  };

  const resetLocalData = () => {
    Alert.alert('Διαγραφή όλων των τοπικών δεδομένων', 'Η ενέργεια δεν αναιρείται. Πάρε πρώτα αντίγραφο ασφαλείας.', [
      { text: 'Άκυρο', style: 'cancel' },
      { text: 'Οριστική διαγραφή', style: 'destructive', onPress: async () => {
        await syncBackgroundAlertTask(false).catch(() => {});
        await Promise.all([
          AsyncStorage.removeItem(STORAGE_KEY),
          SecureStore.deleteItemAsync(FINNHUB_TOKEN_KEY),
        ]);
        tokenRef.current = '';
        setToken('');
        setBackgroundRegistered(false);
        await persist(EMPTY_STATE);
      } },
    ]);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.center} edges={['top', 'bottom', 'left', 'right']}>
        <ActivityIndicator size="large" />
        <Text>Φόρτωση…</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" backgroundColor="#eef5ff" />
      <View style={styles.app}>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Text style={styles.eyebrow}>ΠΡΟΣΩΠΙΚΟ ΧΑΡΤΟΦΥΛΑΚΙΟ</Text>
          <View style={styles.rowTop}>
            <Text style={[styles.title, width < 380 && styles.titleCompact]}>Investor Control</Text>
            <Pressable style={styles.plus} onPress={() => setTransactionModal(true)}><Text style={styles.plusText}>＋</Text></Pressable>
          </View>

          {tab === 'summary' ? (
            <>
              <View style={styles.refreshCard}>
                <View style={styles.grow}><Text style={styles.muted}>Τελευταίος έλεγχος</Text><Text style={styles.checked}>{when(state.meta.lastCheckedAt)}</Text></View>
                <Pressable style={[styles.primarySmall, refreshing && styles.disabled]} onPress={() => refresh()} disabled={refreshing}>
                  {refreshing ? <ActivityIndicator color="#fff" /> : <Text style={styles.whiteStrong}>Ανανέωση</Text>}
                </Pressable>
              </View>
              {state.meta.errors?.length ? <Text style={styles.warning}>{state.meta.errors.join('\n')}</Text> : null}
              <View style={styles.grid}>
                <Metric compact={compactMetrics} label="Αξία χαρτοφυλακίου" value={cash(totalValue)} />
                <Metric compact={compactMetrics} label="Καθαρό κόστος" value={cash(totalCost)} />
                <Metric compact={compactMetrics} label="Κέρδος / Ζημία" value={cash(totalPnl)} negative={Number(totalPnl) < 0} />
                <Metric compact={compactMetrics} label="Θέσεις" value={String(positions.length)} />
              </View>
              {!valuesReady ? <Text style={styles.warning}>Η συνολική αποτίμηση μένει κενή όταν κάποια τιμή είναι παρωχημένη ή μη διαθέσιμη.</Text> : null}
              <View style={styles.sectionRow}>
                <View><Text style={styles.section}>Θέσεις</Text><Text style={styles.muted}>{positions.length} ενεργές θέσεις</Text></View>
                <Pressable style={styles.secondarySmall} onPress={() => setTransactionModal(true)}><Text style={styles.secondaryStrong}>Νέα συναλλαγή</Text></Pressable>
              </View>
              {positions.length ? positions.map((position) => <Position key={position.symbol} item={position} compact={compactMetrics} />) : (
                <View style={styles.emptyCard}><Text style={styles.emptyTitle}>Δεν υπάρχουν θέσεις.</Text><Text style={styles.note}>Καταχώρισε την πρώτη σου αγορά. Τα στοιχεία αποθηκεύονται μόνο σε αυτή τη συσκευή.</Text></View>
              )}
            </>
          ) : null}

          {tab === 'transactions' ? (
            <>
              <View style={styles.sectionRow}>
                <View><Text style={styles.section}>Συναλλαγές</Text><Text style={styles.muted}>Αγορές και πωλήσεις</Text></View>
                <Pressable style={styles.primarySmall} onPress={() => setTransactionModal(true)}><Text style={styles.whiteStrong}>Προσθήκη</Text></Pressable>
              </View>
              {state.transactions.length ? [...state.transactions].sort((a, b) => String(b.date).localeCompare(String(a.date))).map((transaction) => (
                <View key={transaction.id} style={styles.card}>
                  <View style={styles.rowTop}>
                    <View style={styles.grow}>
                      <Text style={styles.txTitle}>{transaction.type === 'sell' ? 'Πώληση' : 'Αγορά'} · {transaction.company}</Text>
                      <Text style={styles.muted}>{transaction.symbol} · {transaction.date}</Text>
                    </View>
                    <Text style={styles.txAmount} numberOfLines={1} adjustsFontSizeToFit>{transaction.type === 'sell' ? '+' : '-'}{cash(transaction.total, transaction.currency)}</Text>
                  </View>
                  <Text style={styles.note}>{Number(transaction.quantity).toLocaleString('el-GR')} × {quotePrice(transaction.price, transaction.currency)} · έξοδα {cash(transaction.fees, transaction.currency)}</Text>
                  {transaction.broker ? <Text style={styles.source}>Broker: {transaction.broker}</Text> : null}
                  <Pressable onPress={() => deleteTransaction(transaction)} hitSlop={10}><Text style={styles.deleteText}>Διαγραφή συναλλαγής</Text></Pressable>
                </View>
              )) : <View style={styles.emptyCard}><Text style={styles.emptyTitle}>Καμία συναλλαγή.</Text><Text style={styles.note}>Η εφαρμογή ξεκινά καθαρή για κάθε νέο χρήστη.</Text></View>}
            </>
          ) : null}

          {tab === 'alerts' ? (
            <>
              <Text style={styles.section}>Ειδοποιήσεις</Text>
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Άδεια συσκευής</Text>
                <View style={styles.statusLine}><Text style={styles.muted}>Κατάσταση</Text><Text style={styles.statusStrong}>{notificationStatus === 'granted' ? 'Επιτρέπονται' : notificationStatus === 'denied' ? 'Απορρίφθηκαν' : 'Δεν ζητήθηκε'}</Text></View>
                <View style={styles.actionRow}>
                  <Pressable style={styles.secondaryAction} onPress={requestNotificationPermission}><Text style={styles.secondaryStrong}>Ζήτηση άδειας</Text></Pressable>
                  <Pressable style={styles.primaryAction} onPress={testNotification}><Text style={styles.whiteStrong}>Δοκιμή</Text></Pressable>
                </View>
              </View>

              <View style={styles.card}>
                <Text style={styles.cardTitle}>Έλεγχος τιμών</Text>
                <Text style={styles.note}>Όσο η εφαρμογή είναι ανοικτή: έλεγχος κάθε {Math.round(MARKET_REFRESH_MS / 1000)}″ και real-time SPCE με Finnhub token. Όταν είναι κλειστή: ο Android background worker είναι ενδεικτικός, όχι άμεσος.</Text>
                <View style={styles.statusLine}><Text style={styles.muted}>Παρασκήνιο</Text><Text style={styles.statusStrong}>{backgroundRegistered ? 'Ενεργό' : 'Ανενεργό'}</Text></View>
                <View style={styles.statusLine}><Text style={styles.muted}>Ελάχιστο διάστημα</Text><Text style={styles.statusStrong}>15 λεπτά, μη εγγυημένο</Text></View>
                <Pressable style={[styles.toggleButton, state.alerts.backgroundEnabled && styles.toggleButtonOn]} onPress={toggleBackground}>
                  <Text style={[styles.toggleText, state.alerts.backgroundEnabled && styles.whiteStrong]}>{state.alerts.backgroundEnabled ? 'Απενεργοποίηση παρασκηνίου' : 'Ενεργοποίηση παρασκηνίου'}</Text>
                </Pressable>
              </View>

              <Text style={styles.subsection}>Όρια ανά θέση</Text>
              {positions.length ? positions.map((position) => {
                const rule = getRule(state.alerts, position.symbol);
                return (
                  <View key={position.symbol} style={styles.card}>
                    <View style={styles.rowTop}>
                      <View style={styles.grow}><Text style={styles.cardTitle}>{position.symbol}</Text><Text style={styles.muted}>{position.company}</Text></View>
                      <View style={[styles.badge, rule.enabled ? null : styles.badgeBad]}><Text style={[styles.badgeText, rule.enabled ? null : styles.badgeBadText]}>{rule.enabled ? 'Ενεργό' : 'Ανενεργό'}</Text></View>
                    </View>
                    <Text style={styles.note}>Τρέχουσα: {quotePrice(position.nativePrice, position.currency)}</Text>
                    <View style={styles.ruleGrid}>
                      <View style={styles.ruleCell}><Text style={styles.muted}>Πάνω από</Text><Text style={styles.ruleValue}>{rule.above ? quotePrice(rule.above, position.currency) : '—'}</Text></View>
                      <View style={styles.ruleCell}><Text style={styles.muted}>Κάτω από</Text><Text style={styles.ruleValue}>{rule.below ? quotePrice(rule.below, position.currency) : '—'}</Text></View>
                      <View style={styles.ruleCellWide}><Text style={styles.muted}>Ημερήσια μεταβολή</Text><Text style={styles.ruleValue}>{rule.dailyPct ? `±${rule.dailyPct}%` : '—'}</Text></View>
                    </View>
                    <Pressable style={styles.secondaryButton} onPress={() => setAlertPosition(position)}><Text style={styles.secondaryStrong}>Ρύθμιση ορίων</Text></Pressable>
                  </View>
                );
              }) : <View style={styles.emptyCard}><Text style={styles.emptyTitle}>Δεν υπάρχουν θέσεις.</Text><Text style={styles.note}>Πρόσθεσε συναλλαγή πριν ορίσεις ειδοποιήσεις.</Text></View>}

              <View style={styles.sectionRow}><Text style={styles.subsection}>Ιστορικό</Text>{state.alerts.history.length ? <Pressable onPress={clearAlertHistory}><Text style={styles.deleteText}>Καθαρισμός</Text></Pressable> : null}</View>
              {state.alerts.history.length ? state.alerts.history.slice(0, 20).map((event) => (
                <View key={event.id} style={styles.historyCard}>
                  <Text style={styles.txTitle}>{event.symbol}</Text>
                  <Text style={styles.note}>{event.message}</Text>
                  <Text style={styles.source}>{when(event.triggeredAt)}</Text>
                </View>
              )) : <View style={styles.emptyCard}><Text style={styles.emptyTitle}>Καμία ενεργοποίηση.</Text><Text style={styles.note}>Οι ειδοποιήσεις που πυροδοτούνται θα καταγράφονται εδώ.</Text></View>}
            </>
          ) : null}

          {tab === 'settings' ? (
            <>
              <Text style={styles.section}>Ρυθμίσεις</Text>
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Ιδιωτικότητα δεδομένων</Text>
                <Text style={styles.note}>Οι συναλλαγές, τα όρια και το ιστορικό αποθηκεύονται στον ιδιωτικό χώρο της εφαρμογής στη συγκεκριμένη συσκευή. Δεν υπάρχει κοινός λογαριασμός ή πρόσβαση διαχειριστή.</Text>
                <View style={styles.statusLine}><Text style={styles.muted}>Αποθήκευση</Text><Text style={styles.statusStrong}>Μόνο στη συσκευή</Text></View>
                <View style={styles.statusLine}><Text style={styles.muted}>Cloud συγχρονισμός</Text><Text style={styles.statusStrong}>Ανενεργός</Text></View>
              </View>

              <View style={styles.card}>
                <Text style={styles.cardTitle}>Αντίγραφο ασφαλείας</Text>
                <Text style={styles.note}>Το αρχείο περιλαμβάνει συναλλαγές και όρια. Δεν περιλαμβάνει το Finnhub token. Φύλαξέ το σε Drive, email ή άλλο ασφαλές σημείο.</Text>
                <Pressable style={styles.primary} onPress={exportBackup}><Text style={styles.whiteStrong}>Εξαγωγή αντιγράφου JSON</Text></Pressable>
                <Pressable style={styles.secondaryButton} onPress={importBackup}><Text style={styles.secondaryStrong}>Επαναφορά από JSON</Text></Pressable>
              </View>

              <View style={styles.card}>
                <Text style={styles.cardTitle}>Πηγές τιμών</Text>
                <Text style={styles.note}>Allwyn: επίσημη Euronext Athens με δηλωμένη καθυστέρηση 15′. SPCE: Finnhub WebSocket real-time με δικό σου token. Χωρίς token χρησιμοποιείται εφεδρική πηγή.</Text>
                <TextInput style={styles.input} placeholder="Finnhub API token" placeholderTextColor="#97a2b3" value={token} onChangeText={setToken} autoCapitalize="none" autoCorrect={false} secureTextEntry />
                <Pressable style={styles.primary} onPress={saveToken}><Text style={styles.whiteStrong}>Αποθήκευση token</Text></Pressable>
                <Text style={styles.source}>Έκδοση {VERSION} · Background task: {BACKGROUND_ALERT_TASK}</Text>
              </View>

              <View style={styles.card}>
                <Text style={styles.cardTitle}>Τοπικά δεδομένα</Text>
                <Text style={styles.note}>Η διαγραφή αφορά μόνο αυτή τη συσκευή. Πάρε αντίγραφο πριν συνεχίσεις.</Text>
                <Pressable style={styles.dangerButton} onPress={resetLocalData}><Text style={styles.dangerStrong}>Διαγραφή όλων των τοπικών δεδομένων</Text></Pressable>
              </View>
            </>
          ) : null}
        </ScrollView>

        <SafeAreaView style={styles.tabsSafe} edges={['bottom', 'left', 'right']}>
          <View style={styles.tabs}>
            {[['summary', 'Σύνοψη'], ['transactions', 'Συναλλαγές'], ['alerts', 'Ειδοπ.'], ['settings', 'Ρυθμίσεις']].map(([key, label]) => (
              <Pressable key={key} style={[styles.tab, tab === key && styles.tabOn]} onPress={() => setTab(key)}>
                <Text style={[styles.tabText, tab === key && styles.tabTextOn]} numberOfLines={1} adjustsFontSizeToFit>{label}</Text>
              </Pressable>
            ))}
          </View>
        </SafeAreaView>
      </View>

      <TransactionModal visible={transactionModal} onClose={() => setTransactionModal(false)} onSave={addTransaction} />
      <AlertRuleModal
        visible={Boolean(alertPosition)}
        position={alertPosition}
        rule={alertPosition ? getRule(state.alerts, alertPosition.symbol) : null}
        onClose={() => setAlertPosition(null)}
        onSave={saveAlertRule}
      />
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <MainApp />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#eef5ff' },
  app: { flex: 1 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 28, gap: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: '#eef5ff' },
  eyebrow: { color: '#0b66ff', fontWeight: '900', letterSpacing: 1.5, fontSize: 13 },
  title: { fontSize: 34, lineHeight: 40, fontWeight: '900', color: '#10233f', flex: 1 },
  titleCompact: { fontSize: 30 },
  section: { fontSize: 28, lineHeight: 34, fontWeight: '900', color: '#10233f' },
  subsection: { fontSize: 21, lineHeight: 27, fontWeight: '900', color: '#10233f' },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 4 },
  priceRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 },
  grow: { flex: 1, minWidth: 0 },
  plus: { width: 54, height: 54, borderRadius: 18, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#dbe3ef' },
  plusText: { fontSize: 34, lineHeight: 38, color: '#10233f' },
  refreshCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 24, padding: 18, borderWidth: 1, borderColor: '#dbe3ef', gap: 14 },
  checked: { fontSize: 17, fontWeight: '900', color: '#10233f', marginTop: 4 },
  primary: { backgroundColor: '#0b66ff', borderRadius: 16, padding: 16, alignItems: 'center' },
  primarySmall: { backgroundColor: '#0b66ff', borderRadius: 16, paddingHorizontal: 15, paddingVertical: 14, minWidth: 108, alignItems: 'center' },
  secondarySmall: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#d7e0ec', borderRadius: 16, paddingHorizontal: 15, paddingVertical: 13, alignItems: 'center' },
  secondaryButton: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#d7e0ec', borderRadius: 16, padding: 15, alignItems: 'center' },
  actionRow: { flexDirection: 'row', gap: 12 },
  primaryAction: { flex: 1, backgroundColor: '#0b66ff', borderRadius: 16, padding: 15, alignItems: 'center' },
  secondaryAction: { flex: 1, backgroundColor: '#fff', borderWidth: 1, borderColor: '#d7e0ec', borderRadius: 16, padding: 15, alignItems: 'center' },
  secondaryStrong: { color: '#10233f', fontWeight: '900' },
  disabled: { opacity: 0.65 },
  whiteStrong: { color: '#fff', fontWeight: '900' },
  white: { color: '#fff' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  metric: { flexGrow: 1, flexBasis: '47%', minWidth: 0, minHeight: 110, backgroundColor: '#fff', borderRadius: 22, padding: 17, borderWidth: 1, borderColor: '#dbe3ef', justifyContent: 'space-between' },
  metricCompact: { flexBasis: '100%' },
  metricValue: { fontSize: 21, lineHeight: 27, fontWeight: '900', color: '#10233f' },
  card: { backgroundColor: '#fff', borderRadius: 25, padding: 20, borderWidth: 1, borderColor: '#dbe3ef', gap: 15 },
  historyCard: { backgroundColor: 'rgba(255,255,255,0.78)', borderRadius: 18, padding: 15, borderWidth: 1, borderColor: '#dbe3ef', gap: 5 },
  emptyCard: { backgroundColor: 'rgba(255,255,255,0.62)', borderRadius: 24, padding: 22, borderWidth: 1, borderStyle: 'dashed', borderColor: '#cbd7e7', gap: 10 },
  emptyTitle: { fontSize: 19, fontWeight: '900', color: '#10233f' },
  cardTitle: { fontSize: 23, lineHeight: 29, fontWeight: '900', color: '#10233f' },
  txTitle: { fontSize: 17, lineHeight: 22, fontWeight: '900', color: '#10233f' },
  txAmount: { maxWidth: '38%', fontSize: 17, fontWeight: '900', color: '#10233f' },
  muted: { fontSize: 15, color: '#7c879a', lineHeight: 21 },
  note: { fontSize: 14, color: '#66758c', lineHeight: 21 },
  source: { fontSize: 12, color: '#78869b', lineHeight: 18 },
  big: { fontSize: 36, lineHeight: 43, fontWeight: '900', color: '#10233f' },
  change: { fontSize: 17, fontWeight: '900', paddingBottom: 5 },
  red: { color: '#d63d4c' },
  green: { color: '#14884f' },
  badge: { backgroundColor: '#edf4ff', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 14, flexShrink: 0 },
  badgeText: { fontWeight: '900', color: '#075ed1', fontSize: 12 },
  badgeBad: { backgroundColor: '#fff0f1' },
  badgeBadText: { color: '#c92e3d' },
  warning: { backgroundColor: '#fff5e7', color: '#7a4e00', padding: 12, borderRadius: 14, lineHeight: 20 },
  tabsSafe: { backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#dbe3ef' },
  tabs: { paddingHorizontal: 6, paddingTop: 8, flexDirection: 'row', gap: 3 },
  tab: { flex: 1, minWidth: 0, minHeight: 54, alignItems: 'center', justifyContent: 'center', borderRadius: 16, paddingHorizontal: 3 },
  tabOn: { backgroundColor: '#edf4ff' },
  tabText: { color: '#768297', fontWeight: '800', fontSize: 12 },
  tabTextOn: { color: '#0b66ff' },
  overlay: { flex: 1, backgroundColor: 'rgba(7,22,44,0.55)', justifyContent: 'flex-end' },
  keyboardLayer: { flex: 1, justifyContent: 'flex-end' },
  sheet: { maxHeight: '94%', backgroundColor: '#f8faff', borderTopLeftRadius: 28, borderTopRightRadius: 28, overflow: 'hidden' },
  form: { padding: 22, gap: 13, paddingBottom: 34 },
  field: { gap: 7 },
  fieldLabel: { color: '#45546b', fontSize: 14, fontWeight: '800' },
  input: { minHeight: 56, backgroundColor: '#fff', borderWidth: 1, borderColor: '#d7e0ec', borderRadius: 16, paddingHorizontal: 15, fontSize: 16, color: '#10233f' },
  segmentRow: { flexDirection: 'row', gap: 12 },
  segment: { flex: 1, borderWidth: 1, borderColor: '#d7e0ec', backgroundColor: '#fff', borderRadius: 15, padding: 14, alignItems: 'center' },
  segmentOn: { backgroundColor: '#0b66ff', borderColor: '#0b66ff' },
  segmentText: { fontWeight: '900', color: '#10233f' },
  link: { color: '#0b66ff', fontWeight: '900', paddingTop: 8 },
  deleteText: { color: '#cf3444', fontWeight: '900', alignSelf: 'flex-end' },
  statusLine: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#edf0f5' },
  statusStrong: { color: '#10233f', fontWeight: '900', textAlign: 'right', flexShrink: 1 },
  dangerButton: { backgroundColor: '#fff0f1', borderWidth: 1, borderColor: '#f3c8ce', borderRadius: 16, padding: 15, alignItems: 'center' },
  dangerStrong: { color: '#c92e3d', fontWeight: '900' },
  toggleButton: { backgroundColor: '#f2f5fa', borderWidth: 1, borderColor: '#d7e0ec', borderRadius: 16, padding: 15, alignItems: 'center' },
  toggleButtonOn: { backgroundColor: '#0b66ff', borderColor: '#0b66ff' },
  toggleText: { color: '#10233f', fontWeight: '900' },
  ruleGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  ruleCell: { flexGrow: 1, flexBasis: '46%', backgroundColor: '#f7f9fc', borderRadius: 16, padding: 13, gap: 6 },
  ruleCellWide: { flexGrow: 1, flexBasis: '100%', backgroundColor: '#f7f9fc', borderRadius: 16, padding: 13, gap: 6 },
  ruleValue: { color: '#10233f', fontWeight: '900', fontSize: 17 },
});
