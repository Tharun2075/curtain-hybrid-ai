// Firebase wiring: App Check, anonymous Auth, Firestore (masked text only),
// Remote Config (routing threshold) and the Firebase AI Logic hybrid models.
// Copyright 2026 Agri Group. Licensed under the Apache License, Version 2.0.
import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { getAuth, onAuthStateChanged, signInAnonymously, type User } from 'firebase/auth';
import { addDoc, collection, getFirestore, serverTimestamp } from 'firebase/firestore';
import { fetchAndActivate, getRemoteConfig, getValue } from 'firebase/remote-config';
import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode, type GenerativeModel } from 'firebase/ai';
import config from './firebase-config.json';

// Public reCAPTCHA Enterprise site key (site keys are public by design).
const RECAPTCHA_ENTERPRISE_SITE_KEY = '6LfMaCYuAAAAAED4Zrakdy9ASXCfP3l2uB_n_zM2';

// Local development only: the App Check debug token comes from .env.local
// (git-ignored). It is never committed and never bundled into a production build.
if (import.meta.env.DEV && import.meta.env.VITE_APPCHECK_DEBUG_TOKEN) {
  (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN: string }).FIREBASE_APPCHECK_DEBUG_TOKEN =
    import.meta.env.VITE_APPCHECK_DEBUG_TOKEN;
}

export const app = initializeApp(config);
export const appCheck = initializeAppCheck(app, {
  provider: new ReCaptchaEnterpriseProvider(RECAPTCHA_ENTERPRISE_SITE_KEY),
  isTokenAutoRefreshEnabled: true,
});
export const auth = getAuth(app);
export const db = getFirestore(app);

// ---------- Remote Config: routing threshold ----------
/** Documented defaults; Remote Config can override them without a deploy. */
export const ROUTING_DEFAULTS = {
  ondevice_max_chars: 1800, // masked prompts up to this size try the on-device model first
  cloud_model: 'gemini-3.5-flash-lite', // the SDK's default hybrid cloud model
};
export interface Routing {
  ondeviceMaxChars: number;
  cloudModel: string;
  source: 'remote-config' | 'default';
}

/** Remote Config fetch throttle: short so a changed limit shows up within ~30 s. */
export const RC_MIN_FETCH_INTERVAL_MS = 30_000;

export async function loadRouting(): Promise<Routing> {
  try {
    const rc = getRemoteConfig(app);
    rc.settings.minimumFetchIntervalMillis = RC_MIN_FETCH_INTERVAL_MS;
    rc.defaultConfig = { ...ROUTING_DEFAULTS };
    // Never let a slow Remote Config fetch block the app: fall back to the defaults.
    await Promise.race([fetchAndActivate(rc), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000))]);
    const max = getValue(rc, 'ondevice_max_chars');
    const model = getValue(rc, 'cloud_model');
    return {
      ondeviceMaxChars: max.asNumber() || ROUTING_DEFAULTS.ondevice_max_chars,
      cloudModel: model.asString() || ROUTING_DEFAULTS.cloud_model,
      source: max.getSource() === 'remote' || model.getSource() === 'remote' ? 'remote-config' : 'default',
    };
  } catch {
    return { ondeviceMaxChars: ROUTING_DEFAULTS.ondevice_max_chars, cloudModel: ROUTING_DEFAULTS.cloud_model, source: 'default' };
  }
}

// ---------- Firebase AI Logic: three model handles ----------
const ai = getAI(app, { backend: new GoogleAIBackend() });

export interface Models {
  /** Raw text goes ONLY here. ONLY_ON_DEVICE: the SDK throws instead of falling back to the cloud. */
  masker: GenerativeModel;
  /** Short tasks on masked text. PREFER_ON_DEVICE: on-device when available, cloud fallback otherwise. */
  short: GenerativeModel;
  /** Long synthesis on masked text. ONLY_IN_CLOUD. */
  cloud: GenerativeModel;
}

export function makeModels(cloudModel: string): Models {
  const onDeviceParams = {
    createOptions: {
      expectedInputs: [{ type: 'text' as const, languages: ['en'] }],
      expectedOutputs: [{ type: 'text' as const, languages: ['en'] }],
    },
    promptOptions: {},
  };
  return {
    masker: getGenerativeModel(ai, { mode: InferenceMode.ONLY_ON_DEVICE, onDeviceParams }),
    short: getGenerativeModel(ai, { mode: InferenceMode.PREFER_ON_DEVICE, onDeviceParams, inCloudParams: { model: cloudModel } }),
    cloud: getGenerativeModel(ai, { mode: InferenceMode.ONLY_IN_CLOUD, inCloudParams: { model: cloudModel } }),
  };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
}

// ---------- on-device availability (Chrome Prompt API) ----------
export type DeviceState = 'available' | 'downloadable' | 'downloading' | 'unavailable' | 'no-api';

/** First check waits this long; a cold Chrome start can make availability() slow. */
export const AVAILABILITY_TIMEOUT_MS = 15_000;
const KNOWN: DeviceState[] = ['available', 'downloadable', 'downloading', 'unavailable'];

export async function onDeviceState(timeoutMs = AVAILABILITY_TIMEOUT_MS, recheckDelayMs = 0): Promise<DeviceState> {
  const LM = (globalThis as unknown as { LanguageModel?: { availability: (o?: unknown) => Promise<string> } }).LanguageModel;
  if (!LM) return 'no-api';
  const check = async (): Promise<DeviceState | null> => {
    try {
      const a = await withTimeout(LM.availability({
        expectedInputs: [{ type: 'text', languages: ['en'] }],
        expectedOutputs: [{ type: 'text', languages: ['en'] }],
      }), timeoutMs);
      return (KNOWN as string[]).includes(a) ? (a as DeviceState) : 'unavailable';
    } catch {
      return null; // timeout or error
    }
  };
  const first = await check();
  if (first && first !== 'unavailable') return first;
  // One re-check before reporting "not available" (cold start can hang or lag).
  if (recheckDelayMs > 0) await new Promise((r) => setTimeout(r, recheckDelayMs));
  return (await check()) ?? 'unavailable';
}

// ---------- anonymous Auth + Firestore (masked text only) ----------
export function signIn(): Promise<User> {
  return new Promise((resolve, reject) => {
    const off = onAuthStateChanged(auth, (u) => {
      if (u) {
        off();
        resolve(u);
      }
    });
    signInAnonymously(auth).catch((e) => {
      off();
      reject(e);
    });
  });
}

export interface SavedRun {
  task: string;
  threadId: string;
  maskedInput: string;
  maskedOutput: string;
  route: string;
  maskCount: number;
}

/** Stores MASKED text only. The key map stays in IndexedDB. */
export async function saveRun(uid: string, run: SavedRun): Promise<string> {
  const ref = await addDoc(collection(db, 'users', uid, 'runs'), { ...run, createdAt: serverTimestamp() });
  return ref.id;
}
