// Minimal typing for Chrome's built-in Prompt API global, used only to check model availability.
// Inference itself goes through the Firebase AI Logic SDK.
type LanguageModelAvailability = 'unavailable' | 'downloadable' | 'downloading' | 'available';

declare const LanguageModel:
  | {
      availability(options?: object): Promise<LanguageModelAvailability>;
    }
  | undefined;

interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET?: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID?: string;
  readonly VITE_FIREBASE_APP_ID?: string;
  readonly VITE_APPCHECK_DEBUG_TOKEN?: string;
  readonly VITE_CLOUD_MODEL?: string;
}
