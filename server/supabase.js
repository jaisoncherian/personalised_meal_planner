import { createClient } from "@supabase/supabase-js";

// Server-only client. The secret key bypasses Row Level Security, so it must never reach the browser bundle
// (nothing under src/ imports this file).
export function createSupabaseClient(url, secretKey) {
  // supabase-js adds /rest/v1 itself, so a URL copied with that path (or any other) would double it.
  return createClient(new URL(url).origin, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

// Every supabase-js call resolves to { data, error }; this turns an error into a thrown one with context.
export class DatabaseError extends Error {
  constructor(action, error) {
    super(`Supabase ${action} failed: ${error.message}`);
    this.name = "DatabaseError";
    this.code = error.code;
    this.details = error.details;
  }
}

export function must({ data, error }, action) {
  if (error) throw new DatabaseError(action, error);
  return data;
}
