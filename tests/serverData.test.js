import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server/app.js";
import { createMemoryStore } from "../server/memoryStore.js";
import { sanitizeChanges } from "../server/userData.js";

let server;
let baseUrl;
let store = createMemoryStore();

before(async () => {
  server = createApp({ getStore: () => store }).listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => server.close());

async function signUp(email) {
  const response = await fetch(`${baseUrl}/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Sam", email, password: "correct horse", confirmPassword: "correct horse" }),
  });
  return response.headers.get("set-cookie").split(";")[0];
}

async function data(cookie, changes) {
  const response = await fetch(`${baseUrl}/data`, {
    method: changes ? "PATCH" : "GET",
    headers: { ...(changes ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: changes ? JSON.stringify({ changes }) : undefined,
  });
  return { status: response.status, body: await response.json() };
}

const entry = { id: "e1", name: "Oats", servings: 1, calories: 300, protein: 10, carbs: 50, fat: 5, source: "manual", loggedAt: "2026-01-02T08:00:00.000Z" };

test("data needs a signed-in user", async () => {
  assert.equal((await data(null)).status, 401);
  assert.equal((await data(null, { step: 1 })).status, 401);
});

test("a new account starts empty, then saves and reads back its data", async () => {
  const cookie = await signUp("data@example.com");
  const first = await data(cookie);
  assert.equal(first.status, 200);
  assert.equal(first.body.empty, true);
  assert.equal(first.body.data.profile, null);

  const saved = await data(cookie, {
    favorites: ["b01", "b01", "spoonacular:5"],
    diary: { "2026-01-02": { breakfast: [entry], lunch: [], dinner: [], snacks: [] } },
    water: { "2026-01-02": 3 },
    weights: { "2026-01-02": 80.5 },
    waterGoal: 10,
  });
  assert.equal(saved.status, 200);
  const { body } = await data(cookie);
  assert.equal(body.empty, false);
  assert.deepEqual(body.data.favorites, ["b01", "spoonacular:5"]);
  assert.deepEqual(body.data.diary["2026-01-02"].breakfast, [entry]);
  assert.deepEqual(body.data.water, { "2026-01-02": 3 });
  assert.deepEqual(body.data.weights, [{ date: "2026-01-02", kg: 80.5 }]);
  assert.equal(body.data.waterGoal, 10);

  // null removes a day; days not mentioned are left alone.
  await data(cookie, { diary: { "2026-01-02": null }, water: { "2026-01-03": 1 } });
  const later = (await data(cookie)).body.data;
  assert.deepEqual(later.diary, {});
  assert.deepEqual(later.water, { "2026-01-02": 3, "2026-01-03": 1 });
});

test("each account only sees its own data", async () => {
  const sam = await signUp("sam-data@example.com");
  const ana = await signUp("ana-data@example.com");
  await data(sam, { step: 3 });
  assert.equal((await data(ana)).body.data.step, null);
});

test("bad changes are rejected with 400", async () => {
  const cookie = await signUp("bad@example.com");
  assert.equal((await data(cookie, { nope: 1 })).status, 400);
  assert.equal((await data(cookie, { favorites: "b01" })).status, 400);
  assert.equal((await data(cookie, { diary: { "2026-02-30": null } })).status, 400);
  assert.equal((await data(cookie, { weights: { "2026-01-01": -1 } })).status, 400);
});

test("large plans fit, and data answers 503 while the database is unavailable", async () => {
  const cookie = await signUp("big@example.com");
  const plan = { candidatePool: Array.from({ length: 2000 }, (_, index) => ({ id: `spoonacular:${index}`, name: "x".repeat(100) })) };
  assert.equal((await data(cookie, { plan })).status, 200);
  const saved = store;
  store = null;
  try {
    assert.equal((await data(cookie)).status, 503);
  } finally {
    store = saved;
  }
});

test("profiles are cleaned to fit the database", () => {
  const { profile } = sanitizeChanges({ profile: { name: "Ana", age: "40", gender: "female", pace: "slow", activityLevel: "unknown", mealsPerDay: "3" } });
  assert.equal(profile.age, 40);
  assert.equal(profile.pace, "mild");
  assert.equal(profile.activityLevel, "");
  assert.equal(profile.mealsPerDay, 3);
  // Profiles saved before the flag existed keep counting as having preferences.
  assert.equal(profile.preferencesSet, true);
  assert.equal(sanitizeChanges({ profile: { preferencesSet: false } }).profile.preferencesSet, false);
});

test("diary entries and empty days are normalised", () => {
  const { diary } = sanitizeChanges({ diary: {
    "2026-01-01": { breakfast: [], lunch: [], dinner: [], snacks: [] },
    "2026-01-02": { snacks: [{ id: "x", name: "Tea", servings: 0, calories: -5, loggedAt: "nope" }] },
  } });
  assert.equal(diary["2026-01-01"], null);
  const [tea] = diary["2026-01-02"].snacks;
  assert.equal(tea.servings, 1);
  assert.equal(tea.calories, 0);
  assert.ok(!Number.isNaN(Date.parse(tea.loggedAt)));
});
