import React from 'react';
import { StyleSheet, View } from 'react-native';
import PortfolioApp from './PortfolioApp';
import DecisionOverlay from './DecisionOverlay';

export default function App() {
  return (
    <View style={styles.root}>
      <PortfolioApp />
      <DecisionOverlay />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#eef5ff' },
});
