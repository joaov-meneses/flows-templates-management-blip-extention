/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEV_ALLOWED_EMAILS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
