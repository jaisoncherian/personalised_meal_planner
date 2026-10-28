import { randomUUID } from "node:crypto";
import express from "express";
import rateLimit from "express-rate-limit";
import { sessionUser } from "./auth.js";
import { ACTIVITY_LEVELS, BMR_FORMULAS, LEGACY_PACE_MAP, PACE_OPTIONS } from "../src/utils/nutritionConstants.js";

// Per-account app data: profile, onboarding draft, plan, favorites, grocery checks, settings, diary, foods, water
// and weights. The browser sends only what changed (PATCH /api/data); diary, water and weights are maps keyed by
// "YYYY-MM-DD" where null removes that day. Everything is checked here, so both stores receive clean values in
// the same shape the React app uses.

export const MAP_RESOURCES = ["diary", "water", "weights"];
export const RESOURCES = [
  "profile", "draft", "step", "plan", "favorites", "groceryChecks", "onlineRecipes",
  "diary", "customFoods", "savedMeals", "recentFoods", "water", "waterGoal", "weights",
];

// What GET /api/data returns for an account with nothing saved; the app then uses its own defaults.
export const emptyUserData = () => ({
  profile: null, draft: null, step: null, plan: null, favorites: [], groceryChecks: [], onlineRecipes: null,
  diary: {}, customFoods: [], savedMeals: [], recentFoods: [], water: {}, waterGoal: null, weights: [],
});

export const DIARY_SLOTS = ["breakfast", "lunch", "dinner", "snacks"];
const GENDERS = ["male", "female", "other"];
const GOALS = ["lose", "maintain", "gain"];
const DIETS = ["vegetarian", "non-vegetarian", "vegan", "eggetarian"];
const MAX_RECENT_FOODS = 50;

export class BadRequestError extends Error {}

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value, fallback = "") => (typeof value === "string" ? value : value == null ? fallback : String(value));
const amount = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
};
const inRange = (value, min, max) => {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
};
const oneOf = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);
const strings = (value) => (Array.isArray(value)
  ? [...new Set(value.filter((item) => item !== null && item !== undefined && typeof item !== "object").map(String))]
  : []);

export function isDateKey(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

// Values outside the allowed ones become empty, so the app's "profile needs update" screen asks for them again.
export function sanitizeProfile(profile) {
  const age = Number(profile.age);
  const pace = LEGACY_PACE_MAP[profile.pace] ?? profile.pace;
  return {
    name: text(profile.name),
    age: Number.isInteger(age) && age >= 15 && age <= 80 ? age : "",
    gender: oneOf(profile.gender, GENDERS, ""),
    formulaSex: oneOf(profile.formulaSex, ["", "male", "female"], ""),
    heightCm: inRange(profile.heightCm, 100, 250) ?? "",
    weightKg: inRange(profile.weightKg, 30, 300) ?? "",
    bodyFatPercent: inRange(profile.bodyFatPercent, 3, 60),
    bmrFormula: oneOf(profile.bmrFormula, Object.keys(BMR_FORMULAS), "mifflin"),
    units: oneOf(profile.units, ["metric", "imperial"], "metric"),
    activityLevel: oneOf(profile.activityLevel, Object.keys(ACTIVITY_LEVELS), ""),
    goal: oneOf(profile.goal, GOALS, "maintain"),
    targetWeightKg: inRange(profile.targetWeightKg, Number.MIN_VALUE, 1000),
    pace: oneOf(pace, Object.keys(PACE_OPTIONS), "standard"),
    dietType: oneOf(profile.dietType, DIETS, "vegetarian"),
    cuisinePreferences: Array.isArray(profile.cuisinePreferences) ? strings(profile.cuisinePreferences) : ["No preference"],
    mealsPerDay: oneOf(Number(profile.mealsPerDay), [3, 4], 4),
    maxCookingTime: oneOf(Number(profile.maxCookingTime), [15, 30, 60], 30),
    allergies: strings(profile.allergies),
    allergyInput: "",
    dislikedFoods: strings(profile.dislikedFoods),
    dislikeInput: "",
    healthConditions: strings(profile.healthConditions),
    // Profiles saved before this flag existed already had their preferences (see hasMealPreferences).
    preferencesSet: profile.preferencesSet !== false,
  };
}

function sanitizeDiaryEntry(entry) {
  const servings = Number(entry.servings);
  const loggedAt = new Date(entry.loggedAt);
  return {
    id: text(entry.id) || randomUUID(),
    name: text(entry.name),
    servings: Number.isFinite(servings) && servings > 0 ? servings : 1,
    calories: amount(entry.calories),
    protein: amount(entry.protein),
    carbs: amount(entry.carbs),
    fat: amount(entry.fat),
    source: text(entry.source) || "manual",
    loggedAt: Number.isNaN(loggedAt.getTime()) ? new Date().toISOString() : loggedAt.toISOString(),
  };
}

// A day with nothing logged is stored as "no day" (null); the app treats both the same.
function sanitizeDiaryDay(day) {
  if (day === null) return null;
  if (!isPlainObject(day)) throw new BadRequestError("A diary day must be an object.");
  const clean = Object.fromEntries(DIARY_SLOTS.map((slot) => [
    slot, (Array.isArray(day[slot]) ? day[slot] : []).filter(isPlainObject).map(sanitizeDiaryEntry),
  ]));
  return DIARY_SLOTS.some((slot) => clean[slot].length) ? clean : null;
}

function sanitizeFoods(list, name, defaultSource, withServingSize) {
  if (!Array.isArray(list)) throw new BadRequestError(`${name} must be a list.`);
  const seen = new Set();
  const foods = [];
  for (const food of list) {
    if (!isPlainObject(food)) continue;
    const id = text(food.id) || `${defaultSource}:${randomUUID()}`;
    if (seen.has(id)) continue;
    seen.add(id);
    foods.push({
      id,
      name: text(food.name),
      ...(withServingSize ? { servingSize: text(food.servingSize) } : {}),
      calories: amount(food.calories),
      protein: amount(food.protein),
      carbs: amount(food.carbs),
      fat: amount(food.fat),
      ingredients: Array.isArray(food.ingredients) ? food.ingredients : [],
      dietType: strings(food.dietType),
      source: text(food.source) || defaultSource,
    });
  }
  return foods;
}

function sanitizeDayMap(value, name, sanitizeDay) {
  if (!isPlainObject(value)) throw new BadRequestError(`${name} must be an object keyed by date.`);
  return Object.fromEntries(Object.entries(value).map(([date, day]) => {
    if (!isDateKey(date)) throw new BadRequestError(`${name} has an invalid date "${date}".`);
    return [date, sanitizeDay(day)];
  }));
}

const objectOrNull = (value, name) => {
  if (value === null || isPlainObject(value)) return value;
  throw new BadRequestError(`${name} must be an object or null.`);
};
const stringList = (value, name) => {
  if (!Array.isArray(value)) throw new BadRequestError(`${name} must be a list.`);
  return strings(value);
};
const wholeNumber = (value, name, min) => {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) throw new BadRequestError(`${name} must be a number.`);
  return Math.max(min, number);
};

