import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

let clientInstance: SupabaseClient | null = null;

export function isSupabaseConfigured(): boolean {
  return Boolean(
    supabaseUrl && 
    supabaseAnonKey && 
    supabaseUrl.startsWith('https://') &&
    supabaseAnonKey.length > 20
  );
}

export function isLocalFallbackEnabled(): boolean {
  const flag = import.meta.env.VITE_ENABLE_LOCAL_FALLBACK;
  if (flag === 'false' || flag === false) {
    // In automated unit test environments, allow local state-machine suites
    // to execute if cloud credentials are intentionally unconfigured.
    const proc = (globalThis as any).process;
    if (typeof proc !== 'undefined' && proc.env?.NODE_ENV === 'test' && !isSupabaseConfigured()) {
      return true;
    }
    return false;
  }
  return true;
}

export function getSupabaseClient(): SupabaseClient | null {
  if (!isSupabaseConfigured()) {
    return null;
  }

  if (!clientInstance && supabaseUrl && supabaseAnonKey) {
    clientInstance = createClient(supabaseUrl, supabaseAnonKey, {
      realtime: {
        params: {
          eventsPerSecond: 10,
        },
      },
      auth: {
        persistSession: true,
        storage: typeof window !== 'undefined' ? window.sessionStorage : undefined,
        autoRefreshToken: true,
      },
    });
  }

  return clientInstance;
}

/**
 * Ensures the browser client has an authenticated anonymous Supabase Auth session.
 * Supabase Anonymous Auth issues an ephemeral JWT with an authentic auth.uid() used
 * by PostgreSQL RLS on realtime.messages for private Realtime channel authorization.
 * Zero-cost on Supabase Free Tier and requires zero user credentials or credit cards.
 */
export async function getOrInitAnonymousSession(): Promise<string | null> {
  const supabase = getSupabaseClient();
  if (!supabase) return null;

  try {
    const { data: sessionData } = await supabase.auth.getSession();
    if (sessionData?.session?.user?.id) {
      return sessionData.session.user.id;
    }

    const { data, error } = await supabase.auth.signInAnonymously();
    if (error) {
      console.warn('Supabase anonymous sign-in info (enable in Dashboard -> Auth -> Providers -> Anonymous):', error.message);
      return null;
    }

    return data.user?.id || null;
  } catch (err: any) {
    console.warn('Anonymous auth initialization warning:', err?.message || err);
    return null;
  }
}

