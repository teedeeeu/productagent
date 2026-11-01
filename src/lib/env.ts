import "server-only";

/**
 * Server-side configuration. Secret values are only ever read here and never
 * sent to the browser; the settings page only shows whether each is set.
 */

const intFromEnv = (name: string, fallback: number, max: number) => {
  const n = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : fallback;
};

export const config = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  maxProductsPerScan: intFromEnv("MAX_PRODUCTS_PER_SCAN", 500, 10000),
  maxLlmCallsPerScan: intFromEnv("MAX_LLM_CALLS_PER_SCAN", 100, 5000),
  appUrl: process.env.APP_URL ?? "http://localhost:3000",
};

export const isSupabaseConfigured = Boolean(config.supabaseUrl && config.supabaseAnonKey);

/**
 * Demo mode (no Supabase, single local merchant, data in .data/demo-db.json)
 * is for local development only. In production it must be opted into
 * explicitly, and even then it is never used when Supabase is configured.
 */
export const isDemoMode =
  !isSupabaseConfigured && (process.env.NODE_ENV !== "production" || process.env.ALLOW_DEMO_MODE === "true");

/** Presence flags for the settings page — never the values themselves. */
export function configurationStatus() {
  return {
    supabase: isSupabaseConfigured,
    supabaseServiceRole: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    openai: Boolean(process.env.OPENAI_API_KEY),
    openaiModel: process.env.OPENAI_MODEL || null,
    shopifyApp: Boolean(process.env.SHOPIFY_API_KEY && process.env.SHOPIFY_API_SECRET),
    tokenEncryptionKey: Boolean(process.env.TOKEN_ENCRYPTION_KEY),
    demoMode: isDemoMode,
    maxProductsPerScan: config.maxProductsPerScan,
    maxLlmCallsPerScan: config.maxLlmCallsPerScan,
  };
}
