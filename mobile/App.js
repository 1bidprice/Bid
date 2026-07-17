import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'investor-control-mobile-state-v1';
const MARKET_FEED_URL = 'https://1bidprice.github.io/Bid/market-data.json';
const REFRESH_MS = 30_000;

const INITIAL_STATE = {
  version: 1,
  transactions: [
    {
      id: 'alwn-buy-20260716',
      type: 'buy',
      symbol: 'ALWN.GR',
      company: 'Allwyn',
      date: '2026-07-16',
      quantity: 193,
      nativeCurrency: 'EUR',
      nativePrice: 13.57,
      nativeFees: 11.95,
      nativeTax: 0,
      nativeTotal: 2630.96,
      broker: 'Τράπεζα Πειραιώς',
    },
    {
      id: 'spce-buy-20260303',
      type: 'buy',
      symbol: 'SPCE.US',
      company: 'Virgin Galactic Holdings',
      date: '2026-03-03',
      quantity: 720,
      nativeCurrency: 'USD',
      nativePrice: 3.17,
      nativeFees: 0,
      nativeTax: 0,
      nativeTotal: 2282.72,
      broker: 'Freedom24',
    },
  ],
  prices: {},
  alerts: {
    'ALWN.GR': { above: null, below: null, dailyChangePct: 5 },
    'SPCE.US': { above: null, below: null, dailyChangePct: 5 },
  },
  meta: { lastUpdated: null },
};

const money = (value, currency = 'EUR') => {
  if (!Number.isFinite(Number(value))) return '—';
  return new Intl.NumberFormat('el-GR', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value));
};

const price = (value, currency = 'EUR') => {
  if (!Number.isFinite(Number(value))) return '—';
  return new Intl.NumberFormat('el-GR', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 3,
  }).format(Number(value));
};

