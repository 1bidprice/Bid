import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  AppState,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { STORAGE_KEY } from './src/background-alert-task';
import {
  DECISION_FORMAT,
  DECISION_SETTINGS_KEY,
  DECISION_STORAGE_KEY,
  DECISION_VERSION,
  DEFAULT_DECISION_SETTINGS,
  decisionSummary,
  evaluateDecision,
  nextReviewDate,
  normalizeDecisionSettings,
  normalizePlans,
  portfolioSnapshot,
} from './src/decision-engine';

const VERSION = '0.6.1';
const SUPPORTED_BACKUP_VERSIONS = [1, DECISION_VERSION];

const parseNum = (value) => {
  const raw = String(value ?? '').trim();
  if (!raw) return 0;
  const normalized = raw.includes(',')
    ? raw.replace(/\./g, '').replace(',', '.')
    : raw;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : 0;
};

const money = (value) => Number.isFinite(Number(value))
  ? new Intl.NumberFormat('el-GR', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number(value))
  : '—';

const nativePrice = (value, currency) => Number.isFinite(Number(value))
  ? new Intl.NumberFormat('el-GR', {
      style: 'currency',
      currency: currency || 'EUR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 3,
    }).format(Number(value))
  : '—';

const percent = (value, digits = 1) => Number.isFinite(Number(value))
  ? `${Number(value).toFixed(digits)}%`
  : '—';

const dateLabel = (iso) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ''))) return '—';
  const [year, month, day] = iso.split('-');
  return `${day}/${month}/${year}`;
};

const emptyForm = (plan, settings) => ({
  thesis: plan?.thesis || '',
  stop: plan?.stop ? String(plan.stop) : '',
  target: plan?.target ? String(plan.target) : '',
  proposedAmountEUR: plan?.proposedAmountEUR ? String(plan.proposedAmountEUR) : '',
  reviewDate: plan?.reviewDate || nextReviewDate(settings.reviewDays),
});

const settingsFormFrom = (settings) => ({
  maxAllocationPct: String(settings.maxAllocationPct),
  maxRiskPct: String(settings.maxRiskPct),
  reviewDays: String(settings.reviewDays),
});

const legacySettingsFromPlans = (rawPlans) => {
  if (!rawPlans || typeof rawPlans !== 'object' || Array.isArray(rawPlans)) return {};
  const candidates = Object.values(rawPlans).filter((plan) => plan && typeof plan === 'object');
  return {
    maxAllocationPct: candidates.find((plan) => parseNum(plan.maxAllocationPct))?.maxAllocationPct,
    maxRiskPct: candidates.find((plan) => parseNum(plan.maxRiskPct))?.maxRiskPct,
  };
};

function StatusPill({ status, label }) {
  return (
    <View style={[
      styles.pill,
      status === 'ready' && styles.pillReady,
      status === 'caution' && styles.pillCaution,
      status === 'blocked' && styles.pillBlocked,
    ]}>
      <Text style={[
        styles.pillText,
        status === 'ready' && styles.pillTextReady,
        status === 'caution' && styles.pillTextCaution,
        status === 'blocked' && styles.pillTextBlocked,
      ]}>{label}</Text>
    </View>
  );
}

function Field({ label, value, onChangeText, placeholder, keyboardType = 'default', multiline = false, helper }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, multiline && styles.textarea]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#98a5b8"
        keyboardType={keyboardType}
        multiline={multiline}
        textAlignVertical={multiline ? 'top' : 'center'}
        autoCapitalize={multiline ? 'sentences' : 'none'}
      />
      {helper ? <Text style={styles.helper}>{helper}</Text> : null}
    </View>
  );
}

function Metric({ label, value, danger }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, danger && styles.red]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
        {value}
      </Text>
    </View>
  );
}

