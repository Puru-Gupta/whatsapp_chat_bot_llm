import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import {
  getSupabasePublishableKey,
  getSupabaseUrl,
  requireEnv,
} from "@/lib/env";

// Server component client (uses cookies for auth)
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    getSupabaseUrl(),
    getSupabasePublishableKey(),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setAll(cookiesToSet: any[]) {
          try {
            cookiesToSet.forEach(
              ({ name, value, options }: { name: string; value: string; options?: object }) =>
                cookieStore.set(name, value, options)
            );
          } catch {
            // Called from Server Component — cookies are read-only
          }
        },
      },
    }
  );
}

// Service role client — bypasses RLS, server-side only
export function createServiceClient() {
  return createSupabaseClient(
    getSupabaseUrl(),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}