const percent = (value) => {
  if (!Number.isFinite(Number(value))) return '—';
  const n = Number(value);
  return `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;
};

const parseNumber = (value) => {
  const normalized = String(value ?? '').trim().replace(/\./g, '').replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

function buildPositions(transactions, prices) {
  const map = {};
  const ordered = [...transactions].sort((a, b) => String(a.date).localeCompare(String(b.date)));

  for (const tx of ordered) {
    if (!['buy', 'sell'].includes(tx.type)) continue;
    const symbol = String(tx.symbol || '').trim().toUpperCase();
    const quantity = Number(tx.quantity || 0);
    if (!symbol || quantity <= 0) continue;

    const position = map[symbol] || {
      symbol,
      company: tx.company || symbol,
      currency: tx.nativeCurrency || 'EUR',
      quantity: 0,
      nativeCost: 0,
      broker: tx.broker || '',
    };

    const total = Number(tx.nativeTotal || 0) ||
      quantity * Number(tx.nativePrice || 0) + Number(tx.nativeFees || 0) + Number(tx.nativeTax || 0);

    if (tx.type === 'buy') {
      position.quantity += quantity;
      position.nativeCost += total;
    } else if (position.quantity > 0) {
      const sold = Math.min(quantity, position.quantity);
      const average = position.nativeCost / position.quantity;
      position.quantity -= sold;
      position.nativeCost -= average * sold;
    }

    map[symbol] = position;
  }

  return Object.values(map)
    .filter((item) => item.quantity > 0)
    .map((item) => {
      const quote = prices[item.symbol] || null;
      const nativeMarketPrice = quote?.nativePrice ?? quote?.price ?? null;
      const eurMarketPrice = quote?.price ?? null;
      const fxRate = item.currency === 'USD' ? Number(quote?.fxRate || 0) : 1;
      const nativeValue = Number.isFinite(Number(nativeMarketPrice))
        ? item.quantity * Number(nativeMarketPrice)
        : null;
      const eurValue = Number.isFinite(Number(eurMarketPrice))
        ? item.quantity * Number(eurMarketPrice)
        : null;
      const averageNative = item.nativeCost / item.quantity;
      const nativePnl = nativeValue == null ? null : nativeValue - item.nativeCost;
      const nativePct = nativePnl == null || item.nativeCost <= 0 ? null : (nativePnl / item.nativeCost) * 100;
      const eurCost = item.currency === 'USD' && fxRate > 0 ? item.nativeCost / fxRate : item.nativeCost;
      const eurPnl = eurValue == null ? null : eurValue - eurCost;

      return {
        ...item,
        quote,
        nativeMarketPrice,
        eurMarketPrice,
        fxRate,
        nativeValue,
        eurValue,
        averageNative,
        nativePnl,
        nativePct,
        eurCost,
        eurPnl,
      };
    });
}

function Metric({ label, value, tone }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, tone === 'negative' && styles.negative, tone === 'positive' && styles.positive]}>
        {value}
      </Text>
    </View>
  );
}

function TabButton({ active, label, onPress }) {
  return (
    <Pressable onPress={onPress} style={[styles.tabButton, active && styles.tabButtonActive]}>
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
    </Pressable>
  );
}

function PositionCard({ item }) {
  const currency = item.currency;
  const pnlTone = item.nativePnl == null ? undefined : item.nativePnl < 0 ? 'negative' : 'positive';

  return (
    <View style={styles.card}>
      <View style={styles.rowBetween}>
        <View style={styles.flexOne}>
          <Text style={styles.cardTitle}>{item.company}</Text>
          <Text style={styles.muted}>{item.symbol} · {item.quantity.toLocaleString('el-GR')} μετοχές</Text>
        </View>
        <View style={styles.badge}><Text style={styles.badgeText}>ΘΕΣΗ</Text></View>
      </View>

      <View style={styles.priceRow}>
        <View>
          <Text style={styles.muted}>Τρέχουσα τιμή</Text>
          <Text style={styles.marketPrice}>{price(item.nativeMarketPrice, currency)}</Text>
          {currency === 'USD' && item.eurMarketPrice != null ? (
            <Text style={styles.muted}>≈ {price(item.eurMarketPrice, 'EUR')}</Text>
          ) : null}
        </View>
        <Text style={[styles.change, item.quote?.changePct < 0 ? styles.negative : styles.positive]}>
          {percent(item.quote?.changePct)}
        </Text>
      </View>

      <View style={styles.metricsGrid}>
        <Metric label="Αξία θέσης" value={item.nativeValue == null ? '—' : money(item.nativeValue, currency)} />
        <Metric label="Συνολικό κόστος" value={money(item.nativeCost, currency)} />
        <Metric label="Κέρδος / Ζημία" value={item.nativePnl == null ? '—' : money(item.nativePnl, currency)} tone={pnlTone} />
        <Metric label="Μέση τιμή κτήσης" value={price(item.averageNative, currency)} />
      </View>

      {currency === 'USD' && item.eurValue != null ? (
        <Text style={styles.note}>Σε ευρώ: αξία ≈ {money(item.eurValue, 'EUR')} · αποτέλεσμα ≈ {money(item.eurPnl, 'EUR')}</Text>
      ) : null}
    </View>
  );
}

function AddTransactionModal({ visible, onClose, onSave }) {
  const [form, setForm] = useState({
    symbol: '',
    company: '',
    quantity: '',
    nativePrice: '',
    fees: '0',
    currency: 'EUR',
    broker: '',
  });

  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  const submit = () => {
    const quantity = parseNumber(form.quantity);
    const nativePrice = parseNumber(form.nativePrice);
    const fees = parseNumber(form.fees);
    const symbol = form.symbol.trim().toUpperCase();
    if (!symbol || quantity <= 0 || nativePrice <= 0) {
      Alert.alert('Λείπουν στοιχεία', 'Συμπλήρωσε σύμβολο, ποσότητα και τιμή αγοράς.');
      return;
    }

    onSave({
      id: `tx-${Date.now()}`,
      type: 'buy',
      symbol,
      company: form.company.trim() || symbol,
      date: new Date().toISOString().slice(0, 10),
      quantity,
      nativeCurrency: form.currency,
      nativePrice,
      nativeFees: fees,
      nativeTax: 0,
      nativeTotal: quantity * nativePrice + fees,
      broker: form.broker.trim(),
    });
    setForm({ symbol: '', company: '', quantity: '', nativePrice: '', fees: '0', currency: 'EUR', broker: '' });
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <SafeAreaView style={styles.modalSheet}>
          <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
            <View style={styles.rowBetween}>
              <Text style={styles.sectionTitle}>Νέα αγορά</Text>
              <Pressable onPress={onClose}><Text style={styles.closeText}>Κλείσιμο</Text></Pressable>
            </View>
            <TextInput style={styles.input} placeholder="Σύμβολο, π.χ. ALWN.GR" value={form.symbol} onChangeText={(v) => update('symbol', v)} autoCapitalize="characters" />
            <TextInput style={styles.input} placeholder="Εταιρεία" value={form.company} onChangeText={(v) => update('company', v)} />
            <TextInput style={styles.input} placeholder="Μετοχές" value={form.quantity} onChangeText={(v) => update('quantity', v)} keyboardType="decimal-pad" />
            <TextInput style={styles.input} placeholder="Τιμή ανά μετοχή" value={form.nativePrice} onChangeText={(v) => update('nativePrice', v)} keyboardType="decimal-pad" />
            <TextInput style={styles.input} placeholder="Προμήθεια / έξοδα" value={form.fees} onChangeText={(v) => update('fees', v)} keyboardType="decimal-pad" />
            <View style={styles.currencyRow}>
              {['EUR', 'USD'].map((currency) => (
                <Pressable key={currency} onPress={() => update('currency', currency)} style={[styles.currencyButton, form.currency === currency && styles.currencyButtonActive]}>
                  <Text style={[styles.currencyText, form.currency === currency && styles.currencyTextActive]}>{currency}</Text>
                </Pressable>
              ))}
            </View>
            <TextInput style={styles.input} placeholder="Broker / τράπεζα" value={form.broker} onChangeText={(v) => update('broker', v)} />
            <Pressable style={styles.primaryButton} onPress={submit}><Text style={styles.primaryButtonText}>Αποθήκευση αγοράς</Text></Pressable>
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

export default function App() {
  const [state, setState] = useState(INITIAL_STATE);
  const [tab, setTab] = useState('summary');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const appState = useRef(AppState.currentState);

  const persist = useCallback(async (next) => {
    setState(next);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(STORAGE_KEY);
        if (saved) setState(JSON.parse(saved));
        else await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(INITIAL_STATE));
      } catch (error) {
        Alert.alert('Αποθήκευση', 'Δεν φορτώθηκαν τα τοπικά δεδομένα.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const refreshPrices = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setRefreshing(true);
    try {
      const response = await fetch(`${MARKET_FEED_URL}?t=${Date.now()}`, {
        headers: { 'Cache-Control': 'no-cache' },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const feed = await response.json();
      const quotes = feed?.quotes || {};
      if (!Object.keys(quotes).length) throw new Error(feed?.error || 'Το feed δεν επέστρεψε τιμές.');

      setState((current) => {
        const next = {
          ...current,
          prices: { ...current.prices, ...quotes },
          meta: { ...current.meta, lastUpdated: feed.lastCheckedAt || feed.generatedAt || new Date().toISOString() },
        };
        AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
        return next;
      });
    } catch (error) {
      if (!silent) Alert.alert('Τιμές', `Δεν έγινε ενημέρωση: ${error.message}`);
    } finally {
      if (!silent) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (loading) return undefined;
    refreshPrices({ silent: true });
    const timer = setInterval(() => refreshPrices({ silent: true }), REFRESH_MS);
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (appState.current.match(/inactive|background/) && nextState === 'active') {
        refreshPrices({ silent: true });
      }
      appState.current = nextState;
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [loading, refreshPrices]);

  const positions = useMemo(() => buildPositions(state.transactions, state.prices), [state.transactions, state.prices]);
  const pricedPositions = positions.filter((item) => item.eurValue != null);
  const totalValue = pricedPositions.reduce((sum, item) => sum + item.eurValue, 0);
  const totalCost = pricedPositions.reduce((sum, item) => sum + item.eurCost, 0);
  const totalPnl = totalValue - totalCost;
  const totalPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;

  const addTransaction = async (transaction) => {
    const next = { ...state, transactions: [...state.transactions, transaction] };
    await persist(next);
  };

  const reset = () => {
    Alert.alert('Επαναφορά εφαρμογής', 'Θα διαγραφούν οι τοπικές αλλαγές και θα επανέλθουν οι δύο αρχικές θέσεις.', [
      { text: 'Άκυρο', style: 'cancel' },
      { text: 'Επαναφορά', style: 'destructive', onPress: () => persist(INITIAL_STATE) },
    ]);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.loadingScreen}>
        <StatusBar barStyle="dark-content" />
        <ActivityIndicator size="large" color="#0b66ff" />
        <Text style={styles.loadingText}>Φόρτωση Investor Control…</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" backgroundColor="#eef5ff" />
      <View style={styles.app}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Text style={styles.eyebrow}>ΠΡΟΣΩΠΙΚΟ ΧΑΡΤΟΦΥΛΑΚΙΟ</Text>
          <View style={styles.rowBetween}>
            <Text style={styles.title}>Investor Control</Text>
            <Pressable style={styles.plusButton} onPress={() => setModalVisible(true)}><Text style={styles.plus}>＋</Text></Pressable>
          </View>

          {tab === 'summary' && (
            <>
              <View style={styles.refreshCard}>
                <View style={styles.flexOne}>
                  <Text style={styles.muted}>Τελευταία ενημέρωση</Text>
                  <Text style={styles.refreshTime}>{state.meta.lastUpdated ? new Date(state.meta.lastUpdated).toLocaleString('el-GR') : 'Δεν έχει γίνει'}</Text>
                </View>
                <Pressable style={styles.primaryButtonSmall} onPress={() => refreshPrices()} disabled={refreshing}>
                  {refreshing ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Ανανέωση</Text>}
                </Pressable>
              </View>

              <View style={styles.summaryGrid}>
                <Metric label="Αξία χαρτοφυλακίου" value={pricedPositions.length ? money(totalValue, 'EUR') : '—'} />
                <Metric label="Καθαρό κόστος" value={pricedPositions.length ? money(totalCost, 'EUR') : '—'} />
                <Metric label="Κέρδος / Ζημία" value={pricedPositions.length ? `${money(totalPnl, 'EUR')} · ${percent(totalPct)}` : '—'} tone={totalPnl < 0 ? 'negative' : 'positive'} />
                <Metric label="Θέσεις" value={String(positions.length)} />
              </View>

              <Text style={styles.sectionTitle}>Θέσεις</Text>
              {positions.map((item) => <PositionCard key={item.symbol} item={item} />)}
            </>
          )}

          {tab === 'transactions' && (
            <>
              <View style={styles.rowBetween}>
                <View><Text style={styles.sectionTitle}>Συναλλαγές</Text><Text style={styles.muted}>Αγορές και πωλήσεις</Text></View>
                <Pressable style={styles.primaryButtonSmall} onPress={() => setModalVisible(true)}><Text style={styles.primaryButtonText}>Προσθήκη</Text></Pressable>
              </View>
              {state.transactions.map((tx) => (
                <View key={tx.id} style={styles.card}>
                  <View style={styles.rowBetween}>
                    <View style={styles.flexOne}>
                      <Text style={styles.transactionTitle}>{tx.type === 'buy' ? 'Αγορά' : 'Πώληση'} · {tx.company}</Text>
                      <Text style={styles.muted}>{tx.symbol} · {new Date(tx.date).toLocaleDateString('el-GR')}</Text>
                    </View>
                    <Text style={styles.transactionAmount}>-{money(tx.nativeTotal, tx.nativeCurrency)}</Text>
                  </View>
                  <Text style={styles.note}>{tx.quantity} × {price(tx.nativePrice, tx.nativeCurrency)} · έξοδα {money(tx.nativeFees, tx.nativeCurrency)}</Text>
                </View>
              ))}
            </>
          )}

          {tab === 'alerts' && (
            <>
              <Text style={styles.sectionTitle}>Ειδοποιήσεις</Text>
              <Text style={styles.muted}>Στο πρώτο native στάδιο οι έλεγχοι γίνονται όσο η εφαρμογή είναι ενεργή.</Text>
              {positions.map((item) => (
                <View key={item.symbol} style={styles.card}>
                  <Text style={styles.cardTitle}>{item.symbol}</Text>
                  <Text style={styles.muted}>Τρέχουσα τιμή: {price(item.nativeMarketPrice, item.currency)}</Text>
                  <Text style={styles.note}>Ημερήσια μεταβολή: {percent(item.quote?.changePct)} · όριο ειδοποίησης {state.alerts[item.symbol]?.dailyChangePct ?? 5}%</Text>
                </View>
              ))}
            </>
          )}

          {tab === 'settings' && (
            <>
              <Text style={styles.sectionTitle}>Ρυθμίσεις</Text>
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Κατάσταση εφαρμογής</Text>
                <Text style={styles.settingsLine}>Έκδοση native πυρήνα: 0.1.0</Text>
                <Text style={styles.settingsLine}>Αποθήκευση: τοπικά στη συσκευή</Text>
                <Text style={styles.settingsLine}>Αυτόματες τιμές: κάθε 30 δευτερόλεπτα όταν είναι ανοικτή</Text>
                <Text style={styles.settingsLine}>Feed: Investor Control backend</Text>
              </View>
              <Pressable style={styles.dangerButton} onPress={reset}><Text style={styles.dangerText}>Επαναφορά τοπικών δεδομένων</Text></Pressable>
            </>
          )}
        </ScrollView>

        <View style={styles.tabs}>
          <TabButton active={tab === 'summary'} label="Σύνοψη" onPress={() => setTab('summary')} />
          <TabButton active={tab === 'transactions'} label="Συναλλαγές" onPress={() => setTab('transactions')} />
          <TabButton active={tab === 'alerts'} label="Ειδοποιήσεις" onPress={() => setTab('alerts')} />
          <TabButton active={tab === 'settings'} label="Ρυθμίσεις" onPress={() => setTab('settings')} />
        </View>
      </View>

      <AddTransactionModal visible={modalVisible} onClose={() => setModalVisible(false)} onSave={addTransaction} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#eef5ff' },
  app: { flex: 1, backgroundColor: '#eef5ff' },
  content: { padding: 20, paddingBottom: 110, gap: 16 },
  loadingScreen: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#eef5ff', gap: 16 },
  loadingText: { color: '#6f7c92', fontSize: 16 },
  eyebrow: { color: '#0b66ff', fontWeight: '800', letterSpacing: 1.6, marginTop: 8 },
  title: { color: '#10233f', fontSize: 36, fontWeight: '900', flex: 1 },
  sectionTitle: { color: '#10233f', fontSize: 29, fontWeight: '900', marginTop: 4 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  flexOne: { flex: 1 },
  plusButton: { width: 54, height: 54, borderRadius: 18, backgroundColor: '#fff', borderWidth: 1, borderColor: '#dbe3ef', alignItems: 'center', justifyContent: 'center' },
  plus: { fontSize: 34, lineHeight: 38, color: '#10233f' },
  refreshCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: 24, padding: 18, borderWidth: 1, borderColor: '#dbe3ef' },
  refreshTime: { color: '#10233f', fontSize: 18, fontWeight: '800', marginTop: 4 },
  primaryButton: { backgroundColor: '#0b66ff', borderRadius: 18, paddingVertical: 17, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center' },
  primaryButtonSmall: { minWidth: 112, minHeight: 48, backgroundColor: '#0b66ff', borderRadius: 16, paddingVertical: 12, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  primaryButtonText: { color: '#fff', fontSize: 16, fontWeight: '900' },
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  metric: { width: '48%', minHeight: 118, backgroundColor: '#fff', borderRadius: 24, padding: 18, borderWidth: 1, borderColor: '#dbe3ef', justifyContent: 'space-between' },
  metricLabel: { color: '#7c879a', fontSize: 16 },
  metricValue: { color: '#10233f', fontSize: 22, fontWeight: '900' },
  card: { backgroundColor: '#fff', borderRadius: 26, padding: 20, borderWidth: 1, borderColor: '#dbe3ef', gap: 16 },
  cardTitle: { color: '#10233f', fontSize: 24, fontWeight: '900' },
  transactionTitle: { color: '#10233f', fontSize: 18, fontWeight: '900' },
  transactionAmount: { color: '#10233f', fontSize: 18, fontWeight: '900' },
  muted: { color: '#7c879a', fontSize: 15, lineHeight: 21 },
  note: { color: '#6f7c92', fontSize: 14, lineHeight: 20 },
  badge: { backgroundColor: '#edf4ff', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 8 },
  badgeText: { color: '#075ed1', fontWeight: '900' },
  priceRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 },
  marketPrice: { color: '#10233f', fontSize: 38, fontWeight: '900', marginTop: 4 },
  change: { fontSize: 18, fontWeight: '900', marginBottom: 6 },
  positive: { color: '#14884f' },
  negative: { color: '#d63d4c' },
  metricsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tabs: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#dbe3ef', paddingHorizontal: 8, paddingTop: 8, paddingBottom: 10, flexDirection: 'row' },
  tabButton: { flex: 1, minHeight: 58, alignItems: 'center', justifyContent: 'center', borderRadius: 18, paddingHorizontal: 4 },
  tabButtonActive: { backgroundColor: '#edf4ff' },
  tabText: { color: '#768297', fontSize: 12, fontWeight: '800', textAlign: 'center' },
  tabTextActive: { color: '#0b66ff' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(7,22,44,.58)', justifyContent: 'flex-end' },
  modalSheet: { maxHeight: '92%', backgroundColor: '#f8faff', borderTopLeftRadius: 28, borderTopRightRadius: 28 },
  modalContent: { padding: 22, gap: 14, paddingBottom: 36 },
  closeText: { color: '#0b66ff', fontSize: 16, fontWeight: '800' },
  input: { minHeight: 58, backgroundColor: '#fff', borderWidth: 1, borderColor: '#d7e0ec', borderRadius: 18, paddingHorizontal: 16, color: '#10233f', fontSize: 17 },
  currencyRow: { flexDirection: 'row', gap: 12 },
  currencyButton: { flex: 1, borderRadius: 16, borderWidth: 1, borderColor: '#d7e0ec', backgroundColor: '#fff', minHeight: 50, alignItems: 'center', justifyContent: 'center' },
  currencyButtonActive: { backgroundColor: '#0b66ff', borderColor: '#0b66ff' },
  currencyText: { color: '#10233f', fontWeight: '900' },
  currencyTextActive: { color: '#fff' },
  settingsLine: { color: '#5f6d83', fontSize: 16, lineHeight: 24 },
  dangerButton: { backgroundColor: '#fff0f1', borderWidth: 1, borderColor: '#fac9ce', borderRadius: 18, padding: 18, alignItems: 'center' },
  dangerText: { color: '#c92e3d', fontSize: 16, fontWeight: '900' },
});
