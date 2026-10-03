import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { onAuthStateChanged } from 'firebase/auth';
import {
  getMinbeisFirebaseAuth,
  isFirebaseAccountConfigured,
  minbeisCreateAccount,
  minbeisSendEmailVerification,
  minbeisSendPasswordReset,
  minbeisSignIn,
  minbeisSignOut,
} from './firebase-auth-client';
import {
  disableRemotePushForCurrentDevice,
  enableRemotePushForCurrentDevice,
} from './account-device-sync';
import {
  isRemotePushEnabledLocally,
  syncAllRemoteAlertRules,
} from './remote-alert-sync';

function messageFor(error) {
  const code = String(error?.code || error?.message || '');
  if (/invalid-credential|wrong-password|user-not-found/i.test(code)) return 'Το email ή ο κωδικός δεν είναι σωστά.';
  if (/email-already-in-use/i.test(code)) return 'Υπάρχει ήδη λογαριασμός με αυτό το email.';
  if (/weak-password|ACCOUNT_PASSWORD_INVALID/i.test(code)) return 'Ο κωδικός πρέπει να έχει τουλάχιστον 8 χαρακτήρες.';
  if (/ACCOUNT_EMAIL_INVALID|invalid-email/i.test(code)) return 'Έλεγξε τη διεύθυνση email.';
  if (/too-many-requests/i.test(code)) return 'Έγιναν πολλές προσπάθειες. Δοκίμασε ξανά αργότερα.';
  if (/network-request-failed/i.test(code)) return 'Δεν υπάρχει διαθέσιμη σύνδεση αυτή τη στιγμή.';
  return 'Η ενέργεια δεν ολοκληρώθηκε. Δοκίμασε ξανά.';
}

