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
  Switch,
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
  STORAGE_KEY,
  syncBackgroundAlertTask,
} from './src/background-alert-task';
import { exportBackupAsync, pickBackupAsync } from './src/backup';
import {
  allInPrice,
  buildTransaction,
  normalizeTransactions,
  roundMoney,
  transactionExecutionPrice,
  transactionFees,
  transactionGross,
  transactionOrderPrice,
  transactionTotal,
} from './src/transaction-accounting';

const VERSION = '0.6.4';
const EMPTY_STATE = {
  schemaVersion: 5,
  transactions: [],
  prices: {},
  meta: { lastCheckedAt: null, errors: [], accountingVersion: 2 },
  alerts: normalizeAlerts(null),
};

const valid = (value) => value !== null && value !== undefined && Number.isFinite(Number(value));
const positive = (value) => valid(value) && Number(value) > 0;

const parseNum = (value) => {
  const raw = String(value ?? '').trim().replace(/\s/g, '');
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

const inputNumber = (value, digits = 4) => positive(value)
  ? Number(value).toLocaleString('el-GR', { maximumFractionDigits: digits, useGrouping: false })
  : '';

const cash = (value, currency = 'EUR') => valid(value)
  ? new Intl.NumberFormat('el-GR', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number(value))
  : '—';

const quotePrice = (value, currency = 'EUR', digits = 3) => valid(value)
  ? new Intl.NumberFormat('el-GR', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: digits,
    }).format(Number(value))
  : '—';

const plainPrice = (value, digits = 4) => valid(value)
  ? Number(value).toLocaleString('el-GR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: digits,
    })
  : '—';

const pct = (value) => valid(value)
  ? `${Number(value) > 0 ? '+' : ''}${Number(value).toFixed(2)}%`
  : '—';

const when = (value) => value ? new Date(value).toLocaleString('el-GR') : '—';