export default function DecisionOverlay() {
  const [visible, setVisible] = useState(false);
  const [screen, setScreen] = useState('list');
  const [portfolioState, setPortfolioState] = useState({ transactions: [], prices: {} });
  const [plans, setPlans] = useState({});
  const [settings, setSettings] = useState(DEFAULT_DECISION_SETTINGS);
  const [settingsForm, setSettingsForm] = useState(settingsFormFrom(DEFAULT_DECISION_SETTINGS));
  const [selectedSymbol, setSelectedSymbol] = useState(null);
  const [form, setForm] = useState(emptyForm(null, DEFAULT_DECISION_SETTINGS));

  const load = useCallback(async () => {
    const [portfolioRaw, plansRaw, settingsRaw] = await Promise.all([
      AsyncStorage.getItem(STORAGE_KEY),
      AsyncStorage.getItem(DECISION_STORAGE_KEY),
      AsyncStorage.getItem(DECISION_SETTINGS_KEY),
    ]);

    try {
      setPortfolioState(portfolioRaw ? JSON.parse(portfolioRaw) : { transactions: [], prices: {} });
    } catch {
      setPortfolioState({ transactions: [], prices: {} });
    }

    let parsedPlans = {};
    try {
      parsedPlans = plansRaw ? JSON.parse(plansRaw) : {};
      setPlans(normalizePlans(parsedPlans));
    } catch {
      parsedPlans = {};
      setPlans({});
    }

    let nextSettings;
    try {
      nextSettings = settingsRaw
        ? normalizeDecisionSettings(JSON.parse(settingsRaw))
        : normalizeDecisionSettings(legacySettingsFromPlans(parsedPlans));
    } catch {
      nextSettings = normalizeDecisionSettings(legacySettingsFromPlans(parsedPlans));
    }
    setSettings(nextSettings);
    setSettingsForm(settingsFormFrom(nextSettings));
  }, []);

  useEffect(() => {
    load();
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') load();
    });
    return () => subscription.remove();
  }, [load]);

  const snapshot = useMemo(() => portfolioSnapshot(portfolioState), [portfolioState]);
  const rows = useMemo(
    () => decisionSummary(snapshot.positions, plans, snapshot.totalValueEUR, settings),
    [snapshot, plans, settings],
  );
  const selectedPosition = snapshot.positions.find((position) => position.symbol === selectedSymbol) || null;
  const formPlan = selectedPosition ? {
    symbol: selectedPosition.symbol,
    thesis: form.thesis,
    stop: parseNum(form.stop) || null,
    target: parseNum(form.target) || null,
    reviewDate: form.reviewDate || nextReviewDate(settings.reviewDays),
    proposedAmountEUR: parseNum(form.proposedAmountEUR),
  } : {};
  const liveResult = selectedPosition
    ? evaluateDecision(selectedPosition, formPlan, snapshot.totalValueEUR, settings)
    : null;

  const counts = rows.reduce((acc, row) => {
    acc[row.result.status] += 1;
    return acc;
  }, { ready: 0, caution: 0, blocked: 0 });

  const open = async () => {
    await load();
    setScreen('list');
    setSelectedSymbol(null);
    setVisible(true);
  };

  const close = () => {
    setVisible(false);
    setScreen('list');
    setSelectedSymbol(null);
  };

  const goBack = () => {
    if (screen === 'list') close();
    else setScreen('list');
  };

  const edit = (position) => {
    const plan = plans[position.symbol] || null;
    setSelectedSymbol(position.symbol);
    setForm(emptyForm(plan, settings));
    setScreen('editor');
  };

  const openRules = () => {
    setSettingsForm(settingsFormFrom(settings));
    setScreen('settings');
  };

  const persistPlans = async (next) => {
    const normalized = normalizePlans(next);
    setPlans(normalized);
    await AsyncStorage.setItem(DECISION_STORAGE_KEY, JSON.stringify(normalized));
  };

  const persistSettings = async (next) => {
    const normalized = normalizeDecisionSettings(next);
    setSettings(normalized);
    setSettingsForm(settingsFormFrom(normalized));
    await AsyncStorage.setItem(DECISION_SETTINGS_KEY, JSON.stringify(normalized));
  };

  const save = async () => {
    if (!selectedPosition) return;
    const next = {
      ...plans,
      [selectedPosition.symbol]: {
        ...formPlan,
        reviewDate: formPlan.reviewDate || nextReviewDate(settings.reviewDays),
        updatedAt: new Date().toISOString(),
      },
    };
    await persistPlans(next);
    Alert.alert('Αποθηκεύτηκε', liveResult?.status === 'ready'
      ? 'Το επενδυτικό πλάνο περνάει τους σημερινούς ελέγχους.'
      : 'Το πλάνο αποθηκεύτηκε. Οι αδυναμίες παραμένουν ορατές μέχρι να διορθωθούν.');
  };

  const saveRules = async () => {
    const maxAllocationPct = parseNum(settingsForm.maxAllocationPct);
    const maxRiskPct = parseNum(settingsForm.maxRiskPct);
    const reviewDays = Math.round(parseNum(settingsForm.reviewDays));
    if (maxAllocationPct < 1 || maxAllocationPct > 100) {
      Alert.alert('Μη έγκυρο όριο', 'Το μέγιστο βάρος θέσης πρέπει να είναι από 1% έως 100%.');
      return;
    }
    if (maxRiskPct < 0.1 || maxRiskPct > 100) {
      Alert.alert('Μη έγκυρο όριο', 'Ο μέγιστος κίνδυνος πρέπει να είναι από 0,1% έως 100%.');
      return;
    }
    if (reviewDays < 7 || reviewDays > 3650) {
      Alert.alert('Μη έγκυρο διάστημα', 'Η αυτόματη επανεξέταση πρέπει να είναι από 7 έως 3.650 ημέρες.');
      return;
    }
    await persistSettings({ maxAllocationPct, maxRiskPct, reviewDays });
    setScreen('list');
    Alert.alert('Οι κανόνες αποθηκεύτηκαν', 'Ισχύουν πλέον για όλες τις θέσεις. Δεν χρειάζεται να τους ξαναγράφεις.');
  };

  const exportPlans = async () => {
    try {
      const payload = {
        format: DECISION_FORMAT,
        version: DECISION_VERSION,
        appVersion: VERSION,
        exportedAt: new Date().toISOString(),
        settings,
        plans,
      };
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const uri = `${FileSystem.cacheDirectory}investor-control-decision-os-${stamp}.json`;
      await FileSystem.writeAsStringAsync(uri, JSON.stringify(payload, null, 2), {
        encoding: FileSystem.EncodingType.UTF8,
      });
      if (!await Sharing.isAvailableAsync()) throw new Error('Η κοινή χρήση αρχείων δεν είναι διαθέσιμη.');
      await Sharing.shareAsync(uri, {
        mimeType: 'application/json',
        dialogTitle: 'Αποθήκευση επενδυτικών πλάνων',
      });
    } catch (error) {
      Alert.alert('Εξαγωγή πλάνων', error.message);
    }
  };

  const importPlans = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/json', 'text/json', 'text/plain'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (!asset?.uri) throw new Error('Δεν επιλέχθηκε αρχείο.');
      const text = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.UTF8 });
      const payload = JSON.parse(text);
      if (payload?.format !== DECISION_FORMAT || !SUPPORTED_BACKUP_VERSIONS.includes(Number(payload?.version))) {
        throw new Error('Το αρχείο δεν είναι έγκυρο αντίγραφο Decision OS.');
      }
      const incoming = normalizePlans(payload.plans);
      const importedSettings = payload.settings
        ? normalizeDecisionSettings(payload.settings)
        : normalizeDecisionSettings(legacySettingsFromPlans(payload.plans));
      Alert.alert('Εισαγωγή πλάνων', `Θα προστεθούν ή θα αντικατασταθούν ${Object.keys(incoming).length} πλάνα.`, [
        { text: 'Άκυρο', style: 'cancel' },
        {
          text: 'Συνέχεια',
          onPress: async () => {
            await persistPlans({ ...plans, ...incoming });
            if (payload.settings || Number(payload.version) === 1) await persistSettings(importedSettings);
          },
        },
      ]);
    } catch (error) {
      Alert.alert('Εισαγωγή πλάνων', error.message);
    }
  };

  return (
    <>
      <Pressable style={styles.fab} onPress={open} accessibilityLabel="Άνοιγμα Decision Gate" accessibilityHint="Έλεγχος επενδυτικής απόφασης">
        <Text style={styles.fabTop}>✓</Text>
      </Pressable>

      <Modal visible={visible} animationType="slide" onRequestClose={goBack} statusBarTranslucent={false}>
        <SafeAreaView style={styles.safe}>
          <View style={styles.header}>
            <Pressable onPress={goBack} hitSlop={12}>
              <Text style={styles.headerAction}>{screen === 'list' ? 'Κλείσιμο' : '‹ Πίσω'}</Text>
            </Pressable>
            <View style={styles.headerCenter}>
              <Text style={styles.headerTitle}>Decision Gate</Text>
              <Text style={styles.headerVersion}>Investment Decision OS · v{VERSION}</Text>
            </View>
            <View style={styles.headerSpacer} />
          </View>

          {screen === 'list' ? (
            <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
              <View style={styles.hero}>
                <Text style={styles.heroEyebrow}>ΠΡΙΝ ΑΓΟΡΑΣΕΙΣ Ή ΕΝΙΣΧΥΣΕΙΣ</Text>
                <Text style={styles.heroTitle}>Τρία στοιχεία. Καμία αγορά στα τυφλά.</Text>
                <Text style={styles.heroText}>Εσύ δηλώνεις μόνο αιτιολόγηση, τιμή ακύρωσης και στόχο. Η εφαρμογή αναλαμβάνει όλους τους υπολογισμούς.</Text>
              </View>

              <View style={styles.grid}>
                <Metric label="Περνούν" value={String(counts.ready)} />
                <Metric label="Προσοχή" value={String(counts.caution)} danger={counts.caution > 0} />
                <Metric label="Μπλοκαρισμένες" value={String(counts.blocked)} danger={counts.blocked > 0} />
                <Metric label="Χαρτοφυλάκιο" value={money(snapshot.totalValueEUR)} />
              </View>

              <View style={styles.card}>
                <View style={styles.rowTop}>
                  <View style={styles.grow}>
                    <Text style={styles.cardTitle}>Κανόνες χαρτοφυλακίου</Text>
                    <Text style={styles.muted}>Ορίζονται μία φορά και εφαρμόζονται αυτόματα σε όλες τις θέσεις.</Text>
                  </View>
                  <StatusPill status="ready" label="ΕΝΕΡΓΟΙ" />
                </View>
                <View style={styles.miniGrid}>
                  <View style={styles.miniCell}><Text style={styles.muted}>Μέγιστο βάρος</Text><Text style={styles.miniValue}>{percent(settings.maxAllocationPct)}</Text></View>
                  <View style={styles.miniCell}><Text style={styles.muted}>Μέγιστος κίνδυνος</Text><Text style={styles.miniValue}>{percent(settings.maxRiskPct)}</Text></View>
                  <View style={styles.miniCellWide}><Text style={styles.muted}>Αυτόματη επανεξέταση</Text><Text style={styles.miniValue}>Κάθε {settings.reviewDays} ημέρες</Text></View>
                </View>
                <Pressable style={styles.secondary} onPress={openRules}><Text style={styles.secondaryText}>Αλλαγή γενικών κανόνων</Text></Pressable>
              </View>

              <Text style={styles.sectionTitle}>Έλεγχος ανά θέση</Text>
              {rows.length ? rows.map(({ position, result }) => (
                <View key={position.symbol} style={styles.card}>
                  <View style={styles.rowTop}>
                    <View style={styles.grow}>
                      <Text style={styles.cardTitle}>{position.company}</Text>
                      <Text style={styles.muted}>{position.symbol} · {position.quantity.toLocaleString('el-GR')} μετοχές</Text>
                    </View>
                    <StatusPill status={result.status} label={result.label} />
                  </View>
                  <View style={styles.scoreRow}>
                    <Text style={styles.score}>{result.score}/100</Text>
                    <Text style={styles.muted}>Βαθμός πειθαρχίας</Text>
                  </View>
                  <View style={styles.miniGrid}>
                    <View style={styles.miniCell}><Text style={styles.muted}>Βάρος θέσης</Text><Text style={styles.miniValue}>{percent(result.currentWeightPct)}</Text></View>
                    <View style={styles.miniCell}><Text style={styles.muted}>Απόδοση / κίνδυνος</Text><Text style={styles.miniValue}>{result.rewardRisk ? result.rewardRisk.toFixed(2) : '—'}</Text></View>
                    <View style={styles.miniCellWide}><Text style={styles.muted}>Κεφάλαιο σε κίνδυνο</Text><Text style={styles.miniValue}>{money(result.currentRiskEUR)}</Text></View>
                  </View>
                  {result.issues.length ? (
                    <Text style={styles.issuePreview}>{result.issues[0].message}{result.issues.length > 1 ? `  +${result.issues.length - 1} ακόμη` : ''}</Text>
                  ) : <Text style={styles.readyText}>Το πλάνο είναι πλήρες και δεν παραβιάζει τα σημερινά όρια.</Text>}
                  <Pressable style={styles.primary} onPress={() => edit(position)}>
                    <Text style={styles.primaryText}>{plans[position.symbol] ? 'Έλεγχος / επεξεργασία πλάνου' : 'Δημιουργία γρήγορου πλάνου'}</Text>
                  </Pressable>
                </View>
              )) : (
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>Δεν υπάρχουν ενεργές θέσεις.</Text>
                  <Text style={styles.heroText}>Καταχώρισε πρώτα μία αγορά στο Investor Control. Το Decision Gate θα τη βρει αυτόματα.</Text>
                </View>
              )}

              <View style={styles.card}>
                <Text style={styles.cardTitle}>Αντίγραφο στρατηγικής</Text>
                <Text style={styles.heroText}>Τα πλάνα και οι γενικοί κανόνες αποθηκεύονται μόνο στη συσκευή. Εξήγαγέ τα πριν αλλάξεις κινητό.</Text>
                <Pressable style={styles.primary} onPress={exportPlans}><Text style={styles.primaryText}>Εξαγωγή πλάνων JSON</Text></Pressable>
                <Pressable style={styles.secondary} onPress={importPlans}><Text style={styles.secondaryText}>Εισαγωγή πλάνων JSON</Text></Pressable>
              </View>
            </ScrollView>
          ) : null}

          {screen === 'editor' && selectedPosition && liveResult ? (
            <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
              <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                <View style={styles.card}>
                  <View style={styles.rowTop}>
                    <View style={styles.grow}>
                      <Text style={styles.cardTitle}>{selectedPosition.company}</Text>
                      <Text style={styles.muted}>{selectedPosition.symbol} · τρέχουσα {nativePrice(selectedPosition.nativePrice, selectedPosition.currency)}</Text>
                    </View>
                    <StatusPill status={liveResult.status} label={liveResult.label} />
                  </View>
                  <Text style={styles.scoreLarge}>{liveResult.score}/100</Text>
                  <Text style={styles.muted}>Ο βαθμός αλλάζει ζωντανά όσο συμπληρώνεις τα τρία υποχρεωτικά στοιχεία.</Text>
                </View>

                <Field
                  label="1. Γιατί υπάρχει αυτή η επένδυση;"
                  value={form.thesis}
                  onChangeText={(value) => setForm((x) => ({ ...x, thesis: value }))}
                  placeholder="Συγκεκριμένη επενδυτική θέση, όχι ‘πιστεύω ότι θα ανέβει’."
                  multiline
                />

                <View style={styles.twoColumns}>
                  <View style={styles.column}>
                    <Field
                      label={`2. Τιμή ακύρωσης (${selectedPosition.currency})`}
                      value={form.stop}
                      onChangeText={(value) => setForm((x) => ({ ...x, stop: value }))}
                      placeholder="Stop"
                      keyboardType="decimal-pad"
                    />
                  </View>
                  <View style={styles.column}>
                    <Field
                      label={`3. Στόχος (${selectedPosition.currency})`}
                      value={form.target}
                      onChangeText={(value) => setForm((x) => ({ ...x, target: value }))}
                      placeholder="Target"
                      keyboardType="decimal-pad"
                    />
                  </View>
                </View>

                <Field
                  label="Προαιρετικά: ποσό νέας αγοράς (€)"
                  value={form.proposedAmountEUR}
                  onChangeText={(value) => setForm((x) => ({ ...x, proposedAmountEUR: value }))}
                  placeholder="0 για κανένα νέο κεφάλαιο"
                  keyboardType="decimal-pad"
                  helper="Χρησιμοποιείται μόνο για να υπολογιστεί το νέο βάρος και το νέο κεφάλαιο σε κίνδυνο."
                />

                <View style={styles.autoCard}>
                  <Text style={styles.autoTitle}>Συμπληρώνονται αυτόματα</Text>
                  <Text style={styles.autoText}>Επανεξέταση: {dateLabel(form.reviewDate)}</Text>
                  <Text style={styles.autoText}>Όριο θέσης: {percent(settings.maxAllocationPct)} · όριο κινδύνου: {percent(settings.maxRiskPct)}</Text>
                  <Text style={styles.autoText}>Τιμή, βάρος, κίνδυνος, απόδοση/κίνδυνος και ετυμηγορία υπολογίζονται από την εφαρμογή.</Text>
                </View>

                <View style={styles.grid}>
                  <Metric label="Τωρινό βάρος" value={percent(liveResult.currentWeightPct)} />
                  <Metric label="Με τη νέα αγορά" value={percent(liveResult.projectedWeightPct)} danger={liveResult.blocking.some((x) => x.code === 'allocation-over')} />
                  <Metric label="Κίνδυνος μετά" value={money(liveResult.projectedRiskEUR)} danger={liveResult.blocking.some((x) => x.code === 'risk-over')} />
                  <Metric label="Απόδοση / κίνδυνος" value={liveResult.rewardRisk ? liveResult.rewardRisk.toFixed(2) : '—'} danger={liveResult.rewardRisk !== null && liveResult.rewardRisk < 2} />
                </View>

                <View style={styles.card}>
                  <View style={styles.rowTop}>
                    <Text style={styles.cardTitle}>Ετυμηγορία</Text>
                    <StatusPill status={liveResult.status} label={liveResult.label} />
                  </View>
                  {liveResult.issues.length ? liveResult.issues.map((item) => (
                    <View key={item.code} style={[styles.issue, item.severity === 'block' && styles.issueBlock]}>
                      <Text style={[styles.issueMark, item.severity === 'block' && styles.issueMarkBlock]}>{item.severity === 'block' ? '×' : '!'}</Text>
                      <Text style={styles.issueText}>{item.message}</Text>
                    </View>
                  )) : <Text style={styles.readyText}>Το σχέδιο περνάει όλους τους σημερινούς ελέγχους. Αυτό δεν εγγυάται κέρδος· εγγυάται ότι τουλάχιστον δεν αγοράζεις στα τυφλά.</Text>}
                </View>

                <Pressable style={styles.primary} onPress={save}><Text style={styles.primaryText}>Αποθήκευση επενδυτικού πλάνου</Text></Pressable>
                <Pressable style={styles.secondary} onPress={() => setScreen('list')}><Text style={styles.secondaryText}>Επιστροφή στον έλεγχο</Text></Pressable>
              </ScrollView>
            </KeyboardAvoidingView>
          ) : null}

          {screen === 'settings' ? (
            <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
              <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                <View style={styles.hero}>
                  <Text style={styles.heroEyebrow}>ΜΙΑ ΡΥΘΜΙΣΗ ΓΙΑ ΟΛΟ ΤΟ ΧΑΡΤΟΦΥΛΑΚΙΟ</Text>
                  <Text style={styles.heroTitle}>Οι κανόνες δεν ξαναγράφονται σε κάθε μετοχή.</Text>
                  <Text style={styles.heroText}>Τα όρια εφαρμόζονται αυτόματα σε κάθε υφιστάμενη και νέα θέση.</Text>
                </View>

                <Field
                  label="Μέγιστο βάρος μίας θέσης %"
                  value={settingsForm.maxAllocationPct}
                  onChangeText={(value) => setSettingsForm((x) => ({ ...x, maxAllocationPct: value }))}
                  placeholder="π.χ. 25"
                  keyboardType="decimal-pad"
                />
                <Field
                  label="Μέγιστο κεφάλαιο σε κίνδυνο %"
                  value={settingsForm.maxRiskPct}
                  onChangeText={(value) => setSettingsForm((x) => ({ ...x, maxRiskPct: value }))}
                  placeholder="π.χ. 2"
                  keyboardType="decimal-pad"
                />
                <Field
                  label="Αυτόματη επανεξέταση μετά από ημέρες"
                  value={settingsForm.reviewDays}
                  onChangeText={(value) => setSettingsForm((x) => ({ ...x, reviewDays: value }))}
                  placeholder="π.χ. 90"
                  keyboardType="number-pad"
                  helper="Η ημερομηνία μπαίνει αυτόματα όταν δημιουργείται ένα νέο πλάνο."
                />

                <View style={styles.card}>
                  <Text style={styles.cardTitle}>Τι αλλάζει άμεσα</Text>
                  <Text style={styles.heroText}>Το Decision Gate επανυπολογίζει βάρη, κίνδυνο και ετυμηγορία για όλες τις θέσεις. Δεν αλλάζει καμία συναλλαγή.</Text>
                </View>

                <Pressable style={styles.primary} onPress={saveRules}><Text style={styles.primaryText}>Αποθήκευση γενικών κανόνων</Text></Pressable>
                <Pressable style={styles.secondary} onPress={() => setScreen('list')}><Text style={styles.secondaryText}>Άκυρο</Text></Pressable>
              </ScrollView>
            </KeyboardAvoidingView>
          ) : null}
        </SafeAreaView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safe: { flex: 1, backgroundColor: '#eef5ff' },
  header: { minHeight: 76, paddingHorizontal: 18, paddingVertical: 12, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#dbe3ef', flexDirection: 'row', alignItems: 'center' },
  headerAction: { color: '#0b66ff', fontWeight: '900', minWidth: 72 },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { fontSize: 21, fontWeight: '900', color: '#10233f' },
  headerVersion: { marginTop: 2, fontSize: 11, color: '#7b8799' },
  headerSpacer: { minWidth: 72 },
  content: { padding: 20, paddingBottom: 40, gap: 16 },
  hero: { backgroundColor: '#07163e', borderRadius: 26, padding: 22 },
  heroEyebrow: { color: '#55a6ff', fontWeight: '900', letterSpacing: 1.2, fontSize: 12 },
  heroTitle: { marginTop: 9, color: '#fff', fontWeight: '900', fontSize: 27, lineHeight: 33 },
  heroText: { marginTop: 9, color: '#728096', fontSize: 16, lineHeight: 23 },
  sectionTitle: { color: '#10233f', fontSize: 26, fontWeight: '900', marginTop: 4 },
  card: { backgroundColor: '#fff', borderRadius: 24, padding: 19, borderWidth: 1, borderColor: '#dbe3ef', gap: 13 },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  grow: { flex: 1, minWidth: 0 },
  cardTitle: { color: '#10233f', fontSize: 21, lineHeight: 27, fontWeight: '900' },
  muted: { color: '#7b8799', fontSize: 14, lineHeight: 20 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  metric: { flexGrow: 1, flexBasis: '46%', minWidth: 0, minHeight: 96, borderRadius: 20, padding: 15, backgroundColor: '#fff', borderWidth: 1, borderColor: '#dbe3ef', justifyContent: 'space-between' },
  metricLabel: { color: '#7b8799', fontSize: 14 },
  metricValue: { color: '#10233f', fontSize: 21, fontWeight: '900' },
  red: { color: '#d73949' },
  scoreRow: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  score: { color: '#10233f', fontSize: 30, fontWeight: '900' },
  scoreLarge: { color: '#10233f', fontSize: 43, fontWeight: '900' },
  miniGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  miniCell: { flex: 1, minWidth: '44%', borderRadius: 16, backgroundColor: '#f5f8fd', padding: 13 },
  miniCellWide: { flexBasis: '100%', borderRadius: 16, backgroundColor: '#f5f8fd', padding: 13 },
  miniValue: { color: '#10233f', fontWeight: '900', fontSize: 18, marginTop: 5 },
  issuePreview: { color: '#b26b00', backgroundColor: '#fff7e5', borderRadius: 14, padding: 12, lineHeight: 20 },
  readyText: { color: '#147a4a', backgroundColor: '#eaf9f1', borderRadius: 14, padding: 12, lineHeight: 20 },
  primary: { backgroundColor: '#0b66ff', borderRadius: 17, paddingHorizontal: 16, paddingVertical: 16, alignItems: 'center' },
  primaryText: { color: '#fff', fontWeight: '900', textAlign: 'center' },
  secondary: { backgroundColor: '#fff', borderRadius: 17, paddingHorizontal: 16, paddingVertical: 15, alignItems: 'center', borderWidth: 1, borderColor: '#d7e0ec' },
  secondaryText: { color: '#10233f', fontWeight: '900', textAlign: 'center' },
  field: { gap: 8 },
  label: { color: '#10233f', fontWeight: '900', fontSize: 15 },
  helper: { color: '#7b8799', fontSize: 12, lineHeight: 18 },
  input: { minHeight: 58, borderRadius: 17, paddingHorizontal: 16, backgroundColor: '#fff', borderWidth: 1, borderColor: '#d7e0ec', color: '#10233f', fontSize: 16 },
  textarea: { minHeight: 132, paddingTop: 15, paddingBottom: 15 },
  twoColumns: { flexDirection: 'row', gap: 12 },
  column: { flex: 1, minWidth: 0 },
  autoCard: { backgroundColor: '#e8f2ff', borderWidth: 1, borderColor: '#c6dcfb', borderRadius: 20, padding: 17, gap: 7 },
  autoTitle: { color: '#0b66ff', fontWeight: '900', fontSize: 17 },
  autoText: { color: '#425674', fontSize: 14, lineHeight: 20 },
  pill: { borderRadius: 999, paddingHorizontal: 11, paddingVertical: 8 },
  pillReady: { backgroundColor: '#eaf9f1' },
  pillCaution: { backgroundColor: '#fff7e5' },
  pillBlocked: { backgroundColor: '#ffebee' },
  pillText: { fontSize: 11, fontWeight: '900' },
  pillTextReady: { color: '#147a4a' },
  pillTextCaution: { color: '#a55f00' },
  pillTextBlocked: { color: '#c82e40' },
  issue: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', padding: 12, borderRadius: 14, backgroundColor: '#fff7e5' },
  issueBlock: { backgroundColor: '#ffebee' },
  issueMark: { width: 23, height: 23, borderRadius: 12, textAlign: 'center', textAlignVertical: 'center', overflow: 'hidden', color: '#fff', backgroundColor: '#d79000', fontWeight: '900' },
  issueMarkBlock: { backgroundColor: '#d73949' },
  issueText: { flex: 1, color: '#10233f', lineHeight: 20 },
  fab: { position: 'absolute', right: 14, bottom: 90, zIndex: 20, elevation: 10, width: 54, height: 54, borderRadius: 27, backgroundColor: '#07163e', alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 7, shadowOffset: { width: 0, height: 3 } },
  fabTop: { color: '#55a6ff', fontSize: 27, lineHeight: 31, fontWeight: '900' },
  fabText: { display: 'none' },
});
