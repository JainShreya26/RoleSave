"use client";

import { createBrowserClient } from "@supabase/ssr";
import { getSupabaseEnvironment } from "./env";
import type { Database } from "./database.types";

export function createClient() {
  const { key, url } = getSupabaseEnvironment();
  return createBrowserClient<Database>(url, key);
}
