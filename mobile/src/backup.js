import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

const BACKUP_FORMAT = 'investor-control-backup';
const BACKUP_VERSION = 1;

export async function exportBackupAsync(state, appVersion) {
  const payload = {
    format: BACKUP_FORMAT,
    backupVersion: BACKUP_VERSION,
    appVersion,
    exportedAt: new Date().toISOString(),
    data: {
      transactions: Array.isArray(state.transactions) ? state.transactions : [],
      alerts: {
        backgroundEnabled: false,
        rules: Array.isArray(state.alerts?.rules) ? state.alerts.rules : [],
        history: Array.isArray(state.alerts?.history) ? state.alerts.history : [],
      },
    },
    security: {
      finnhubTokenIncluded: false,
      note: 'Το Finnhub token δεν περιλαμβάνεται στο αντίγραφο ασφαλείας.',
    },
  };

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const uri = `${FileSystem.cacheDirectory}investor-control-backup-${stamp}.json`;
  await FileSystem.writeAsStringAsync(uri, JSON.stringify(payload, null, 2), {
    encoding: FileSystem.EncodingType.UTF8,
  });
  const available = await Sharing.isAvailableAsync();
  if (!available) throw new Error('Η κοινή χρήση αρχείων δεν είναι διαθέσιμη στη συσκευή.');
  await Sharing.shareAsync(uri, {
    mimeType: 'application/json',
    dialogTitle: 'Αποθήκευση αντιγράφου Investor Control',
  });
  return uri;
}

export async function pickBackupAsync() {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/json', 'text/json', 'text/plain'],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled) return null;
  const asset = result.assets?.[0];
  if (!asset?.uri) throw new Error('Δεν επιλέχθηκε έγκυρο αρχείο.');
  const text = await FileSystem.readAsStringAsync(asset.uri, {
    encoding: FileSystem.EncodingType.UTF8,
  });
  const payload = JSON.parse(text);
  if (payload?.format !== BACKUP_FORMAT || payload?.backupVersion !== BACKUP_VERSION) {
    throw new Error('Το αρχείο δεν είναι έγκυρο αντίγραφο Investor Control.');
  }
  if (!Array.isArray(payload?.data?.transactions)) {
    throw new Error('Το αντίγραφο δεν περιέχει έγκυρες συναλλαγές.');
  }
  return payload;
}