function normalizeState(raw) {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_STATE };
  return {
    schemaVersion: 5,
    transactions: normalizeTransactions(raw.transactions),
    prices: raw.prices && typeof raw.prices === 'object' ? raw.prices : {},
    meta: {
      lastCheckedAt: raw.meta?.lastCheckedAt || null,
      errors: Array.isArray(raw.meta?.errors) ? raw.meta.errors : [],
      accountingVersion: 2,
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

      if (transaction.type === 'buy') {
        position.quantity += quantity;
        position.cost += transactionTotal(transaction);
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
      const eurCost = position.currency === 'USD' && fxRate > 0 ? position.cost / fxRate : position.cost;
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

function Field({ label, helper, value, onChangeText, keyboardType = 'default', autoCapitalize = 'sentences', placeholder, multiline = false }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {helper ? <Text style={styles.fieldHelper}>{helper}</Text> : null}
      <TextInput
        style={[styles.input, multiline && styles.inputMultiline]}
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        placeholder={placeholder}
        placeholderTextColor="#8d9aaf"
        multiline={multiline}
        textAlignVertical={multiline ? 'top' : 'center'}
      />
    </View>
  );
}

function Segment({ value, current, label, onPress }) {
  const active = value === current;
  return (
    <Pressable onPress={onPress} style={[styles.segment, active && styles.segmentOn]}>
      <Text style={[styles.segmentText, active && styles.whiteStrong]}>{label}</Text>
    </Pressable>
  );
}

function Metric({ label, value, negative, positiveValue, compact }) {
  return (
    <View style={[styles.metric, compact && styles.metricCompact]}>
      <Text style={styles.muted}>{label}</Text>
      <Text style={[styles.metricValue, negative && styles.red, positiveValue && styles.green]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.62}>
        {value}
      </Text>
    </View>
  );
}

function QuoteBadge({ quote }) {
  const text = quoteStatusText(quote);
  const bad = quote?.status === 'stale';
  return (
    <View style={[styles.badge, bad && styles.badgeBad]}>
      <Text style={[styles.badgeText, bad && styles.badgeBadText]}>{text}</Text>
    </View>
  );
}

function PositionCard({ item, compact, expanded, onToggle, onAlert }) {
  const stale = item.quote && !item.quote.usable;
  const change = Number(item.quote?.changePct);
  return (
    <View style={styles.card}>
      <Pressable onPress={onToggle}>
        <View style={styles.rowTop}>
          <View style={styles.grow}>
            <Text style={styles.cardTitle}>{item.company}</Text>
            <Text style={styles.muted}>{item.symbol} · {item.quantity.toLocaleString('el-GR')} μετοχές</Text>
          </View>
          <QuoteBadge quote={item.quote} />
        </View>
        <View style={styles.priceRow}>
          <View style={styles.grow}>
            <Text style={styles.muted}>Τρέχουσα τιμή</Text>
            <Text style={styles.big} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.64}>{stale ? '—' : quotePrice(item.nativePrice, item.currency)}</Text>
            {item.currency === 'USD' && !stale ? <Text style={styles.muted}>≈ {quotePrice(item.eurPrice, 'EUR')}</Text> : null}
          </View>
          <Text style={[styles.change, change < 0 ? styles.red : styles.green]}>{stale ? '—' : pct(change)}</Text>
        </View>
        <View style={styles.grid}>
          <Metric compact={compact} label="Αξία θέσης" value={cash(item.nativeValue, item.currency)} />
          <Metric compact={compact} label="Συνολικό κόστος" value={cash(item.cost, item.currency)} />
          <Metric compact={compact} label="Κέρδος / Ζημία" value={cash(item.nativePnl, item.currency)} negative={item.nativePnl < 0} positiveValue={item.nativePnl > 0} />
          <Metric compact={compact} label="Μέση τιμή all-in" value={quotePrice(item.average, item.currency)} />
        </View>
      </Pressable>
      {expanded ? (
        <View style={styles.detailPanel}>
          {item.currency === 'USD' && item.eurValue !== null ? <Text style={styles.note}>Σε ευρώ: αξία ≈ {cash(item.eurValue)} · αποτέλεσμα ≈ {cash(item.eurPnl)}</Text> : null}
          <Text style={styles.source}>Πηγή: {item.quote?.source || '—'}{item.quote?.updatedAt ? `\nΤιμή: ${when(item.quote.updatedAt)} · Έλεγχος: ${when(item.quote.checkedAt)}` : ''}</Text>
          {stale ? <Text style={styles.warning}>Η τιμή είναι παρωχημένη και δεν χρησιμοποιείται στη συνολική αποτίμηση.</Text> : null}
          <Pressable style={styles.secondaryActionFull} onPress={onAlert}><Text style={styles.secondaryStrong}>Ρύθμιση ειδοποιήσεων</Text></Pressable>
        </View>
      ) : <Text style={styles.tapHint}>Πάτησε για στοιχεία και ειδοποιήσεις</Text>}
    </View>
  );
}

function transactionForm(transaction = null) {
  const fees = transaction?.feeBreakdown || {};
  return {
    type: transaction?.type === 'sell' ? 'sell' : 'buy',
    symbol: transaction?.symbol || '',
    company: transaction?.company || '',
    date: transaction?.date || new Date().toISOString().slice(0, 10),
    currency: transaction?.currency === 'USD' ? 'USD' : 'EUR',
    broker: transaction?.broker || '',
    quantity: inputNumber(transaction?.quantity),
    orderPrice: inputNumber(transactionOrderPrice(transaction)),
    executionPrice: inputNumber(transactionExecutionPrice(transaction)),
    grossAmount: inputNumber(transaction?.grossAmount, 2),
    commission: inputNumber(fees.commission, 2),
    transfer: inputNumber(fees.transfer, 2),
    clearing: inputNumber(fees.clearing, 2),
    exchange: inputNumber(fees.exchange, 2),
    taxes: inputNumber(fees.taxes, 2),
    other: inputNumber(fees.other, 2),
    orderReference: transaction?.orderReference || '',
    notes: transaction?.notes || '',
  };
}

function TransactionModal({ visible, transaction, onClose, onSave }) {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState(transactionForm());
  useEffect(() => {
    if (!visible) return;
    setStep(1);
    setForm(transactionForm(transaction));
  }, [visible, transaction]);
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const quantity = parseNum(form.quantity);
  const executionPrice = parseNum(form.executionPrice);
  const calculatedGross = roundMoney(quantity * executionPrice);
  const gross = parseNum(form.grossAmount) > 0 ? roundMoney(parseNum(form.grossAmount)) : calculatedGross;
  const feeBreakdown = {
    commission: parseNum(form.commission),
    transfer: parseNum(form.transfer),
    clearing: parseNum(form.clearing),
    exchange: parseNum(form.exchange),
    taxes: parseNum(form.taxes),
    other: parseNum(form.other),
  };
  const fees = roundMoney(Object.values(feeBreakdown).reduce((sum, value) => sum + value, 0));
  const total = form.type === 'sell' ? roundMoney(Math.max(0, gross - fees)) : roundMoney(gross + fees);
  const allIn = quantity > 0 ? total / quantity : 0;

  const next = () => {
    if (step === 1 && (!form.symbol.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(form.date))) {
      Alert.alert('Λείπουν στοιχεία', 'Συμπλήρωσε σύμβολο και ημερομηνία σε μορφή ΕΕΕΕ-ΜΜ-ΗΗ.');
      return;
    }
    if (step === 2 && (quantity <= 0 || executionPrice <= 0)) {
      Alert.alert('Λείπουν στοιχεία', 'Συμπλήρωσε ποσότητα και πραγματική μέση τιμή εκτέλεσης.');
      return;
    }
    setStep((current) => Math.min(3, current + 1));
  };

  const save = () => {
    if (!form.symbol.trim() || quantity <= 0 || executionPrice <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(form.date)) {
      Alert.alert('Μη έγκυρη συναλλαγή', 'Έλεγξε σύμβολο, ημερομηνία, ποσότητα και μέση τιμή εκτέλεσης.');
      return;
    }
    onSave(buildTransaction({ ...form, quantity, orderPrice: optionalNumber(form.orderPrice), executionPrice, grossAmount: parseNum(form.grossAmount) > 0 ? parseNum(form.grossAmount) : null, feeBreakdown }, transaction));
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <KeyboardAvoidingView style={styles.keyboardLayer} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <SafeAreaView style={styles.sheet} edges={['top', 'bottom', 'left', 'right']}>
            <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <View style={styles.rowTop}>
                <View><Text style={styles.sheetTitle}>{transaction ? 'Επεξεργασία' : 'Νέα συναλλαγή'}</Text><Text style={styles.muted}>Βήμα {step} από 3</Text></View>
                <Pressable onPress={onClose} hitSlop={12}><Text style={styles.link}>Κλείσιμο</Text></Pressable>
              </View>
              <View style={styles.progressRow}>{[1, 2, 3].map((number) => <View key={number} style={[styles.progressBar, number <= step && styles.progressBarOn]} />)}</View>
              {step === 1 ? <>
                <Text style={styles.formSection}>1. Βασικά στοιχεία</Text>
                <View style={styles.segmentRow}><Segment value="buy" current={form.type} label="Αγορά" onPress={() => set('type', 'buy')} /><Segment value="sell" current={form.type} label="Πώληση" onPress={() => set('type', 'sell')} /></View>
                <Field label="Σύμβολο" helper="Το σύμβολο που χρησιμοποιεί η εφαρμογή, π.χ. ALWN.GR ή SPCE.US." value={form.symbol} onChangeText={(value) => set('symbol', value.toUpperCase())} autoCapitalize="characters" placeholder="ALWN.GR" />
                <Field label="Εταιρεία" value={form.company} onChangeText={(value) => set('company', value)} placeholder="Allwyn" />
                <Field label="Ημερομηνία συναλλαγής" value={form.date} onChangeText={(value) => set('date', value)} keyboardType="numbers-and-punctuation" placeholder="2026-07-14" />
                <Field label="Broker / τράπεζα" value={form.broker} onChangeText={(value) => set('broker', value)} placeholder="Τράπεζα Πειραιώς" />
                <View style={styles.segmentRow}><Segment value="EUR" current={form.currency} label="EUR" onPress={() => set('currency', 'EUR')} /><Segment value="USD" current={form.currency} label="USD" onPress={() => set('currency', 'USD')} /></View>
              </> : null}
              {step === 2 ? <>
                <Text style={styles.formSection}>2. Εκτέλεση εντολής</Text>
                <View style={styles.infoBox}><Text style={styles.infoTitle}>Μην περνάς την τιμή εντολής ως τιμή αγοράς.</Text><Text style={styles.note}>Η εφαρμογή υπολογίζει το χαρτοφυλάκιο με τη μέση τιμή εκτέλεσης του broker.</Text></View>
                <Field label="Ποσότητα" value={form.quantity} onChangeText={(value) => set('quantity', value)} keyboardType="decimal-pad" placeholder="193" />
                <Field label={`Τιμή εντολής (${form.currency}) — προαιρετική`} helper="Χρησιμοποιείται μόνο ως πληροφορία." value={form.orderPrice} onChangeText={(value) => set('orderPrice', value)} keyboardType="decimal-pad" placeholder="13,5700" />
                <Field label={`Μέση τιμή εκτέλεσης (${form.currency})`} helper="Η πραγματική μέση τιμή που εμφανίζει ο broker." value={form.executionPrice} onChangeText={(value) => set('executionPrice', value)} keyboardType="decimal-pad" placeholder="13,5650" />
                <Field label={`Αξία συναλλαγής (${form.currency}) — προαιρετική`} helper={`Αυτόματος υπολογισμός τώρα: ${cash(calculatedGross, form.currency)}. Συμπλήρωσέ το μόνο όταν ο broker δείχνει διαφορετική στρογγυλοποίηση.`} value={form.grossAmount} onChangeText={(value) => set('grossAmount', value)} keyboardType="decimal-pad" placeholder={plainPrice(calculatedGross, 2)} />
                <Field label="Αριθμός εντολής — προαιρετικός" value={form.orderReference} onChangeText={(value) => set('orderReference', value)} placeholder="12016850" />
              </> : null}
              {step === 3 ? <>
                <Text style={styles.formSection}>3. Έξοδα και έλεγχος</Text>
                <View style={styles.twoColumns}>
                  <View style={styles.halfField}><Field label="Προμήθεια" value={form.commission} onChangeText={(value) => set('commission', value)} keyboardType="decimal-pad" placeholder="0,00" /></View>
                  <View style={styles.halfField}><Field label="Μεταφορά" value={form.transfer} onChangeText={(value) => set('transfer', value)} keyboardType="decimal-pad" placeholder="0,00" /></View>
                  <View style={styles.halfField}><Field label="Εκκαθάριση / ΕΛΚΑΤ" value={form.clearing} onChangeText={(value) => set('clearing', value)} keyboardType="decimal-pad" placeholder="0,00" /></View>
                  <View style={styles.halfField}><Field label="Χρηματιστήριο / ΕΤΕΚ" value={form.exchange} onChangeText={(value) => set('exchange', value)} keyboardType="decimal-pad" placeholder="0,00" /></View>
                  <View style={styles.halfField}><Field label="Φόροι" value={form.taxes} onChangeText={(value) => set('taxes', value)} keyboardType="decimal-pad" placeholder="0,00" /></View>
                  <View style={styles.halfField}><Field label="Άλλα έξοδα" value={form.other} onChangeText={(value) => set('other', value)} keyboardType="decimal-pad" placeholder="0,00" /></View>
                </View>
                <Field label="Σημείωση — προαιρετική" value={form.notes} onChangeText={(value) => set('notes', value)} placeholder="Τι θέλεις να θυμάσαι για αυτή τη συναλλαγή;" multiline />
                <View style={styles.reviewCard}><Text style={styles.reviewTitle}>Τελικός έλεγχος</Text><ReviewLine label="Αξία συναλλαγής" value={cash(gross, form.currency)} /><ReviewLine label="Συνολικά έξοδα" value={cash(fees, form.currency)} /><ReviewLine label={form.type === 'sell' ? 'Καθαρό έσοδο' : 'Τελικό κόστος'} value={cash(total, form.currency)} strong /><ReviewLine label="Μέση τιμή all-in" value={quotePrice(allIn, form.currency, 4)} /></View>
              </> : null}
              <View style={styles.modalActions}>{step > 1 ? <Pressable style={styles.secondaryAction} onPress={() => setStep((current) => current - 1)}><Text style={styles.secondaryStrong}>Πίσω</Text></Pressable> : null}<Pressable style={[styles.primaryAction, step === 1 && styles.actionFull]} onPress={step < 3 ? next : save}><Text style={styles.whiteStrong}>{step < 3 ? 'Συνέχεια' : transaction ? 'Αποθήκευση αλλαγών' : 'Αποθήκευση συναλλαγής'}</Text></Pressable></View>
            </ScrollView>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

function ReviewLine({ label, value, strong }) {
  return <View style={styles.reviewLine}><Text style={styles.muted}>{label}</Text><Text style={strong ? styles.reviewStrong : styles.statusStrong}>{value}</Text></View>;
}

function TransactionCard({ transaction, expanded, onToggle, onEdit, onDelete }) {
  const currency = transaction.currency || 'EUR';
  const orderPrice = transactionOrderPrice(transaction);
  const executionPrice = transactionExecutionPrice(transaction);
  const fees = transactionFees(transaction);
  const gross = transactionGross(transaction);
  const total = transactionTotal(transaction);
  return (
    <View style={styles.card}>
      <Pressable onPress={onToggle}>
        <View style={styles.rowTop}><View style={styles.grow}><Text style={styles.txTitle}>{transaction.type === 'sell' ? 'Πώληση' : 'Αγορά'} · {transaction.company}</Text><Text style={styles.muted}>{transaction.symbol} · {transaction.date}</Text></View><Text style={styles.txAmount} numberOfLines={1} adjustsFontSizeToFit>{transaction.type === 'sell' ? '+' : '-'}{cash(total, currency)}</Text></View>
        <Text style={styles.note}>{Number(transaction.quantity).toLocaleString('el-GR')} × {quotePrice(executionPrice, currency, 4)} · έξοδα {cash(fees, currency)}</Text>
        <Text style={styles.tapHint}>{expanded ? 'Απόκρυψη λεπτομερειών' : 'Προβολή λεπτομερειών'}</Text>
      </Pressable>
      {expanded ? <View style={styles.detailPanel}>
        <ReviewLine label="Τιμή εντολής" value={orderPrice ? quotePrice(orderPrice, currency, 4) : 'Δεν καταχωρίστηκε'} />
        <ReviewLine label="Μέση τιμή εκτέλεσης" value={quotePrice(executionPrice, currency, 4)} strong />
        <ReviewLine label="Αξία συναλλαγής" value={cash(gross, currency)} />
        <ReviewLine label="Συνολικά έξοδα" value={cash(fees, currency)} />
        <ReviewLine label={transaction.type === 'sell' ? 'Καθαρό έσοδο' : 'Τελικό κόστος'} value={cash(total, currency)} strong />
        <ReviewLine label="Μέση τιμή all-in" value={quotePrice(allInPrice(transaction), currency, 4)} />
        {transaction.broker ? <Text style={styles.source}>Broker: {transaction.broker}</Text> : null}
        {transaction.orderReference ? <Text style={styles.source}>Αριθμός εντολής: {transaction.orderReference}</Text> : null}
        {transaction.notes ? <Text style={styles.note}>Σημείωση: {transaction.notes}</Text> : null}
        {transaction.migrationNote ? <Text style={styles.successNote}>{transaction.migrationNote}</Text> : null}
        <View style={styles.actionRow}><Pressable style={styles.secondaryAction} onPress={onEdit}><Text style={styles.secondaryStrong}>Επεξεργασία</Text></Pressable><Pressable style={styles.dangerAction} onPress={onDelete}><Text style={styles.dangerStrong}>Διαγραφή</Text></Pressable></View>
      </View> : null}
    </View>
  );
}

function AlertRuleModal({ visible, position, rule, onClose, onSave }) {
  const [form, setForm] = useState({ enabled: true, above: '', below: '', dailyPct: '5' });
  useEffect(() => {
    if (!visible || !position) return;
    setForm({ enabled: rule?.enabled !== false, above: inputNumber(rule?.above), below: inputNumber(rule?.below), dailyPct: inputNumber(rule?.dailyPct, 2) });
  }, [visible, position, rule]);
  if (!position) return null;
  const save = () => {
    const next = { symbol: position.symbol, enabled: form.enabled, above: optionalNumber(form.above), below: optionalNumber(form.below), dailyPct: optionalNumber(form.dailyPct) };
    if (next.enabled && !next.above && !next.below && !next.dailyPct) { Alert.alert('Χωρίς όριο', 'Βάλε τουλάχιστον ένα όριο ή απενεργοποίησε τον κανόνα.'); return; }
    onSave(next);
  };
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}><View style={styles.overlay}><KeyboardAvoidingView style={styles.keyboardLayer} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}><SafeAreaView style={styles.sheet} edges={['top', 'bottom', 'left', 'right']}><ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
      <View style={styles.rowTop}><View><Text style={styles.sheetTitle}>Όρια {position.symbol}</Text><Text style={styles.muted}>Τρέχουσα: {quotePrice(position.nativePrice, position.currency)}</Text></View><Pressable onPress={onClose}><Text style={styles.link}>Κλείσιμο</Text></Pressable></View>
      <View style={styles.switchLine}><View><Text style={styles.formSection}>Κανόνας ενεργός</Text><Text style={styles.muted}>Μπορείς να τον παγώσεις χωρίς να χαθούν τα όρια.</Text></View><Switch value={form.enabled} onValueChange={(enabled) => setForm((current) => ({ ...current, enabled }))} /></View>
      <Field label={`Πάνω από (${position.currency})`} value={form.above} onChangeText={(value) => setForm((current) => ({ ...current, above: value }))} keyboardType="decimal-pad" placeholder="π.χ. 3,20" />
      <Field label={`Κάτω από (${position.currency})`} value={form.below} onChangeText={(value) => setForm((current) => ({ ...current, below: value }))} keyboardType="decimal-pad" placeholder="π.χ. 2,40" />
      <Field label="Ημερήσια μεταβολή ±%" value={form.dailyPct} onChangeText={(value) => setForm((current) => ({ ...current, dailyPct: value }))} keyboardType="decimal-pad" placeholder="π.χ. 5" />
      <Pressable style={styles.primary} onPress={save}><Text style={styles.whiteStrong}>Αποθήκευση ορίων</Text></Pressable>
    </ScrollView></SafeAreaView></KeyboardAvoidingView></View></Modal>
  );
}

