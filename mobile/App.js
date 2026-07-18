import React from 'react';
import { StyleSheet, View } from 'react-native';
import LegacyApp from './LegacyApp';
import DecisionOverlay from './DecisionOverlay';

export default function App() {
  return (
    <View style={styles.root}>
      <LegacyApp />
      <DecisionOverlay />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#eef5ff' },
});
