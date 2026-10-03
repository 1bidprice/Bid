import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { buildPortfolioInsights } from './portfolio-insights';

function cash(value) {
  return Number.isFinite(Number(value))
    ? new Intl.NumberFormat('el-GR', {
        style: 'currency',
        currency: 'EUR',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(Number(value))
    : '—';
}

function pct(value) {
  return Number.isFinite(Number(value)) ? `${Number(value).toFixed(1)}%` : '—';
}

function Bar({ valuePct, tone = 'blue' }) {
  const width = `${Math.max(0, Math.min(100, Number(valuePct) || 0))}%`;
  return (
    <View style={styles.track}>
      <View style={[styles.fill, tone === 'red' && styles.fillRed, tone === 'green' && styles.fillGreen, { width }]} />
    </View>
  );
}

export default function PortfolioInsightsCard({ positions }) {
  const insights = useMemo(() => buildPortfolioInsights(positions), [positions]);
  if (!insights.positionCount || !insights.valuedPositionCount) return null;

  const allocation = insights.allocation.slice(0, 6);
  const pnlItems = insights.pnlContribution.slice(0, 6);

  return (
    <View style={styles.card}>
      <Text style={styles.eyebrow}>ΔΟΜΗ ΧΑΡΤΟΦΥΛΑΚΙΟΥ</Text>
      <Text style={styles.title}>Πού είναι συγκεντρωμένα τα χρήματά σου</Text>
      <View style={styles.metrics}>
        <View style={styles.metric}><Text style={styles.metricLabel}>Μεγαλύτερη θέση</Text><Text style={styles.metricValue}>{pct(insights.top1Pct)}</Text></View>
        <View style={styles.metric}><Text style={styles.metricLabel}>3 μεγαλύτερες</Text><Text style={styles.metricValue}>{pct(insights.top3Pct)}</Text></View>
        <View style={styles.metric}><Text style={styles.metricLabel}>Κάλυψη</Text><Text style={styles.metricValue}>{insights.coverage}</Text></View>
      </View>

      <Text style={styles.section}>Κατανομή τρέχουσας αξίας</Text>
      {allocation.map((item) => (
        <View key={item.symbol} style={styles.row}>
          <View style={styles.rowTop}><Text style={styles.symbol}>{item.symbol}</Text><Text style={styles.rowValue}>{pct(item.weightPct)} · {cash(item.value)}</Text></View>
          <Bar valuePct={item.weightPct} />
        </View>
      ))}

      {pnlItems.length ? <>
        <Text style={styles.section}>Ποια θέση κινεί περισσότερο το αποτέλεσμα</Text>
        <Text style={styles.helper}>Η μπάρα δείχνει το μερίδιο της κάθε θέσης στο απόλυτο συνολικό μη πραγματοποιημένο κέρδος/ζημία του χαρτοφυλακίου — όχι ημερήσια μεταβολή ή πρόβλεψη.</Text>
        {pnlItems.map((item) => (
          <View key={`pnl-${item.symbol}`} style={styles.row}>
            <View style={styles.rowTop}><Text style={styles.symbol}>{item.symbol}</Text><Text style={[styles.rowValue, item.pnl < 0 && styles.negative, item.pnl > 0 && styles.positive]}>{cash(item.pnl)}</Text></View>
            <Bar valuePct={item.contributionPct} tone={item.pnl < 0 ? 'red' : item.pnl > 0 ? 'green' : 'blue'} />
          </View>
        ))}
      </> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#fff', borderRadius: 22, borderWidth: 1, borderColor: '#d4deeb', padding: 17, marginTop: 14, marginBottom: 2 },
  eyebrow: { color: '#0B66FF', fontSize: 11, fontWeight: '900', letterSpacing: 0.8 },
  title: { color: '#16345f', fontSize: 20, lineHeight: 26, fontWeight: '900', marginTop: 5 },
  metrics: { flexDirection: 'row', gap: 8, marginTop: 14 },
  metric: { flex: 1, borderRadius: 14, backgroundColor: '#f5f8fc', padding: 10 },
  metricLabel: { color: '#7b889d', fontSize: 10, lineHeight: 14, fontWeight: '800' },
  metricValue: { color: '#16345f', fontSize: 16, lineHeight: 20, fontWeight: '900', marginTop: 5 },
  section: { color: '#40536f', fontSize: 13, lineHeight: 18, fontWeight: '900', marginTop: 18, marginBottom: 8 },
  helper: { color: '#7b889d', fontSize: 10, lineHeight: 15, marginTop: -3, marginBottom: 9 },
  row: { marginBottom: 11 },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  symbol: { color: '#29466f', fontSize: 12, fontWeight: '900' },
  rowValue: { color: '#60728b', fontSize: 11, fontWeight: '800', textAlign: 'right' },
  track: { height: 8, borderRadius: 999, overflow: 'hidden', backgroundColor: '#edf2f8', marginTop: 6 },
  fill: { height: '100%', borderRadius: 999, backgroundColor: '#0B66FF' },
  fillRed: { backgroundColor: '#d83b4d' },
  fillGreen: { backgroundColor: '#078548' },
  negative: { color: '#d83b4d' },
  positive: { color: '#078548' },
});
