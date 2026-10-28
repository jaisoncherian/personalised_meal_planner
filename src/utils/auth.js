// Shared by the login page and the server (server/auth.js), which stores accounts in Supabase.

export const MIN_PASSWORD_LENGTH = 8;
const LEGACY_CLAIMED_KEY = "gather-v1-legacy-claimed";

// Per-person data that existed before accounts; the first account signed up in a browser adopts it.
export const LEGACY_USER_KEYS = [
  "gather-v2-profile", "gather-v3-wizard-draft", "gather-v5-onboarding-step",
  "gather-v2-plan", "gather-v2-favorites", "gather-v2-grocery-checks", "gather-v2-online-recipes",
  "gather-v2-diary", "gather-v2-custom-foods", "gather-v2-saved-meals", "gather-v2-recent-foods",
  "gather-v2-water", "gather-v2-water-goal", "gather-v2-weights",
];

export const normalizeEmail = (email) => String(email ?? "").trim().toLowerCase();

// Storage key for one user's copy of a value.
export const userKey = (key, userId) => `${key}:${userId}`;

export function validateCredentials({ name, email, password, confirmPassword }, mode = "login") {
  const errors = {};
  if (mode === "signup" && !String(name ?? "").trim()) errors.name = "Enter your name.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email))) errors.email = "Enter a valid email address.";
  if (mode === "signup") {
    if (String(password ?? "").length < MIN_PASSWORD_LENGTH) errors.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
    if (password !== confirmPassword) errors.confirmPassword = "Passwords don't match.";
  } else if (!password) {
    errors.password = "Enter your password.";
  }
  return errors;
}

export const publicUser = ({ id, name, email }) => ({ id, name, email });

// Copies pre-account data into the first new user's keys so an existing plan isn't lost. Runs once per browser.
export function claimLegacyData(storage, userId) {
  if (storage.getItem(LEGACY_CLAIMED_KEY) !== null) return;
  storage.setItem(LEGACY_CLAIMED_KEY, JSON.stringify(userId));
  for (const key of LEGACY_USER_KEYS) {
    const value = storage.getItem(key);
    if (value !== null && storage.getItem(userKey(key, userId)) === null) storage.setItem(userKey(key, userId), value);
  }
}