function MainApp() {
  const { width } = useWindowDimensions();
  const compactMetrics = width < 370;
  const [state, setState] = useState(EMPTY_STATE);
  const stateRef = useRef(EMPTY_STATE);
  const [tab, setTab] = useState('summary');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [transactionModal, setTransactionModal] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState(null);
  const [expandedTransaction, setExpandedTransaction] = useState(null);
  const [expandedPosition, setExpandedPosition] = useState(null);
  const [alertPosition, setAlertPosition] = useState(null);
  const [token, setToken] = useState('');
  const [notificationStatus, setNotificationStatus] = useState('unknown');
  const [backgroundRegistered, setBackgroundRegistered] = useState(false);
  const tokenRef = useRef('');
  const appState = useRef(AppState.currentState);

  const persist = useCallback(async (nextInput) => {
    const normalized = normalizeState(nextInput);
    stateRef.current = normalized;
    setState(normalized);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    return normalized;
  }, []);

  useEffect(() => { (async () => {
    try {
      const [saved, secret, permission] = await Promise.all([AsyncStorage.getItem(STORAGE_KEY), SecureStore.getItemAsync(FINNHUB_TOKEN_KEY), configureNotificationsAsync({ request: false })]);
      const next = normalizeState(saved ? JSON.parse(saved) : null);
      stateRef.current = next; setState(next); tokenRef.current = secret || ''; setToken(secret || ''); setNotificationStatus(permission);
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setBackgroundRegistered(await syncBackgroundAlertTask(next.alerts.backgroundEnabled));
    } catch (error) { Alert.alert('Εκκίνηση', `Δεν φορτώθηκαν σωστά τα τοπικά δεδομένα.\n${error.message}`); }
    finally { setLoading(false); }
  })(); }, []);

  const applyQuotes = useCallback(async (current, quotes, checkedAt, errors, { silent = false, background = false } = {}) => {
    const prices = { ...current.prices, ...quotes };
    const evaluated = evaluateAlerts(current.alerts, prices, { background });
    const next = await persist({ ...current, prices, alerts: evaluated.alerts, meta: { ...current.meta, lastCheckedAt: checkedAt, errors } });
    await presentAlertEvents(evaluated.events);
    if (!silent && errors.length) Alert.alert('Μερική ενημέρωση', errors.join('\n'));
    return next;
  }, [persist]);

  const refresh = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setRefreshing(true);
    try {
      const current = stateRef.current;
      const symbols = [...new Set(current.transactions.map((transaction) => transaction.symbol).filter(Boolean))];
      if (!symbols.length) { await persist({ ...current, meta: { ...current.meta, lastCheckedAt: new Date().toISOString(), errors: [] } }); return; }
      const result = await fetchPortfolioQuotes(symbols, { finnhubToken: tokenRef.current });
      await applyQuotes(current, result.quotes, result.checkedAt, result.errors, { silent });
    } catch (error) { if (!silent) Alert.alert('Ανανέωση', error.message); }
    finally { if (!silent) setRefreshing(false); }
  }, [applyQuotes, persist]);

  useEffect(() => {
    if (loading) return undefined;
    refresh({ silent: true });
    const interval = setInterval(() => refresh({ silent: true }), MARKET_REFRESH_MS);
    const subscription = AppState.addEventListener('change', async (nextState) => {
      if (appState.current.match(/inactive|background/) && nextState === 'active') {
        const saved = await AsyncStorage.getItem(STORAGE_KEY);
        if (saved) { const restored = normalizeState(JSON.parse(saved)); stateRef.current = restored; setState(restored); }
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
      const quote = { ...old, nativePrice: trade.price, price: trade.price / fxRate, updatedAt: new Date(trade.timestamp).toISOString(), checkedAt: new Date().toISOString(), source: 'Finnhub WebSocket real-time trade', quality: 'realtime', status: 'live', usable: true, ageSeconds: 0, changePct: previousClose > 0 ? ((trade.price - previousClose) / previousClose) * 100 : old?.changePct };
      await applyQuotes(current, { 'SPCE.US': quote }, new Date().toISOString(), current.meta.errors || [], { silent: true });
    });
  }, [applyQuotes, loading, token]);

  const positions = useMemo(() => positionsFrom(state), [state]);
  const valuesReady = positions.every((position) => position.eurValue !== null);
  const costsReady = positions.every((position) => valid(position.eurCost));
  const totalValue = positions.length === 0 ? 0 : valuesReady ? positions.reduce((sum, position) => sum + position.eurValue, 0) : null;
  const totalCost = positions.length === 0 ? 0 : costsReady ? positions.reduce((sum, position) => sum + position.eurCost, 0) : null;
  const totalPnl = totalValue !== null && totalCost !== null ? totalValue - totalCost : null;
  const openNewTransaction = () => { setEditingTransaction(null); setTransactionModal(true); };

  const saveTransaction = async (transaction) => {
    if (transaction.type === 'sell') {
      const currentPosition = positions.find((position) => position.symbol === transaction.symbol);
      const originalQuantity = editingTransaction?.type === 'sell' && editingTransaction.symbol === transaction.symbol ? Number(editingTransaction.quantity || 0) : 0;
      const available = Number(currentPosition?.quantity || 0) + originalQuantity;
      if (!currentPosition || transaction.quantity > available) { Alert.alert('Μη έγκυρη πώληση', `Διαθέσιμες μετοχές ${transaction.symbol}: ${available}.`); return; }
    }
    const current = stateRef.current;
    const transactions = editingTransaction ? current.transactions.map((item) => item.id === editingTransaction.id ? transaction : item) : [...current.transactions, transaction];
    await persist({ ...current, transactions });
    setTransactionModal(false); setEditingTransaction(null); setExpandedTransaction(transaction.id); refresh({ silent: true });
  };

  const deleteTransaction = (transaction) => Alert.alert('Διαγραφή συναλλαγής', `Να διαγραφεί η συναλλαγή ${transaction.company};`, [{ text: 'Άκυρο', style: 'cancel' }, { text: 'Διαγραφή', style: 'destructive', onPress: async () => { await persist({ ...stateRef.current, transactions: stateRef.current.transactions.filter((item) => item.id !== transaction.id) }); setExpandedTransaction(null); refresh({ silent: true }); } }]);
  const saveAlertRule = async (rule) => { const alerts = upsertRule(stateRef.current.alerts, rule); await persist({ ...stateRef.current, alerts }); const status = await configureNotificationsAsync({ request: true }); setNotificationStatus(status); setAlertPosition(null); if (status !== 'granted') Alert.alert('Χωρίς άδεια', 'Ο κανόνας αποθηκεύτηκε, αλλά το Android δεν θα εμφανίζει ειδοποιήσεις.'); refresh({ silent: true }); };
  const requestNotificationPermission = async () => { const status = await configureNotificationsAsync({ request: true }); setNotificationStatus(status); Alert.alert(status === 'granted' ? 'Ενεργές ειδοποιήσεις' : 'Η άδεια δεν δόθηκε', status === 'granted' ? 'Η συσκευή μπορεί να εμφανίζει ειδοποιήσεις τιμών.' : 'Άνοιξε τις ρυθμίσεις Android της εφαρμογής και επίτρεψε ειδοποιήσεις.'); };
  const toggleBackground = async () => {
    const enable = !stateRef.current.alerts.backgroundEnabled;
    if (enable) { const status = await configureNotificationsAsync({ request: true }); setNotificationStatus(status); if (status !== 'granted') { Alert.alert('Απαιτείται άδεια', 'Δεν ενεργοποιήθηκε ο έλεγχος παρασκηνίου.'); return; } }
    const alerts = { ...stateRef.current.alerts, backgroundEnabled: enable };
    await persist({ ...stateRef.current, alerts });
    try { const registered = await syncBackgroundAlertTask(enable); setBackgroundRegistered(registered); Alert.alert(enable ? 'Παρασκήνιο ενεργό' : 'Παρασκήνιο ανενεργό', enable ? 'Το Android θα ελέγχει περίπου ανά 15 λεπτά ή αργότερα. Δεν είναι σύστημα άμεσων χρηματιστηριακών εντολών.' : 'Δεν θα γίνονται έλεγχοι όταν η εφαρμογή είναι κλειστή.'); }
    catch (error) { await persist({ ...stateRef.current, alerts: { ...alerts, backgroundEnabled: false } }); setBackgroundRegistered(false); Alert.alert('Αποτυχία παρασκηνίου', error.message); }
  };
  const saveToken = async () => { const clean = token.trim(); if (clean) await SecureStore.setItemAsync(FINNHUB_TOKEN_KEY, clean); else await SecureStore.deleteItemAsync(FINNHUB_TOKEN_KEY); tokenRef.current = clean; Alert.alert('Αποθηκεύτηκε', 'Το Finnhub token παραμένει κρυπτογραφημένο μόνο σε αυτή τη συσκευή.'); refresh(); };
  const exportBackup = async () => { try { await exportBackupAsync(stateRef.current, VERSION); } catch (error) { Alert.alert('Αντίγραφο ασφαλείας', error.message); } };
  const importBackup = async () => { try { const payload = await pickBackupAsync(); if (!payload) return; Alert.alert('Επαναφορά αντιγράφου', `Θα αντικατασταθούν οι ${stateRef.current.transactions.length} τωρινές συναλλαγές με ${payload.data.transactions.length} συναλλαγές του αντιγράφου.`, [{ text: 'Άκυρο', style: 'cancel' }, { text: 'Επαναφορά', onPress: async () => { const restoredAlerts = normalizeAlerts({ ...payload.data.alerts, backgroundEnabled: false, runtime: {} }); await syncBackgroundAlertTask(false); setBackgroundRegistered(false); await persist({ transactions: payload.data.transactions, prices: {}, meta: { lastCheckedAt: null, errors: [], accountingVersion: 2 }, alerts: restoredAlerts }); setTab('summary'); refresh({ silent: true }); } }]); } catch (error) { Alert.alert('Μη έγκυρο αντίγραφο', error.message); } };
  const resetLocalData = () => Alert.alert('Διαγραφή όλων των δεδομένων', 'Η ενέργεια δεν αναιρείται. Πάρε πρώτα αντίγραφο ασφαλείας.', [{ text: 'Άκυρο', style: 'cancel' }, { text: 'Οριστική διαγραφή', style: 'destructive', onPress: async () => { await syncBackgroundAlertTask(false).catch(() => {}); await Promise.all([AsyncStorage.removeItem(STORAGE_KEY), SecureStore.deleteItemAsync(FINNHUB_TOKEN_KEY)]); tokenRef.current = ''; setToken(''); setBackgroundRegistered(false); await persist(EMPTY_STATE); } }]);

  if (loading) return <SafeAreaView style={styles.center} edges={['top', 'bottom', 'left', 'right']}><ActivityIndicator size="large" color="#0B66FF" /><Text style={styles.muted}>Έλεγχος και αναβάθμιση τοπικών δεδομένων…</Text></SafeAreaView>;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom', 'left', 'right']}><StatusBar barStyle="dark-content" backgroundColor="#eef5ff" /><View style={styles.app}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Text style={styles.eyebrow}>ΠΡΟΣΩΠΙΚΟ ΧΑΡΤΟΦΥΛΑΚΙΟ</Text>
        <View style={styles.rowTop}><View style={styles.grow}><Text style={[styles.title, width < 380 && styles.titleCompact]}>Investor Control</Text><Text style={styles.versionLine}>Λογιστική ακρίβεια · v{VERSION}</Text></View><Pressable style={styles.plus} onPress={openNewTransaction}><Text style={styles.plusText}>＋</Text></Pressable></View>
        {tab === 'summary' ? <>
          <View style={styles.refreshCard}><View style={styles.grow}><Text style={styles.muted}>Τελευταίος έλεγχος</Text><Text style={styles.checked}>{when(state.meta.lastCheckedAt)}</Text></View><Pressable style={[styles.primarySmall, refreshing && styles.disabled]} onPress={() => refresh()} disabled={refreshing}>{refreshing ? <ActivityIndicator color="#fff" /> : <Text style={styles.whiteStrong}>Ανανέωση</Text>}</Pressable></View>
          {state.meta.errors?.length ? <Text style={styles.warning}>{state.meta.errors.join('\n')}</Text> : null}
          <View style={styles.grid}><Metric compact={compactMetrics} label="Αξία χαρτοφυλακίου" value={cash(totalValue)} /><Metric compact={compactMetrics} label="Καθαρό κόστος" value={cash(totalCost)} /><Metric compact={compactMetrics} label="Κέρδος / Ζημία" value={cash(totalPnl)} negative={totalPnl < 0} positiveValue={totalPnl > 0} /><Metric compact={compactMetrics} label="Θέσεις" value={String(positions.length)} /></View>
          {!valuesReady ? <Text style={styles.warning}>Η συνολική αποτίμηση μένει κενή όταν κάποια τιμή είναι παρωχημένη ή μη διαθέσιμη.</Text> : null}
          <View style={styles.quickActions}><Pressable style={styles.primaryQuick} onPress={openNewTransaction}><Text style={styles.whiteStrong}>＋ Νέα συναλλαγή</Text></Pressable><Pressable style={styles.secondaryQuick} onPress={() => setTab('transactions')}><Text style={styles.secondaryStrong}>Ιστορικό</Text></Pressable></View>
          <View style={styles.sectionRow}><View><Text style={styles.section}>Θέσεις</Text><Text style={styles.muted}>{positions.length} ενεργές θέσεις</Text></View></View>
          {positions.length ? positions.map((position) => <PositionCard key={position.symbol} item={position} compact={compactMetrics} expanded={expandedPosition === position.symbol} onToggle={() => setExpandedPosition((current) => current === position.symbol ? null : position.symbol)} onAlert={() => setAlertPosition(position)} />) : <View style={styles.emptyCard}><Text style={styles.emptyTitle}>Το χαρτοφυλάκιο είναι κενό.</Text><Text style={styles.note}>Πρόσθεσε αγορά σε τρία καθαρά βήματα. Τα δεδομένα μένουν μόνο στη συσκευή.</Text><Pressable style={styles.primary} onPress={openNewTransaction}><Text style={styles.whiteStrong}>Πρώτη συναλλαγή</Text></Pressable></View>}
        </> : null}
        {tab === 'transactions' ? <>
          <View style={styles.sectionRow}><View style={styles.grow}><Text style={styles.section}>Συναλλαγές</Text><Text style={styles.muted}>Αγορά, πώληση και πραγματικό κόστος</Text></View><Pressable style={styles.addSmall} onPress={openNewTransaction} accessibilityLabel="Προσθήκη συναλλαγής"><Text style={styles.addSmallText}>＋</Text></Pressable></View>
          <View style={styles.infoBox}><Text style={styles.infoTitle}>Η τιμή εντολής και η τιμή εκτέλεσης είναι πλέον χωριστές.</Text><Text style={styles.note}>Το χαρτοφυλάκιο υπολογίζεται από τη μέση εκτέλεση, την αξία συναλλαγής και τα πραγματικά έξοδα.</Text></View>
          {state.transactions.length ? [...state.transactions].sort((a, b) => String(b.date).localeCompare(String(a.date))).map((transaction) => <TransactionCard key={transaction.id} transaction={transaction} expanded={expandedTransaction === transaction.id} onToggle={() => setExpandedTransaction((current) => current === transaction.id ? null : transaction.id)} onEdit={() => { setEditingTransaction(transaction); setTransactionModal(true); }} onDelete={() => deleteTransaction(transaction)} />) : <View style={styles.emptyCard}><Text style={styles.emptyTitle}>Καμία συναλλαγή.</Text><Text style={styles.note}>Η εφαρμογή ξεκινά καθαρή για κάθε χρήστη.</Text></View>}
        </> : null}
        {tab === 'alerts' ? <>
          <Text style={styles.section}>Ειδοποιήσεις</Text>
          <View style={styles.card}><View style={styles.rowTop}><View style={styles.grow}><Text style={styles.cardTitle}>Άδεια συσκευής</Text><Text style={styles.muted}>Κατάσταση Android</Text></View><Text style={styles.statusStrong}>{notificationStatus === 'granted' ? 'Επιτρέπονται' : notificationStatus === 'denied' ? 'Απορρίφθηκαν' : 'Δεν ζητήθηκε'}</Text></View><View style={styles.actionRow}><Pressable style={styles.secondaryAction} onPress={requestNotificationPermission}><Text style={styles.secondaryStrong}>Ζήτηση άδειας</Text></Pressable><Pressable style={styles.primaryAction} onPress={async () => { const ok = await sendTestNotificationAsync(); setNotificationStatus(ok ? 'granted' : 'denied'); if (!ok) Alert.alert('Αποτυχία', 'Δεν υπάρχει άδεια ειδοποιήσεων.'); }}><Text style={styles.whiteStrong}>Δοκιμή</Text></Pressable></View></View>
          <View style={styles.card}><View style={styles.switchLine}><View style={styles.grow}><Text style={styles.cardTitle}>Έλεγχος στο παρασκήνιο</Text><Text style={styles.note}>Ενδεικτικός έλεγχος Android, όχι άμεσος χρηματιστηριακός συναγερμός.</Text></View><Switch value={state.alerts.backgroundEnabled && backgroundRegistered} onValueChange={toggleBackground} /></View><ReviewLine label="Ελάχιστο διάστημα" value="15 λεπτά, μη εγγυημένο" /></View>
          <Text style={styles.subsection}>Όρια ανά θέση</Text>
          {positions.map((position) => { const rule = getRule(state.alerts, position.symbol); return <View key={position.symbol} style={styles.card}><View style={styles.rowTop}><View><Text style={styles.cardTitle}>{position.symbol}</Text><Text style={styles.muted}>{position.company}</Text></View><View style={styles.badge}><Text style={styles.badgeText}>{rule.enabled ? 'Ενεργό' : 'Ανενεργό'}</Text></View></View><Text style={styles.note}>Τρέχουσα: {quotePrice(position.nativePrice, position.currency)}</Text><View style={styles.grid}><Metric compact label="Πάνω από" value={rule.above ? quotePrice(rule.above, position.currency) : '—'} /><Metric compact label="Κάτω από" value={rule.below ? quotePrice(rule.below, position.currency) : '—'} /></View><Text style={styles.note}>Ημερήσια μεταβολή: {rule.dailyPct ? `±${rule.dailyPct}%` : '—'}</Text><Pressable style={styles.secondaryActionFull} onPress={() => setAlertPosition(position)}><Text style={styles.secondaryStrong}>Ρύθμιση ορίων</Text></Pressable></View>; })}
          {!positions.length ? <View style={styles.emptyCard}><Text style={styles.emptyTitle}>Δεν υπάρχουν θέσεις για παρακολούθηση.</Text></View> : null}
          <View style={styles.sectionRow}><Text style={styles.subsection}>Ιστορικό</Text>{state.alerts.history.length ? <Pressable onPress={() => persist({ ...stateRef.current, alerts: { ...stateRef.current.alerts, history: [] } })}><Text style={styles.link}>Καθαρισμός</Text></Pressable> : null}</View>
          {state.alerts.history.length ? state.alerts.history.map((event) => <View key={event.id} style={styles.historyItem}><Text style={styles.statusStrong}>{event.symbol}</Text><Text style={styles.note}>{event.message}</Text><Text style={styles.source}>{when(event.triggeredAt)}</Text></View>) : <View style={styles.emptyCard}><Text style={styles.emptyTitle}>Καμία ενεργοποίηση.</Text><Text style={styles.note}>Οι ειδοποιήσεις που πυροδοτούνται θα καταγράφονται εδώ.</Text></View>}
        </> : null}
        {tab === 'settings' ? <>
          <Text style={styles.section}>Ρυθμίσεις</Text>
          <View style={styles.card}><Text style={styles.cardTitle}>Ιδιωτικότητα δεδομένων</Text><Text style={styles.note}>Συναλλαγές, όρια και ιστορικό αποθηκεύονται μόνο στη συγκεκριμένη συσκευή. Δεν υπάρχει κοινός λογαριασμός ή πρόσβαση διαχειριστή.</Text><ReviewLine label="Αποθήκευση" value="Μόνο στη συσκευή" /><ReviewLine label="Cloud συγχρονισμός" value="Ανενεργός" /></View>
          <View style={styles.card}><Text style={styles.cardTitle}>Ακρίβεια συναλλαγών</Text><Text style={styles.note}>Κάθε συναλλαγή κρατά χωριστά τιμή εντολής, μέση τιμή εκτέλεσης, αξία συναλλαγής, αναλυτικά έξοδα και τελικό κόστος.</Text><ReviewLine label="Λογιστικό μοντέλο" value="v2 ενεργό" /><ReviewLine label="Σχήμα δεδομένων" value="v5" /></View>
          <View style={styles.card}><Text style={styles.cardTitle}>Αντίγραφο ασφαλείας</Text><Text style={styles.note}>Το JSON περιλαμβάνει συναλλαγές και όρια. Δεν περιλαμβάνει το Finnhub token.</Text><Pressable style={styles.primary} onPress={exportBackup}><Text style={styles.whiteStrong}>Εξαγωγή αντιγράφου JSON</Text></Pressable><Pressable style={styles.secondaryActionFull} onPress={importBackup}><Text style={styles.secondaryStrong}>Επαναφορά από JSON</Text></Pressable></View>
          <View style={styles.card}><Text style={styles.cardTitle}>Πηγές τιμών</Text><Text style={styles.note}>Allwyn: επίσημη Euronext Athens με καθυστέρηση. Αμερικανικές μετοχές: Finnhub real-time με προσωπικό token, διαφορετικά εφεδρική πηγή.</Text><Field label="Finnhub API token" value={token} onChangeText={setToken} autoCapitalize="none" placeholder="Επικόλλησε το προσωπικό token" /><Pressable style={styles.primary} onPress={saveToken}><Text style={styles.whiteStrong}>Αποθήκευση token</Text></Pressable></View>
          <View style={styles.card}><Text style={styles.cardTitle}>Τοπικά δεδομένα</Text><Text style={styles.note}>Η διαγραφή αφορά μόνο αυτή τη συσκευή και δεν αναιρείται.</Text><Pressable style={styles.dangerActionFull} onPress={resetLocalData}><Text style={styles.dangerStrong}>Διαγραφή όλων των τοπικών δεδομένων</Text></Pressable></View>
        </> : null}
      </ScrollView>
      <View style={styles.nav}>{[['summary', '⌂', 'Σύνοψη'], ['transactions', '⇄', 'Συναλλαγές'], ['alerts', '!', 'Ειδοπ.'], ['settings', '⚙', 'Ρυθμίσεις']].map(([key, icon, label]) => <Pressable key={key} style={[styles.navItem, tab === key && styles.navItemOn]} onPress={() => setTab(key)}><Text style={[styles.navIcon, tab === key && styles.navTextOn]}>{icon}</Text><Text style={[styles.navText, tab === key && styles.navTextOn]}>{label}</Text></Pressable>)}</View>
      <TransactionModal visible={transactionModal} transaction={editingTransaction} onClose={() => { setTransactionModal(false); setEditingTransaction(null); }} onSave={saveTransaction} />
      <AlertRuleModal visible={Boolean(alertPosition)} position={alertPosition} rule={alertPosition ? getRule(state.alerts, alertPosition.symbol) : null} onClose={() => setAlertPosition(null)} onSave={saveAlertRule} />
    </View></SafeAreaView>
  );
}