const SANITIZERS = {
  profile: (value) => (objectOrNull(value, "profile") ? sanitizeProfile(value) : null),
  draft: (value) => objectOrNull(value, "draft"),
  step: (value) => wholeNumber(value, "step", 0),
  plan: (value) => objectOrNull(value, "plan"),
  favorites: (value) => stringList(value, "favorites"),
  groceryChecks: (value) => stringList(value, "groceryChecks"),
  onlineRecipes: (value) => value !== false,
  diary: (value) => sanitizeDayMap(value, "diary", sanitizeDiaryDay),
  customFoods: (value) => sanitizeFoods(value, "customFoods", "custom", true),
  savedMeals: (value) => sanitizeFoods(value, "savedMeals", "saved meal", false),
  recentFoods: (value) => {
    if (!Array.isArray(value)) throw new BadRequestError("recentFoods must be a list.");
    return value.filter(isPlainObject).slice(0, MAX_RECENT_FOODS);
  },
  water: (value) => sanitizeDayMap(value, "water", (glasses) => {
    if (glasses === null) return null;
    const count = wholeNumber(glasses, "water", 0);
    return count > 0 ? count : null;
  }),
  waterGoal: (value) => wholeNumber(value, "waterGoal", 1),
  weights: (value) => sanitizeDayMap(value, "weights", (kg) => {
    if (kg === null) return null;
    const number = Number(kg);
    if (!Number.isFinite(number) || number <= 0) throw new BadRequestError("A weight must be a positive number.");
    return number;
  }),
};

export function sanitizeChanges(changes) {
  if (!isPlainObject(changes)) throw new BadRequestError("Send the changes as an object.");
  return Object.fromEntries(Object.entries(changes).map(([key, value]) => {
    if (!SANITIZERS[key]) throw new BadRequestError(`Unknown field "${key}".`);
    return [key, SANITIZERS[key](value)];
  }));
}

// getStore() returns the store, or null while the database is unavailable.
export function createDataRouter(getStore, { rateLimits = true } = {}) {
  const router = express.Router();
  // Plans carry the recipe candidates they were built from, so they can be far larger than auth requests.
  router.use(express.json({ limit: "5mb" }));
  // Saves are debounced in the browser, but onboarding and the diary still send many small ones.
  if (rateLimits) router.use(rateLimit({ windowMs: 60 * 1000, limit: 300, standardHeaders: "draft-7", legacyHeaders: false, message: { error: "Too many saves at once. Retrying shortly." } }));

  const handle = (fn) => async (req, res) => {
    const store = getStore();
    if (!store) return res.status(503).json({ error: "Your saved data can't be reached right now. Check the server's database connection." });
    try {
      const user = await sessionUser(req, store);
      if (!user) return res.status(401).json({ error: "Your session has ended. Log in again to keep saving." });
      await fn(req, res, store, user);
    } catch (error) {
      if (error instanceof BadRequestError) return res.status(400).json({ error: error.message });
      console.error("Data request failed.", error);
      res.status(500).json({ error: "We couldn't reach your saved data. Please try again." });
    }
  };

  router.get("/", handle(async (req, res, store, user) => {
    res.json(await store.loadUserData(user.id));
  }));

  router.patch("/", handle(async (req, res, store, user) => {
    await store.saveUserData(user.id, sanitizeChanges(req.body?.changes));
    res.json({ ok: true });
  }));

  // Malformed or oversized JSON bodies get a JSON answer instead of Express's HTML error page.
  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    res.status(error.status || 500).json({ error: error.type === "entity.too.large" ? "That change is too large to save." : "The request could not be read." });
  });

  return router;
}
