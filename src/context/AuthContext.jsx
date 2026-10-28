import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { claimLegacyData } from "../utils/auth.js";

// Accounts live on the server (Supabase). The session is an httpOnly cookie the browser sends automatically.
const AuthContext = createContext(null);
const offline = { error: { form: "Couldn't reach the server. Make sure it's running (npm run dev) and try again." } };
const tooManyRequests = { error: { form: "Too many attempts. Please wait a minute and try again." } };

async function request(path, body) {
  try {
    const response = await fetch(`/api/auth/${path}`, {
      method: body ? "POST" : "GET",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 429 && typeof data.error !== "object") return tooManyRequests;
    if (!response.ok) return { error: data.error && typeof data.error === "object" ? data.error : offline.error };
    return data;
  } catch {
    return offline;
  }
}

export function AuthProvider({ children }) {
  // "loading" until the server says whether the session cookie is still valid.
  const [state, setState] = useState({ status: "loading", user: null });
  // Run before the session ends, e.g. to send unsaved changes while the cookie is still valid.
  const beforeLogout = useRef(new Set());
  const onBeforeLogout = useCallback((callback) => {
    beforeLogout.current.add(callback);
    return () => beforeLogout.current.delete(callback);
  }, []);

  useEffect(() => {
    let active = true;
    request("me").then((result) => {
      if (active) setState({ status: "ready", user: result.user ?? null });
    });
    return () => { active = false; };
  }, []);

  const value = useMemo(() => ({
    user: state.user,
    loading: state.status === "loading",
    async signUp({ name, email, password, confirmPassword, remember = true }) {
      const result = await request("signup", { name, email, password, confirmPassword, remember });
      if (result.user) {
        claimLegacyData(window.localStorage, result.user.id);
        setState({ status: "ready", user: result.user });
      }
      return result;
    },
    async logIn({ email, password, remember = true }) {
      const result = await request("login", { email, password, remember });
      if (result.user) setState({ status: "ready", user: result.user });
      return result;
    },
    onBeforeLogout,
    async logOut() {
      await Promise.all([...beforeLogout.current].map((callback) => Promise.resolve().then(callback).catch(() => {})));
      await request("logout", {});
      setState({ status: "ready", user: null });
    },
  }), [state, onBeforeLogout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider.");
  return context;
}
