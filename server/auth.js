import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import express from "express";
import rateLimit from "express-rate-limit";
import { normalizeEmail, publicUser, validateCredentials } from "../src/utils/auth.js";

const scryptAsync = promisify(scrypt);
export const SESSION_COOKIE = "gather_session";
const REMEMBER_MS = 30 * 24 * 60 * 60 * 1000;
// A session without "keep me signed in" uses a browser-session cookie; the server still expires it.
const SHORT_SESSION_MS = 24 * 60 * 60 * 1000;

export async function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  const hash = (await scryptAsync(password, salt, 64)).toString("hex");
  return { salt, hash };
}

export async function verifyPassword(password, { salt, hash }) {
  const candidate = Buffer.from((await hashPassword(password, salt)).hash, "hex");
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

// Only a hash of the session token is stored, so a database leak doesn't hand out live sessions.
const hashToken = (token) => createHash("sha256").update(token).digest("hex");

function readCookie(req, name) {
  for (const part of (req.headers.cookie || "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

// The signed-in user for this request's session cookie, or null. Also used by the data API (server/userData.js).
export async function sessionUser(req, store) {
  const token = readCookie(req, SESSION_COOKIE);
  const session = token && await store.findSession(hashToken(token));
  return session ? store.findUserById(session.userId) : null;
}

function cookieOptions(maxAge) {
  return { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", ...(maxAge ? { maxAge } : {}) };
}

// getStore() returns the store, or null while the database is unavailable.
export function createAuthRouter(getStore, { rateLimits = true } = {}) {
  const router = express.Router();
  const unavailable = { error: { form: "Accounts are unavailable right now. Check the server's database connection and try again." } };
  // Slows down password guessing on top of the general /api limit.
  const credentialLimiter = !rateLimits ? (req, res, next) => next() : rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: "draft-7", legacyHeaders: false, message: { error: { form: "Too many attempts. Please wait a few minutes and try again." } } });

  async function startSession(res, store, user, remember) {
    const token = randomBytes(32).toString("base64url");
    const lifetime = remember ? REMEMBER_MS : SHORT_SESSION_MS;
    await store.insertSession({ tokenHash: hashToken(token), userId: user.id, createdAt: new Date(), expiresAt: new Date(Date.now() + lifetime) });
    res.cookie(SESSION_COOKIE, token, cookieOptions(remember ? lifetime : undefined));
    res.json({ user: publicUser(user) });
  }

  const handle = (fn) => async (req, res) => {
    const store = getStore();
    if (!store) return res.status(503).json(unavailable);
    try {
      await fn(req, res, store);
    } catch (error) {
      console.error("Auth request failed.", error);
      res.status(500).json(unavailable);
    }
  };

  router.post("/signup", credentialLimiter, handle(async (req, res, store) => {
    const body = req.body ?? {};
    const errors = validateCredentials(body, "signup");
    if (Object.keys(errors).length) return res.status(400).json({ error: errors });
    const { salt, hash } = await hashPassword(String(body.password));
    const user = await store.insertUser({ name: String(body.name).trim(), email: normalizeEmail(body.email), salt, hash, createdAt: new Date() });
    if (!user) return res.status(409).json({ error: { email: "An account with this email already exists. Log in instead." } });
    await startSession(res, store, user, body.remember !== false);
  }));

  router.post("/login", credentialLimiter, handle(async (req, res, store) => {
    const body = req.body ?? {};
    const errors = validateCredentials(body, "login");
    if (Object.keys(errors).length) return res.status(400).json({ error: errors });
    const user = await store.findUserByEmail(normalizeEmail(body.email));
    // Same message (and similar timing) for an unknown email and a wrong password.
    const valid = user ? await verifyPassword(String(body.password), user) : (await hashPassword(String(body.password)), false);
    if (!valid) return res.status(401).json({ error: { form: "That email and password don't match an account." } });
    await startSession(res, store, user, body.remember !== false);
  }));

  router.get("/me", handle(async (req, res, store) => {
    const user = await sessionUser(req, store);
    res.json({ user: user ? publicUser(user) : null });
  }));

  router.post("/logout", handle(async (req, res, store) => {
    const token = readCookie(req, SESSION_COOKIE);
    if (token) await store.deleteSession(hashToken(token));
    res.clearCookie(SESSION_COOKIE, cookieOptions());
    res.json({ user: null });
  }));

  return router;
}
