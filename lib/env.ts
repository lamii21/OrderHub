// Fails fast with a clear message instead of letting a missing env var surface
// later as a confusing error deep inside Supabase/Google/Shopify client code.
export function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. Check your .env.local file (see .env.local.example).`
    );
  }

  return value;
}
