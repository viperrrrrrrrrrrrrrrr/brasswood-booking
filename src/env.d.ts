/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 'api' (default, Cloudflare Pages Functions + D1) or 'local' (static demo in localStorage). */
  readonly VITE_DATA_SOURCE?: 'api' | 'local'
}
interface ImportMeta {
  readonly env: ImportMetaEnv
}
