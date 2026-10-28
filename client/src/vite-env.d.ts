/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Deployed signaling server URL (wss://...). Unset in local dev. */
  readonly VITE_SIGNALING_URL?: string;
}