export default function AccountAccessCard({ alertRules = [] }) {
  const configured = isFirebaseAccountConfigured();
  const [account, setAccount] = useState(null);
  const [accountVersion, setAccountVersion] = useState(0);
  const [mode, setMode] = useState('SIGN_IN');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [feedback, setFeedback] = useState(null);

  useEffect(() => {
    if (!configured) return undefined;
    const auth = getMinbeisFirebaseAuth();
    setAccount(auth.currentUser || null);
    isRemotePushEnabledLocally().then(setPushEnabled).catch(() => setPushEnabled(false));
    return onAuthStateChanged(auth, (user) => setAccount(user || null));
  }, [configured]);

  if (!configured) return null;

  async function submit() {
    setBusy(true);
    setFeedback(null);
    try {
      if (mode === 'CREATE') {
        const result = await minbeisCreateAccount(email, password);
        if (result.verificationSent) {
          setFeedback({ type: 'ok', text: 'Ο λογαριασμός δημιουργήθηκε. Στάλθηκε email επιβεβαίωσης.' });
        }
      } else {
        const result = await minbeisSignIn(email, password);
        if (!result.emailVerified) {
          setFeedback({ type: 'error', text: 'Συνδέθηκες, αλλά πρέπει πρώτα να επιβεβαιώσεις το email σου για remote λειτουργίες.' });
        }
      }
      setPassword('');
    } catch (error) {
      setFeedback({ type: 'error', text: messageFor(error) });
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword() {
    setBusy(true);
    setFeedback(null);
    try {
      await minbeisSendPasswordReset(email);
      setFeedback({ type: 'ok', text: 'Στάλθηκε email επαναφοράς κωδικού.' });
    } catch (error) {
      setFeedback({ type: 'error', text: messageFor(error) });
    } finally {
      setBusy(false);
    }
  }

  async function resendVerification() {
    setBusy(true);
    setFeedback(null);
    try {
      await minbeisSendEmailVerification();
      setFeedback({ type: 'ok', text: 'Στάλθηκε νέο email επιβεβαίωσης.' });
    } catch (error) {
      setFeedback({ type: 'error', text: messageFor(error) });
    } finally {
      setBusy(false);
    }
  }

  async function refreshVerification() {
    setBusy(true);
    setFeedback(null);
    try {
      await account.reload();
      setAccountVersion((current) => current + 1);
      if (account.emailVerified) {
        setFeedback({ type: 'ok', text: 'Το email επιβεβαιώθηκε.' });
      } else {
        setFeedback({ type: 'error', text: 'Το email δεν έχει επιβεβαιωθεί ακόμη.' });
      }
    } catch {
      setFeedback({ type: 'error', text: 'Δεν ανανεώθηκε η κατάσταση επιβεβαίωσης.' });
    } finally {
      setBusy(false);
    }
  }

  async function enableRemotePush() {
    setPushBusy(true);
    setFeedback(null);
    try {
      const result = await enableRemotePushForCurrentDevice();
      setPushEnabled(result.enabled === true);
      try {
        await syncAllRemoteAlertRules(alertRules, {
          installationId: result.installationId,
          remotePushEnabled: true,
        });
        setFeedback({ type: 'ok', text: 'Οι απομακρυσμένες ειδοποιήσεις ενεργοποιήθηκαν και οι υπάρχοντες κανόνες συγχρονίστηκαν.' });
      } catch {
        setFeedback({ type: 'error', text: 'Η συσκευή ενεργοποιήθηκε για remote ειδοποιήσεις, αλλά κάποιοι υπάρχοντες κανόνες δεν συγχρονίστηκαν ακόμη.' });
      }
    } catch (error) {
      const code = String(error?.gatewayCode || error?.code || error?.message || '');
      if (/ACCOUNT_API_DISABLED|ACCOUNTS_DATABASE_NOT_CONFIGURED|REMOTE_PUSH_NOT_CONFIGURED/.test(code)) {
        setFeedback({ type: 'error', text: 'Η υπηρεσία απομακρυσμένων ειδοποιήσεων δεν έχει ενεργοποιηθεί ακόμη στο production backend.' });
      } else if (/PUSH_PERMISSION_NOT_GRANTED/.test(code)) {
        setFeedback({ type: 'error', text: 'Δεν δόθηκε άδεια ειδοποιήσεων στη συσκευή.' });
      } else {
        setFeedback({ type: 'error', text: 'Δεν ολοκληρώθηκε η ενεργοποίηση απομακρυσμένων ειδοποιήσεων.' });
      }
    } finally {
      setPushBusy(false);
    }
  }

  async function disableRemotePush() {
    setPushBusy(true);
    setFeedback(null);
    try {
      await disableRemotePushForCurrentDevice();
      setPushEnabled(false);
      setFeedback({ type: 'ok', text: 'Οι απομακρυσμένες ειδοποιήσεις απενεργοποιήθηκαν για αυτή τη συσκευή.' });
    } catch {
      setFeedback({ type: 'error', text: 'Δεν ολοκληρώθηκε η απενεργοποίηση αυτής της συσκευής.' });
    } finally {
      setPushBusy(false);
    }
  }

  async function signOutNow() {
    setBusy(true);
    setFeedback(null);
    try {
      const remoteEnabled = await isRemotePushEnabledLocally();
      if (remoteEnabled) {
        try {
          await disableRemotePushForCurrentDevice();
          setPushEnabled(false);
        } catch {
          setFeedback({ type: 'error', text: 'Δεν έγινε αποσύνδεση, επειδή δεν επιβεβαιώθηκε η απενεργοποίηση remote ειδοποιήσεων για αυτή τη συσκευή.' });
          return;
        }
      }
      await minbeisSignOut();
      setPassword('');
    } catch (error) {
      setFeedback({ type: 'error', text: messageFor(error) });
    } finally {
      setBusy(false);
    }
  }

  if (account) {
    void accountVersion;
    return (
      <View style={styles.card}>
        <Text style={styles.title}>Λογαριασμός MINBEIS</Text>
        <Text style={styles.account}>{account.email || 'Συνδεδεμένος χρήστης'}</Text>
        <Text style={account.emailVerified ? styles.verified : styles.unverified}>
          {account.emailVerified ? 'Email επιβεβαιωμένο' : 'Απαιτείται επιβεβαίωση email'}
        </Text>
        <Text style={styles.note}>
          Ο λογαριασμός χρησιμοποιείται για ασφαλή ταυτοποίηση συσκευών και απομακρυσμένες ειδοποιήσεις.
          Οι συναλλαγές, οι ποσότητες, το κόστος και το P/L του χαρτοφυλακίου παραμένουν τοπικά στη συσκευή.
        </Text>
        <View style={styles.privacyBox}>
          <Text style={styles.privacyStrong}>Cloud portfolio sync: Ανενεργός</Text>
          <Text style={styles.privacyText}>Η είσοδος στον λογαριασμό δεν ανεβάζει το χαρτοφυλάκιό σου.</Text>
        </View>
        {!account.emailVerified ? (
          <>
            <Pressable style={styles.secondary} onPress={resendVerification} disabled={busy}>
              <Text style={styles.secondaryText}>Επαναποστολή email επιβεβαίωσης</Text>
            </Pressable>
            <Pressable style={styles.secondary} onPress={refreshVerification} disabled={busy}>
              <Text style={styles.secondaryText}>Έχω επιβεβαιώσει το email</Text>
            </Pressable>
          </>
        ) : null}
        <Pressable style={styles.primary} onPress={enableRemotePush} disabled={pushBusy || pushEnabled || !account.emailVerified}>
          {pushBusy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>{pushEnabled ? 'Remote ειδοποιήσεις ενεργές' : 'Ενεργοποίηση remote ειδοποιήσεων'}</Text>}
        </Pressable>
        {pushEnabled ? (
          <Pressable style={styles.secondary} onPress={disableRemotePush} disabled={pushBusy}>
            <Text style={styles.secondaryText}>Απενεργοποίηση σε αυτή τη συσκευή</Text>
          </Pressable>
        ) : null}
        <Pressable style={styles.secondary} onPress={signOutNow} disabled={busy}>
          {busy ? <ActivityIndicator /> : <Text style={styles.secondaryText}>Αποσύνδεση</Text>}
        </Pressable>
        {feedback ? <Text style={feedback.type === 'error' ? styles.error : styles.ok}>{feedback.text}</Text> : null}
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Λογαριασμός MINBEIS</Text>
      <Text style={styles.note}>
        Προαιρετική σύνδεση για ασφαλή ταυτοποίηση συσκευών και remote push ειδοποιήσεις.
        Το portfolio παραμένει τοπικά και δεν ανεβαίνει στο cloud.
      </Text>

      <View style={styles.modeRow}>
        <Pressable style={[styles.mode, mode === 'SIGN_IN' && styles.modeOn]} onPress={() => setMode('SIGN_IN')}>
          <Text style={[styles.modeText, mode === 'SIGN_IN' && styles.modeTextOn]}>Σύνδεση</Text>
        </Pressable>
        <Pressable style={[styles.mode, mode === 'CREATE' && styles.modeOn]} onPress={() => setMode('CREATE')}>
          <Text style={[styles.modeText, mode === 'CREATE' && styles.modeTextOn]}>Νέος λογαριασμός</Text>
        </Pressable>
      </View>

      <TextInput
        style={styles.input}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        textContentType="emailAddress"
        placeholder="Email"
      />
      <TextInput
        style={styles.input}
        value={password}
        onChangeText={setPassword}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
        textContentType={mode === 'CREATE' ? 'newPassword' : 'password'}
        placeholder="Κωδικός (τουλάχιστον 8 χαρακτήρες)"
      />

      <Pressable style={styles.primary} onPress={submit} disabled={busy}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>{mode === 'CREATE' ? 'Δημιουργία λογαριασμού' : 'Σύνδεση'}</Text>}
      </Pressable>
      <Pressable style={styles.linkButton} onPress={resetPassword} disabled={busy}>
        <Text style={styles.link}>Ξέχασα τον κωδικό</Text>
      </Pressable>

      <View style={styles.privacyBox}>
        <Text style={styles.privacyStrong}>Privacy by default</Text>
        <Text style={styles.privacyText}>Δεν αποστέλλονται ποσότητες, cost basis, P/L ή προσωπικές σημειώσεις χαρτοφυλακίου.</Text>
      </View>
      {feedback ? <Text style={feedback.type === 'error' ? styles.error : styles.ok}>{feedback.text}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#fff', borderRadius: 22, borderWidth: 1, borderColor: '#d4deeb', padding: 17, marginBottom: 12 },
  title: { color: '#16345f', fontSize: 21, lineHeight: 26, fontWeight: '900' },
  account: { color: '#0B66FF', fontSize: 16, lineHeight: 22, fontWeight: '900', marginTop: 8 },
  verified: { color: '#078548', fontSize: 11, lineHeight: 16, fontWeight: '900', marginTop: 4 },
  unverified: { color: '#a66700', fontSize: 11, lineHeight: 16, fontWeight: '900', marginTop: 4 },
  note: { color: '#60728b', fontSize: 13, lineHeight: 20, marginTop: 8 },
  modeRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  mode: { flex: 1, paddingVertical: 10, paddingHorizontal: 8, borderRadius: 12, borderWidth: 1, borderColor: '#d5dfec', alignItems: 'center' },
  modeOn: { backgroundColor: '#eaf2ff', borderColor: '#0B66FF' },
  modeText: { color: '#60728b', fontSize: 12, fontWeight: '800' },
  modeTextOn: { color: '#0B66FF' },
  input: { minHeight: 48, borderWidth: 1, borderColor: '#d5dfec', borderRadius: 13, paddingHorizontal: 13, marginTop: 10, color: '#16345f', backgroundColor: '#fff' },
  primary: { minHeight: 50, borderRadius: 14, backgroundColor: '#0B66FF', alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  primaryText: { color: '#fff', fontWeight: '900' },
  secondary: { minHeight: 48, borderRadius: 14, borderWidth: 1, borderColor: '#d5dfec', alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  secondaryText: { color: '#16345f', fontWeight: '900' },
  linkButton: { alignItems: 'center', paddingVertical: 11 },
  link: { color: '#0B66FF', fontSize: 12, fontWeight: '800' },
  privacyBox: { backgroundColor: '#f5f8fc', borderRadius: 13, padding: 11, marginTop: 12, borderWidth: 1, borderColor: '#e0e7f0' },
  privacyStrong: { color: '#40536f', fontSize: 11, fontWeight: '900' },
  privacyText: { color: '#718096', fontSize: 11, lineHeight: 16, marginTop: 3 },
  error: { color: '#b42318', fontSize: 12, lineHeight: 18, fontWeight: '700', marginTop: 10 },
  ok: { color: '#078548', fontSize: 12, lineHeight: 18, fontWeight: '700', marginTop: 10 },
});
