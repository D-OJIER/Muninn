import { initializeApp, type FirebaseApp } from 'firebase/app';
import { CustomProvider, initializeAppCheck } from 'firebase/app-check';
import {
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  InferenceMode,
  type GenerativeModel,
} from 'firebase/ai';
import { cloudSchema, deviceSchema } from './schema';

const env = import.meta.env;

const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};

export const CLOUD_MODEL = env.VITE_CLOUD_MODEL || 'gemini-3.5-flash-lite';

/** Names of required config values that are missing from .env. */
export function missingConfig(): string[] {
  return Object.entries(firebaseConfig)
    .filter(([key, value]) => !value && key !== 'storageBucket')
    .map(([key]) => key);
}

const LANGUAGE_OPTIONS = {
  expectedInputs: [{ type: 'text' as const, languages: ['en'] }],
  expectedOutputs: [{ type: 'text' as const, languages: ['en'] }],
};

export const deviceAvailabilityOptions = LANGUAGE_OPTIONS;

interface Models {
  app: FirebaseApp;
  /** Never leaves the device; throws if no local model is ready. */
  onDevice: GenerativeModel;
  /** Cloud only. Callers must pass redacted text. */
  cloud: GenerativeModel;
}

let models: Models | undefined;

/**
 * Lazily initializes Firebase, App Check and the two AI Logic models.
 *
 * Muninn uses the hybrid SDK with explicit modes rather than PREFER_ON_DEVICE: a silent
 * fallback would send raw, unredacted messages to the cloud. The router decides the mode,
 * and only redacted text ever reaches the cloud model.
 */
export function getModels(): Models {
  if (models) return models;
  const missing = missingConfig();
  if (missing.length) throw new Error(`Missing Firebase config in .env: ${missing.join(', ')}`);

  const app = initializeApp(firebaseConfig);

  // App Check. Extension pages have no web origin for reCAPTCHA to attest, so Muninn uses
  // App Check debug tokens (accepted for #BuildHybridAI submissions). In debug mode the SDK
  // exchanges the debug token directly and never calls the provider below.
  (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN?: string | boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN =
    env.VITE_APPCHECK_DEBUG_TOKEN || true;
  initializeAppCheck(app, {
    provider: new CustomProvider({
      getToken: () => Promise.reject(new Error('No production App Check provider configured')),
    }),
    isTokenAutoRefreshEnabled: true,
  });

  const ai = getAI(app, { backend: new GoogleAIBackend() });

  const onDevice = getGenerativeModel(ai, {
    mode: InferenceMode.ONLY_ON_DEVICE,
    onDeviceParams: {
      createOptions: LANGUAGE_OPTIONS,
      promptOptions: { responseConstraint: deviceSchema },
    },
  });

  const cloud = getGenerativeModel(ai, {
    mode: InferenceMode.ONLY_IN_CLOUD,
    inCloudParams: {
      model: CLOUD_MODEL,
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: cloudSchema,
        temperature: 0.3,
      },
    },
  });

  models = { app, onDevice, cloud };
  return models;
}