export default function PortfolioApp() {
  return <SafeAreaProvider initialMetrics={initialWindowMetrics}><MainApp /></SafeAreaProvider>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#eef5ff' }, app: { flex: 1 }, scroll: { flex: 1 }, content: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 112 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, backgroundColor: '#eef5ff' }, eyebrow: { color: '#0B66FF', fontSize: 14, fontWeight: '900', letterSpacing: 1.7, marginBottom: 12 },
  title: { color: '#16345f', fontSize: 36, lineHeight: 41, fontWeight: '900' }, titleCompact: { fontSize: 31 }, versionLine: { color: '#718096', marginTop: 4, fontWeight: '700' }, rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }, grow: { flex: 1, minWidth: 0 },
  plus: { width: 58, height: 58, borderRadius: 20, borderWidth: 1, borderColor: '#cfdae9', backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }, plusText: { color: '#16345f', fontSize: 42, lineHeight: 46, fontWeight: '300' },
  refreshCard: { marginTop: 24, backgroundColor: '#fff', borderRadius: 24, borderWidth: 1, borderColor: '#d5dfec', padding: 18, flexDirection: 'row', alignItems: 'center', gap: 14 }, checked: { color: '#16345f', fontWeight: '900', fontSize: 20, marginTop: 4 }, muted: { color: '#7b889d', fontSize: 15, lineHeight: 22 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10, marginTop: 12 }, metric: { width: '48.5%', minHeight: 102, borderRadius: 20, borderWidth: 1, borderColor: '#d5dfec', backgroundColor: '#fff', padding: 14, justifyContent: 'space-between' }, metricCompact: { paddingHorizontal: 11 }, metricValue: { color: '#16345f', fontSize: 21, lineHeight: 26, fontWeight: '900', marginTop: 9 }, red: { color: '#d83b4d' }, green: { color: '#078548' },
  warning: { color: '#a66700', backgroundColor: '#fff6df', borderRadius: 14, padding: 12, marginTop: 12, lineHeight: 21, fontWeight: '700' }, quickActions: { flexDirection: 'row', gap: 12, marginTop: 18 }, primaryQuick: { flex: 1.35, minHeight: 54, backgroundColor: '#0B66FF', borderRadius: 17, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 }, secondaryQuick: { flex: 0.75, minHeight: 54, backgroundColor: '#fff', borderRadius: 17, borderWidth: 1, borderColor: '#d3deeb', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  sectionRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10, marginTop: 22, marginBottom: 12 }, section: { color: '#16345f', fontSize: 28, lineHeight: 34, fontWeight: '900', marginTop: 22, marginBottom: 12 }, subsection: { color: '#16345f', fontSize: 22, fontWeight: '900', marginTop: 20, marginBottom: 10 },
  card: { backgroundColor: '#fff', borderRadius: 22, borderWidth: 1, borderColor: '#d4deeb', padding: 17, marginBottom: 12 }, cardTitle: { color: '#16345f', fontSize: 21, lineHeight: 26, fontWeight: '900' }, badge: { backgroundColor: '#edf4ff', paddingHorizontal: 13, paddingVertical: 9, borderRadius: 18 }, badgeText: { color: '#0B66FF', fontWeight: '900', fontSize: 13 }, badgeBad: { backgroundColor: '#fff0f2' }, badgeBadText: { color: '#d83b4d' },
  priceRow: { flexDirection: 'row', alignItems: 'flex-end', marginTop: 18, gap: 10 }, big: { color: '#16345f', fontSize: 39, lineHeight: 45, fontWeight: '900', marginTop: 2 }, change: { fontSize: 21, fontWeight: '900', paddingBottom: 7 }, note: { color: '#67768c', fontSize: 15, lineHeight: 23, marginTop: 10 }, source: { color: '#8591a3', fontSize: 13, lineHeight: 20, marginTop: 10 }, tapHint: { color: '#0B66FF', fontWeight: '800', marginTop: 15, fontSize: 13 }, detailPanel: { borderTopWidth: 1, borderTopColor: '#e5ebf3', marginTop: 16, paddingTop: 14 },
  emptyCard: { backgroundColor: '#fff', borderRadius: 24, borderWidth: 1, borderStyle: 'dashed', borderColor: '#cbd7e6', padding: 22, marginBottom: 14 }, emptyTitle: { color: '#16345f', fontSize: 21, fontWeight: '900' }, infoBox: { backgroundColor: '#eaf3ff', borderRadius: 18, padding: 15, marginBottom: 14 }, infoTitle: { color: '#16345f', fontWeight: '900', fontSize: 16, lineHeight: 22 },
  addSmall: { width: 52, height: 52, flexShrink: 0, backgroundColor: '#0B66FF', borderRadius: 17, alignItems: 'center', justifyContent: 'center' }, addSmallText: { color: '#fff', fontSize: 29, lineHeight: 32, fontWeight: '500' }, primarySmall: { minWidth: 104, height: 50, backgroundColor: '#0B66FF', borderRadius: 17, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 15 }, primary: { minHeight: 56, backgroundColor: '#0B66FF', borderRadius: 18, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, marginTop: 12 }, disabled: { opacity: 0.55 }, whiteStrong: { color: '#fff', fontWeight: '900', fontSize: 16 }, secondaryStrong: { color: '#16345f', fontWeight: '900', fontSize: 15 }, dangerStrong: { color: '#cf3348', fontWeight: '900', fontSize: 15 },
  txTitle: { color: '#16345f', fontSize: 19, lineHeight: 24, fontWeight: '900' }, txAmount: { color: '#16345f', fontSize: 18, fontWeight: '900', maxWidth: '42%' }, successNote: { color: '#087846', backgroundColor: '#e8f8ef', borderRadius: 14, padding: 12, marginTop: 12, fontWeight: '800', lineHeight: 20 }, reviewLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 16, borderBottomWidth: 1, borderBottomColor: '#e6ecf3', paddingVertical: 12 }, statusStrong: { color: '#16345f', fontWeight: '900', textAlign: 'right' }, reviewStrong: { color: '#0B66FF', fontWeight: '900', fontSize: 18, textAlign: 'right' },
  actionRow: { flexDirection: 'row', gap: 10, marginTop: 14 }, primaryAction: { flex: 1, minHeight: 54, borderRadius: 17, backgroundColor: '#0B66FF', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 }, secondaryAction: { flex: 1, minHeight: 54, borderRadius: 17, backgroundColor: '#fff', borderWidth: 1, borderColor: '#ccd8e7', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 }, dangerAction: { flex: 1, minHeight: 54, borderRadius: 17, backgroundColor: '#fff0f2', borderWidth: 1, borderColor: '#f1c5cc', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 }, secondaryActionFull: { minHeight: 53, borderRadius: 17, backgroundColor: '#fff', borderWidth: 1, borderColor: '#ccd8e7', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, marginTop: 14 }, dangerActionFull: { minHeight: 56, borderRadius: 18, backgroundColor: '#fff0f2', borderWidth: 1, borderColor: '#f1c5cc', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, marginTop: 14 },
  historyItem: { backgroundColor: '#fff', borderRadius: 20, borderWidth: 1, borderColor: '#d4deeb', padding: 16, marginBottom: 10 }, switchLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 14 }, nav: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 78, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#dbe3ee', flexDirection: 'row', paddingHorizontal: 6, paddingTop: 6, paddingBottom: 6 }, navItem: { flex: 1, borderRadius: 18, alignItems: 'center', justifyContent: 'center', paddingVertical: 5 }, navItemOn: { backgroundColor: '#edf4ff' }, navIcon: { color: '#66758a', fontSize: 21, fontWeight: '900' }, navText: { color: '#66758a', fontSize: 11, lineHeight: 14, marginTop: 1, fontWeight: '800' }, navTextOn: { color: '#0B66FF' },
  overlay: { flex: 1, backgroundColor: 'rgba(10, 25, 50, 0.45)', justifyContent: 'flex-end' }, keyboardLayer: { flex: 1, width: '100%', justifyContent: 'flex-end', paddingTop: Platform.OS === 'android' ? 10 : 0 }, sheet: { maxHeight: '94%', backgroundColor: '#f8fbff', borderTopLeftRadius: 28, borderTopRightRadius: 28, overflow: 'hidden' }, form: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: Platform.OS === 'android' ? 72 : 42 }, sheetTitle: { color: '#16345f', fontSize: 27, lineHeight: 33, fontWeight: '900' }, link: { color: '#0B66FF', fontWeight: '900', fontSize: 16 }, progressRow: { flexDirection: 'row', gap: 7, marginVertical: 18 }, progressBar: { flex: 1, height: 5, borderRadius: 4, backgroundColor: '#dce5f0' }, progressBarOn: { backgroundColor: '#0B66FF' }, formSection: { color: '#16345f', fontWeight: '900', fontSize: 21, marginBottom: 12 },
  field: { marginBottom: 15 }, fieldLabel: { color: '#233d63', fontSize: 15, fontWeight: '900', marginBottom: 7 }, fieldHelper: { color: '#7b889d', fontSize: 12, lineHeight: 17, marginTop: -3, marginBottom: 7 }, input: { minHeight: 55, borderRadius: 17, borderWidth: 1, borderColor: '#ccd7e5', backgroundColor: '#fff', paddingHorizontal: 16, color: '#16345f', fontSize: 17 }, inputMultiline: { minHeight: 105, paddingTop: 14 }, segmentRow: { flexDirection: 'row', gap: 10, marginBottom: 15 }, segment: { flex: 1, minHeight: 52, borderRadius: 17, borderWidth: 1, borderColor: '#ccd7e5', backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }, segmentOn: { backgroundColor: '#0B66FF', borderColor: '#0B66FF' }, segmentText: { color: '#16345f', fontWeight: '900' }, twoColumns: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }, halfField: { width: '48.5%' }, reviewCard: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#d5dfec', borderRadius: 20, padding: 15, marginTop: 5 }, reviewTitle: { color: '#16345f', fontSize: 20, fontWeight: '900', marginBottom: 4 }, modalActions: { flexDirection: 'row', gap: 10, marginTop: 14, marginBottom: 8 }, actionFull: { flex: 1 },
});
