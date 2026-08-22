/// <reference types="vite/client" />

declare module '*.xml?raw' {
  const src: string;
  export default src;
}

// Build-time constants injected by vite.config.ts (see `define`).
declare const __GIT_COMMIT__: string;
declare const __GIT_COMMIT_SHORT__: string;
declare const __GIT_COMMIT_DATE__: string;
declare const __GIT_DIRTY__: string;
declare const __BUILD_TIME__: string;
