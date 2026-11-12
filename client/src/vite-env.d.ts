/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Deployed signaling server URL (wss://...). Unset in local dev. */
  readonly VITE_SIGNALING_URL?: string;
}

/** Short commit hash of the build, injected by client/vite.config.ts (`dev` locally). */
declare const __BUILD_COMMIT__: string;
/** ISO-8601 UTC build time, injected by client/vite.config.ts. */
declare const __BUILD_TIME__: string;
