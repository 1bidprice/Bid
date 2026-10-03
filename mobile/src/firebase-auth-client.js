import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  createUserWithEmailAndPassword,
  getReactNativePersistence,
  initializeAuth,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';

export const MINBEIS_FIREBASE_AUTH_CLIENT_VERSION = '2026-10-03.1';

let cachedAuth = null;

function clean(value) {
  return String(value || '').trim();
}

export function firebasePublicConfig(env = process.env) {
  const config = {
    apiKey: clean(env.EXPO_PUBLIC_FIREBASE_API_KEY),
    authDomain: clean(env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN) || undefined,
    projectId: clean(env.EXPO_PUBLIC_FIREBASE_PROJECT_ID),
    appId: clean(env.EXPO_PUBLIC_FIREBASE_APP_ID),
  };
  const configured = Boolean(config.apiKey && config.projectId && config.appId);
  return { configured, config };
}

export function isFirebaseAccountConfigured(env = process.env) {
  return firebasePublicConfig(env).configured;
}

function normalizeEmail(value) {
  const email = clean(value).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function normalizePassword(value) {
  const password = String(value || '');
  return password.length >= 8 && password.length <= 256 ? password : null;
}

export function getMinbeisFirebaseAuth(env = process.env) {
  if (cachedAuth) return cachedAuth;
  const { configured, config } = firebasePublicConfig(env);
  if (!configured) {
    const error = new Error('FIREBASE_ACCOUNT_NOT_CONFIGURED');
    error.code = 'FIREBASE_ACCOUNT_NOT_CONFIGURED';
    throw error;
  }
  const app = getApps().length ? getApp() : initializeApp(config);
  cachedAuth = initializeAuth(app, {
    persistence: getReactNativePersistence(AsyncStorage),
  });
  return cachedAuth;
}

export async function minbeisSignIn(emailInput, passwordInput, env = process.env) {
  const email = normalizeEmail(emailInput);
  const password = normalizePassword(passwordInput);
  if (!email) throw new Error('ACCOUNT_EMAIL_INVALID');
  if (!password) throw new Error('ACCOUNT_PASSWORD_INVALID');
  const credential = await signInWithEmailAndPassword(getMinbeisFirebaseAuth(env), email, password);
  return {
    uid: credential.user.uid,
    email: credential.user.email || email,
    emailVerified: credential.user.emailVerified === true,
  };
}

export async function minbeisCreateAccount(emailInput, passwordInput, env = process.env) {
  const email = normalizeEmail(emailInput);
  const password = normalizePassword(passwordInput);
  if (!email) throw new Error('ACCOUNT_EMAIL_INVALID');
  if (!password) throw new Error('ACCOUNT_PASSWORD_INVALID');
  const credential = await createUserWithEmailAndPassword(getMinbeisFirebaseAuth(env), email, password);
  await sendEmailVerification(credential.user);
  return {
    uid: credential.user.uid,
    email: credential.user.email || email,
    emailVerified: credential.user.emailVerified === true,
    verificationSent: true,
  };
}

export async function minbeisSendEmailVerification(env = process.env) {
  const auth = getMinbeisFirebaseAuth(env);
  if (!auth.currentUser) {
    const error = new Error('ACCOUNT_NOT_SIGNED_IN');
    error.code = 'ACCOUNT_NOT_SIGNED_IN';
    throw error;
  }
  await sendEmailVerification(auth.currentUser);
  return { sent: true };
}

export async function minbeisSendPasswordReset(emailInput, env = process.env) {
  const email = normalizeEmail(emailInput);
  if (!email) throw new Error('ACCOUNT_EMAIL_INVALID');
  await sendPasswordResetEmail(getMinbeisFirebaseAuth(env), email);
  return { sent: true };
}

export async function minbeisSignOut(env = process.env) {
  await signOut(getMinbeisFirebaseAuth(env));
  return { signedOut: true };
}

export async function minbeisIdToken(env = process.env, forceRefresh = false) {
  const auth = getMinbeisFirebaseAuth(env);
  if (!auth.currentUser) {
    const error = new Error('ACCOUNT_NOT_SIGNED_IN');
    error.code = 'ACCOUNT_NOT_SIGNED_IN';
    throw error;
  }
  return auth.currentUser.getIdToken(forceRefresh);
}

export function currentMinbeisAccount(env = process.env) {
  if (!isFirebaseAccountConfigured(env)) return null;
  const user = getMinbeisFirebaseAuth(env).currentUser;
  if (!user) return null;
  return {
    uid: user.uid,
    email: user.email || null,
    emailVerified: user.emailVerified === true,
  };
}
