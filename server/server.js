import dotenv from "dotenv";
import { createApp } from "./app.js";
import { createMemoryStore } from "./memoryStore.js";
import { createSupabaseClient } from "./supabase.js";
import { createSupabaseStore } from "./supabaseStore.js";

dotenv.config();

const port = Number(process.env.PORT) || 3001;
const RETRY_MS = 30 * 1000;
let store = null;

// The server starts even if Supabase is unreachable, so recipes keep working; account and data requests get a 503
// until the connection check passes, and the check is retried until it does.
async function connectStore() {
  if (process.env.AUTH_STORE === "memory") {
    store = createMemoryStore();
    console.log("Accounts and data use an in-memory store (AUTH_STORE=memory); they are lost on restart.");
    return;
  }
  const { SUPABASE_URL: url, SUPABASE_SECRET_KEY: secretKey } = process.env;
  if (!url || !secretKey) {
    console.warn("SUPABASE_URL and SUPABASE_SECRET_KEY are not set, so login, sign-up and saving are unavailable. Add them to .env.");
    return;
  }
  const candidate = createSupabaseStore(createSupabaseClient(url, secretKey));
  try {
    await candidate.ping();
    store = candidate;
    console.log("Connected to Supabase.");
  } catch (error) {
    console.error(`Could not connect to Supabase. Check SUPABASE_URL, SUPABASE_SECRET_KEY, and that supabase/schema.sql has been run. Retrying in ${RETRY_MS / 1000}s.`, error.message);
    setTimeout(connectStore, RETRY_MS);
  }
}

createApp({ getStore: () => store }).listen(port, () => {
  console.log(`API server listening on http://localhost:${port}`);
});
connectStore();
