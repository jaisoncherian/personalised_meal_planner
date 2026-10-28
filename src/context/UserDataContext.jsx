import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "./AuthContext.jsx";
import { findLocalUserData, removeLocalUserData, resourceChange } from "../utils/userData.js";

// Holds the signed-in account's data (profile, plan, diary, …) loaded from /api/data. Changes show at once and are
// saved in the background: a short pause groups quick edits, one save runs at a time so the server applies them in
// order, and failed saves are kept and retried.
const UserDataContext = createContext(null);
const SAVE_DELAY_MS = 400;
const RETRY_DELAYS_MS = [2000, 5000, 15000, 30000];
// Browsers only let small requests outlive the page (fetch keepalive), so larger ones are sent normally.
const KEEPALIVE_LIMIT = 60 * 1024;

async function api(method, body, { keepalive = false } = {}) {
  let response;
  try {
    response = await fetch("/api/data", {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body,
      credentials: "same-origin",
      keepalive,
    });
  } catch {
    throw Object.assign(new Error("Couldn't reach the server. Make sure it's running (npm run dev)."), { status: 0 });
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error(typeof data.error === "string" ? data.error : "The server couldn't handle that request."), { status: response.status });
  }
  return data;
}

export function UserDataProvider({ children }) {
  const { user, logOut, onBeforeLogout } = useAuth();
  const [load, setLoad] = useState({ status: "loading", attempt: 0 });
  const [values, setValues] = useState({});
  const [saveError, setSaveError] = useState("");
  const current = useRef({});
  const saved = useRef({});
  const dirty = useRef(new Set());
  const imported = useRef({ ownerId: null, resources: new Set() });
  const timer = useRef(null);
  const queue = useRef(Promise.resolve());
  const failures = useRef(0);
  const flushRef = useRef(null);

  const sendChanges = useCallback(async ({ keepalive = false } = {}) => {
    clearTimeout(timer.current);
    timer.current = null;
    const resources = [...dirty.current];
    dirty.current.clear();
    const snapshot = {};
    const changes = {};
    for (const resource of resources) {
      snapshot[resource] = current.current[resource];
      const change = resourceChange(resource, saved.current[resource], snapshot[resource]);
      if (change !== undefined) changes[resource] = change;
    }
    if (!Object.keys(changes).length) return;
    const body = JSON.stringify({ changes });
    try {
      await api("PATCH", body, { keepalive: keepalive && body.length < KEEPALIVE_LIMIT });
      saved.current = { ...saved.current, ...snapshot };
      failures.current = 0;
      setSaveError("");
      const done = resources.filter((resource) => imported.current.resources.has(resource));
      if (done.length) {
        removeLocalUserData(window.localStorage, imported.current.ownerId, done);
        done.forEach((resource) => imported.current.resources.delete(resource));
      }
    } catch (error) {
      if (error.status === 400) {
        // The server rejected the change itself; sending it again would fail the same way.
        console.error("A change was rejected by the server.", error);
        setSaveError(`Some changes couldn't be saved: ${error.message}`);
        return;
      }
      resources.forEach((resource) => dirty.current.add(resource));
      setSaveError(error.status === 401 ? error.message : `Your changes aren't saved yet. ${error.message} Retrying…`);
      if (error.status !== 401) {
        const delay = RETRY_DELAYS_MS[Math.min(failures.current, RETRY_DELAYS_MS.length - 1)];
        failures.current += 1;
        timer.current = setTimeout(() => flushRef.current(), delay);
      }
    }
  }, []);

  // Resolves once everything changed so far has been sent (or has failed and is queued for a retry).
  const flush = useCallback(() => {
    queue.current = queue.current.then(() => sendChanges());
    return queue.current;
  }, [sendChanges]);
  flushRef.current = flush;

  const setValue = useCallback((resource, next, fallback) => {
    const previous = current.current[resource] ?? fallback;
    const value = typeof next === "function" ? next(previous) : next;
    if (Object.is(value, previous)) return;
    current.current = { ...current.current, [resource]: value };
    setValues(current.current);
    dirty.current.add(resource);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => flush(), SAVE_DELAY_MS);
  }, [flush]);

  useEffect(() => {
    let active = true;
    api("GET").then(({ data, empty }) => {
      if (!active) return;
      let next = data;
      // A new account adopts what this browser saved before data moved to the server.
      if (empty) {
        const local = findLocalUserData(window.localStorage, user.id);
        const resources = Object.keys(local.data);
        if (resources.length) {
          next = { ...data, ...local.data };
          imported.current = { ownerId: local.ownerId, resources: new Set(resources) };
          resources.forEach((resource) => dirty.current.add(resource));
        }
      }
      saved.current = data;
      current.current = next;
      setValues(next);
      setLoad((state) => ({ ...state, status: "ready" }));
      if (dirty.current.size) flush();
    }).catch((error) => {
      if (active) setLoad((state) => ({ ...state, status: "error", message: error.message, signedOut: error.status === 401 }));
    });
    return () => { active = false; };
  }, [user.id, load.attempt, flush]);

  // Send pending changes before logging out, and when the tab is hidden or closed.
  useEffect(() => onBeforeLogout(flush), [onBeforeLogout, flush]);
  useEffect(() => {
    const sendNow = () => {
      if (dirty.current.size) sendChanges({ keepalive: true });
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") sendNow();
    };
    window.addEventListener("pagehide", sendNow);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", sendNow);
      document.removeEventListener("visibilitychange", onVisibility);
      clearTimeout(timer.current);
    };
  }, [sendChanges]);

  const value = useMemo(() => ({ values, setValue, flush }), [values, setValue, flush]);

  if (load.status === "loading") return <div className="auth-loading" role="status">Loading your data…</div>;
  if (load.status === "error") {
    return <div className="auth-loading" role="alert"><div className="data-load-error">
      <p>{load.message}</p>
      <div className="data-load-actions">
        {!load.signedOut && <button className="button button-primary" type="button" onClick={() => setLoad((state) => ({ status: "loading", attempt: state.attempt + 1 }))}>Try again</button>}
        <button className={`button ${load.signedOut ? "button-primary" : "button-outline"}`} type="button" onClick={logOut}>Log in again</button>
      </div>
    </div></div>;
  }
  return <UserDataContext.Provider value={value}>
    {children}
    {saveError && <div className="save-status" role="alert"><span>{saveError}</span><button type="button" onClick={() => flush()}>Retry now</button></div>}
  </UserDataContext.Provider>;
}

export function useUserData() {
  const context = useContext(UserDataContext);
  if (!context) throw new Error("useUserData must be used inside UserDataProvider.");
  return context;
}
