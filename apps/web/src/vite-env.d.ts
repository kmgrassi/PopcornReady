interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_STANDALONE_CREATION_ENABLED?: string;
  readonly VITE_SUPABASE_ENV?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_SUPABASE_DEV_URL?: string;
  readonly VITE_SUPABASE_DEV_ANON_KEY?: string;
  readonly VITE_SUPABASE_PROD_URL?: string;
  readonly VITE_SUPABASE_PROD_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
