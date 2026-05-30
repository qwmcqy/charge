import { createBrowserClient, createServerClient } from '@supabase/ssr';
import { createClient as baseClient } from '@supabase/supabase-js';
import type { cookies } from 'next/headers';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

let browserClient: ReturnType<typeof createBrowserClient> | null = null;

/** Browser client — for client components (has cookie auth) */
export function createClient() {
  if (!browserClient) {
    browserClient = createBrowserClient(supabaseUrl, supabaseAnonKey);
  }
  return browserClient;
}

/** Server client — for API routes / server components */
export async function createServerClientFromCookies(cookieStore: ReturnType<typeof cookies>) {
  const store = await cookieStore;
  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() { return store.getAll(); },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          store.set(name, value, options);
        }
      },
    },
  });
}

/** Service-role client — bypasses RLS, for backend operations. Works server-side without cookies. */
export function createServiceClient() {
  return baseClient(
    supabaseUrl,
    process.env.SUPABASE_SERVICE_ROLE_KEY || supabaseAnonKey,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

/** Single shared browser client instance */
export function getBrowserClient() {
  return createClient();
}

/** Default singleton — always uses service client.
 *  This ensures API routes, models, and services work server-side without cookie auth issues.
 *  Service-role key bypasses RLS (acceptable for this demo/educational system). */
export const supabase = createServiceClient();

export { supabaseUrl, supabaseAnonKey };
