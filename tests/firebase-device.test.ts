import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('firebase/app', () => ({ initializeApp: () => ({}) }));
vi.mock('firebase/app-check', () => ({ initializeAppCheck: () => ({}), ReCaptchaEnterpriseProvider: class {} }));
vi.mock('firebase/auth', () => ({ getAuth: () => ({}), onAuthStateChanged: () => () => {}, signInAnonymously: async () => ({}) }));
vi.mock('firebase/firestore', () => ({ addDoc: async () => ({}), collection: () => ({}), getFirestore: () => ({}), serverTimestamp: () => 0 }));
vi.mock('firebase/remote-config', () => ({ fetchAndActivate: async () => true, getRemoteConfig: () => ({ settings: {} }), getValue: () => ({}) }));
vi.mock('firebase/ai', () => ({ getAI: () => ({}), getGenerativeModel: () => ({}), GoogleAIBackend: class {}, InferenceMode: {} }));

import { onDeviceState, RC_MIN_FETCH_INTERVAL_MS, AVAILABILITY_TIMEOUT_MS } from '../src/firebase';

const g = globalThis as unknown as { LanguageModel?: unknown };
afterEach(() => { delete g.LanguageModel; });

describe('config', () => {
  it('uses 30 s fetch interval and 15 s availability timeout', () => {
    expect(RC_MIN_FETCH_INTERVAL_MS).toBe(30_000);
    expect(AVAILABILITY_TIMEOUT_MS).toBe(15_000);
  });
});

describe('onDeviceState', () => {
  it('no-api when LanguageModel is missing', async () => {
    expect(await onDeviceState()).toBe('no-api');
  });
  it('returns available without re-check', async () => {
    const availability = vi.fn(async () => 'available');
    g.LanguageModel = { availability };
    expect(await onDeviceState(50)).toBe('available');
    expect(availability).toHaveBeenCalledTimes(1);
  });
  it('re-checks once after a hang and recovers', async () => {
    const availability = vi.fn()
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockImplementationOnce(async () => 'available');
    g.LanguageModel = { availability };
    expect(await onDeviceState(20, 5)).toBe('available');
    expect(availability).toHaveBeenCalledTimes(2);
  });
  it('reports unavailable only after two failed checks', async () => {
    const availability = vi.fn(async () => 'unavailable');
    g.LanguageModel = { availability };
    expect(await onDeviceState(20, 5)).toBe('unavailable');
    expect(availability).toHaveBeenCalledTimes(2);
  });
});
