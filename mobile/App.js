import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import PortfolioApp from './PortfolioApp';
import DecisionOverlay from './DecisionOverlay';
import { syncBackgroundIntelligenceTask } from './src/background-intelligence-task';

export default function App() {
  const [decisionVisible, setDecisionVisible] = useState(false);
  useEffect(() => {
    syncBackgroundIntelligenceTask(true).catch((error) => {
      console.warn('Investor Control background intelligence registration failed', error);
    });
  }, []);
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <View style={styles.root}>
        <PortfolioApp onOpenDecisionGate={() => setDecisionVisible(true)} />
        <DecisionOverlay visible={decisionVisible} onRequestClose={() => setDecisionVisible(false)} />
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#eef5ff' },
});
