import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Svg, { Line, Path } from 'react-native-svg';
import { PORTFOLIO_HISTORY_RANGES, portfolioHistoryPointsForRange } from './portfolio-history';

const RANGES = ['1H', '1D', '1W', '1M', '6M', '1Y'];

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
  if (!Number.isFinite(Number(value))) return '—';
  const numeric = Number(value);
  return `${numeric > 0 ? '+' : ''}${numeric.toFixed(2)}%`;
}

function coverageText(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return 'λιγότερο από 1 ώρα';
  const hours = milliseconds / (60 * 60 * 1000);
  if (hours < 24) return `${Math.max(1, Math.round(hours))} ώρες`;
  const days = hours / 24;
  if (days < 62) return `${Math.max(1, Math.round(days))} ημέρες`;
  const months = days / 30.44;
  if (months < 18) return `${Math.max(1, Math.round(months))} μήνες`;
  return `${(days / 365.25).toFixed(1)} έτη`;
}

function pathFor(points, width, height) {
  if (points.length < 2) return '';
  const values = points.map((point) => Number(point.value));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = Math.max(max - min, Math.max(Math.abs(max), 1) * 0.0025);
  const top = max + spread * 0.12;
  const bottom = min - spread * 0.12;
  return points.map((point, index) => {
    const x = points.length === 1 ? 0 : (index / (points.length - 1)) * width;
    const y = height - ((Number(point.value) - bottom) / (top - bottom)) * height;
    return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(' ');
}

export default function PortfolioHistoryChart({ historyState }) {
  const { width: windowWidth } = useWindowDimensions();
  const [range, setRange] = useState('1W');
  const points = useMemo(
    () => portfolioHistoryPointsForRange(historyState, range, Date.now(), 360),
    [historyState, range],
  );
  const chartWidth = Math.max(220, Math.min(640, windowWidth - 66));
  const chartHeight = 150;
  const path = useMemo(() => pathFor(points, chartWidth, chartHeight), [points, chartWidth]);
  const first = points[0] || null;
  const last = points[points.length - 1] || null;
  const change = first && last ? Number(last.value) - Number(first.value) : null;
  const changePct = first && last && Number(first.value) !== 0 ? (change / Number(first.value)) * 100 : null;
  const positive = Number(change) > 0;
  const negative = Number(change) < 0;
  const allPoints = Array.isArray(historyState?.points)
    ? historyState.points
        .filter((point) => point?.capturedAt && Number.isFinite(Number(point?.value)))
        .slice()
        .sort((a, b) => new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime())
    : [];
  const firstAvailable = allPoints[0] || null;
  const lastAvailable = allPoints[allPoints.length - 1] || null;
  const availableSpanMs = firstAvailable && lastAvailable
    ? Math.max(0, new Date(lastAvailable.capturedAt).getTime() - new Date(firstAvailable.capturedAt).getTime())
    : 0;
  const requestedSpanMs = PORTFOLIO_HISTORY_RANGES[range] || PORTFOLIO_HISTORY_RANGES['1W'];
  const partialCoverage = allPoints.length > 0 && availableSpanMs < requestedSpanMs * 0.9;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.grow}>
          <Text style={styles.eyebrow}>ΙΣΤΟΡΙΚΟ ΧΑΡΤΟΦΥΛΑΚΙΟΥ</Text>
          <Text style={styles.value}>{last ? cash(last.value) : '—'}</Text>
          <Text style={[styles.change, positive && styles.positive, negative && styles.negative]}>
            {last && first ? `${change >= 0 ? '+' : ''}${cash(change)} · ${pct(changePct)}` : 'Το ιστορικό ξεκινά από αυτή την έκδοση'}
          </Text>
        </View>
      </View>

      <View style={styles.rangeRow}>
        {RANGES.map((item) => (
          <Pressable key={item} onPress={() => setRange(item)} style={[styles.range, range === item && styles.rangeActive]}>
            <Text style={[styles.rangeText, range === item && styles.rangeTextActive]}>{item}</Text>
          </Pressable>
        ))}
      </View>
      {partialCoverage ? (
        <View style={styles.coverageNotice}>
          <Text style={styles.coverageTitle}>Μερική κάλυψη ιστορικού</Text>
          <Text style={styles.coverageText}>Το {range} προβάλλει μόνο το πραγματικά διαθέσιμο ιστορικό ({coverageText(availableSpanMs)}). Δεν δημιουργούνται παλιότερες τιμές τεχνητά.</Text>
        </View>
      ) : null}

      {points.length >= 2 ? (
        <View style={styles.chartWrap}>
          <Svg width={chartWidth} height={chartHeight}>
            <Line x1="0" y1={chartHeight * 0.25} x2={chartWidth} y2={chartHeight * 0.25} stroke="#e7edf5" strokeWidth="1" />
            <Line x1="0" y1={chartHeight * 0.5} x2={chartWidth} y2={chartHeight * 0.5} stroke="#e7edf5" strokeWidth="1" />
            <Line x1="0" y1={chartHeight * 0.75} x2={chartWidth} y2={chartHeight * 0.75} stroke="#e7edf5" strokeWidth="1" />
            <Path d={path} fill="none" stroke={negative ? '#d83b4d' : '#0B66FF'} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
          </Svg>
          <View style={styles.chartFooter}>
            <Text style={styles.caption}>{new Date(first.capturedAt).toLocaleDateString('el-GR')}</Text>
            <Text style={styles.caption}>{new Date(last.capturedAt).toLocaleDateString('el-GR')}</Text>
          </View>
        </View>
      ) : (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Δεν υπάρχουν ακόμη αρκετά σημεία για γράφημα.</Text>
          <Text style={styles.emptyText}>Καταγράφεται μόνο πλήρης, επαληθευμένη αποτίμηση και δεν δημιουργούμε ψεύτικο ιστορικό για προηγούμενες ημέρες.</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#fff', borderRadius: 22, borderWidth: 1, borderColor: '#d4deeb', padding: 17, marginTop: 14, marginBottom: 2 },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  grow: { flex: 1, minWidth: 0 },
  eyebrow: { color: '#0B66FF', fontSize: 11, fontWeight: '900', letterSpacing: 0.8 },
  value: { color: '#16345f', fontSize: 28, lineHeight: 34, fontWeight: '900', marginTop: 6 },
  change: { color: '#7b889d', fontSize: 13, lineHeight: 19, fontWeight: '800', marginTop: 3 },
  positive: { color: '#078548' },
  negative: { color: '#d83b4d' },
  rangeRow: { flexDirection: 'row', gap: 6, marginTop: 14, marginBottom: 10 },
  range: { flex: 1, minHeight: 34, borderRadius: 12, backgroundColor: '#f2f6fb', alignItems: 'center', justifyContent: 'center' },
  rangeActive: { backgroundColor: '#0B66FF' },
  rangeText: { color: '#60728b', fontSize: 11, fontWeight: '900' },
  rangeTextActive: { color: '#fff' },
  coverageNotice: { backgroundColor: '#f5f8fc', borderRadius: 14, padding: 11, marginBottom: 10, borderWidth: 1, borderColor: '#e0e7f0' },
  coverageTitle: { color: '#40536f', fontSize: 11, fontWeight: '900' },
  coverageText: { color: '#7b889d', fontSize: 11, lineHeight: 16, marginTop: 3 },
  chartWrap: { marginTop: 2, alignItems: 'center' },
  chartFooter: { width: '100%', flexDirection: 'row', justifyContent: 'space-between', marginTop: 5 },
  caption: { color: '#8a96a7', fontSize: 10, fontWeight: '700' },
  empty: { minHeight: 136, borderRadius: 16, backgroundColor: '#f7f9fc', alignItems: 'center', justifyContent: 'center', padding: 18, marginTop: 2 },
  emptyTitle: { color: '#40536f', fontSize: 14, fontWeight: '900', textAlign: 'center' },
  emptyText: { color: '#7b889d', fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 7 },
});
