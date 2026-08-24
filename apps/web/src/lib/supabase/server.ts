import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseEnvironment } from "./env";
import type { Database } from "./database.types";

export async function createClient() {
  const cookieStore = await cookies();
  const { key, url } = getSupabaseEnvironment();

  return createServerClient<Database>(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, options, value }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Components cannot write cookies. src/proxy.ts refreshes
          // the session and persists any changed cookies on the response.
        }
      },
    },
  });
}
