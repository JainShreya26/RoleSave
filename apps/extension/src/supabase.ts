import { createClient, type SupportedStorage } from "@supabase/supabase-js";

const storage: SupportedStorage = {
  async getItem(key) {
    const result = await chrome.storage.local.get(key);
    return typeof result[key] === "string" ? result[key] : null;
  },
  async setItem(key, value) {
    await chrome.storage.local.set({ [key]: value });
  },
  async removeItem(key) {
    await chrome.storage.local.remove(key);
  },
};

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseKey);

export const supabase = createClient(supabaseUrl || "https://invalid.supabase.co", supabaseKey || "invalid", {
  auth: {
    autoRefreshToken: true,
    detectSessionInUrl: false,
    persistSession: true,
    storage,
  },
});
