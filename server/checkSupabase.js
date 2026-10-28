// npm run db:check — checks the Supabase setup end to end: the keys, every table, the replace_* functions and
// the row mapping. It creates a throwaway account, saves and reads back each kind of data, then deletes it.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import { createSupabaseClient } from "./supabase.js";
import { createSupabaseStore } from "./supabaseStore.js";
import { sanitizeChanges } from "./userData.js";

dotenv.config();

const { SUPABASE_URL: url, SUPABASE_SECRET_KEY: secretKey } = process.env;
if (!url || !secretKey) {
  console.error("Set SUPABASE_URL and SUPABASE_SECRET_KEY in .env first.");
  process.exit(1);
}

const store = createSupabaseStore(createSupabaseClient(url, secretKey));
const step = (label) => console.log(`- ${label}`);
let user = null;

const entry = (id, name, calories) => ({ id, name, servings: 1.5, calories, protein: 10.5, carbs: 20, fat: 5, source: "manual", loggedAt: "2026-01-02T08:30:00.000Z" });
const changes = sanitizeChanges({
  profile: { name: "Check", age: 30, gender: "male", formulaSex: "", heightCm: 180, weightKg: 80, bodyFatPercent: null, bmrFormula: "mifflin", units: "metric", activityLevel: "moderate", goal: "lose", targetWeightKg: 75, pace: "standard", dietType: "vegan", cuisinePreferences: ["No preference"], mealsPerDay: 3, maxCookingTime: 15, allergies: ["peanuts"], dislikedFoods: ["okra"], healthConditions: [], preferencesSet: true },
  draft: { name: "Check", age: "30" },
  step: 2,
  plan: { days: [{ meals: [{ slot: "breakfast", meal: { id: "b01" } }] }], targetCalories: 2260 },
  favorites: ["b01", "spoonacular:123"],
  groceryChecks: ["rice|g"],
  onlineRecipes: false,
  diary: { "2026-01-02": { breakfast: [entry("a", "Oats", 300), entry("b", "Tea", 20)], lunch: [], dinner: [], snacks: [entry("c", "Apple", 95)] } },
  customFoods: [{ id: "custom:1", name: "Protein bar", servingSize: "1 bar", calories: 200, protein: 20, carbs: 22, fat: 6, ingredients: [{ name: "Protein bar" }], dietType: ["vegetarian"], source: "custom" }],
  savedMeals: [{ id: "saved:1", name: "Breakfast combo", calories: 320, protein: 12, carbs: 50, fat: 8, ingredients: [{ name: "Oats" }, { name: "Tea" }], dietType: ["vegan", "vegetarian"], source: "saved meal" }],
  recentFoods: [{ id: "b01", name: "Masala poha", calories: 340 }],
  water: { "2026-01-02": 5 },
  waterGoal: 9,
  weights: { "2026-01-01": 80.4, "2026-01-02": 80.1 },
});

try {
  step("connection and users table");
  await store.ping();

  step("sign-up, duplicate email, lookups");
  const email = `db-check-${randomUUID()}@example.com`;
  user = await store.insertUser({ name: "DB check", email, salt: "00", hash: "00", createdAt: new Date() });
  assert.ok(user?.id, "insertUser returned no id");
  assert.equal(await store.insertUser({ name: "Again", email, salt: "00", hash: "00", createdAt: new Date() }), null, "duplicate email was not rejected");
  assert.equal((await store.findUserByEmail(email)).id, user.id);
  assert.equal((await store.findUserById(user.id)).email, email);

  step("sessions");
  const tokenHash = `db-check-${randomUUID()}`;
  await store.insertSession({ tokenHash, userId: user.id, createdAt: new Date(), expiresAt: new Date(Date.now() + 60000) });
  assert.equal((await store.findSession(tokenHash)).userId, user.id);
  await store.deleteSession(tokenHash);
  assert.equal(await store.findSession(tokenHash), null);

  step("a new account has no data");
  assert.equal((await store.loadUserData(user.id)).empty, true);

  step("save and read back every kind of data");
  await store.saveUserData(user.id, changes);
  const { data, empty } = await store.loadUserData(user.id);
  assert.equal(empty, false);
  assert.deepEqual(data.profile, changes.profile);
  assert.deepEqual(data.draft, changes.draft);
  assert.equal(data.step, 2);
  assert.deepEqual(data.plan, changes.plan);
  assert.deepEqual(data.favorites, changes.favorites);
  assert.deepEqual(data.groceryChecks, changes.groceryChecks);
  assert.equal(data.onlineRecipes, false);
  assert.deepEqual(data.diary, changes.diary);
  assert.deepEqual(data.customFoods, changes.customFoods);
  assert.deepEqual(data.savedMeals, changes.savedMeals);
  assert.deepEqual(data.recentFoods, changes.recentFoods);
  assert.deepEqual(data.water, changes.water);
  assert.equal(data.waterGoal, 9);
  assert.deepEqual(data.weights, [{ date: "2026-01-01", kg: 80.4 }, { date: "2026-01-02", kg: 80.1 }]);

  step("removing days, lists and the plan");
  await store.saveUserData(user.id, sanitizeChanges({ diary: { "2026-01-02": null }, water: { "2026-01-02": null }, weights: { "2026-01-01": null }, favorites: [], plan: null }));
  const after = (await store.loadUserData(user.id)).data;
  assert.deepEqual(after.diary, {});
  assert.deepEqual(after.water, {});
  assert.deepEqual(after.weights, [{ date: "2026-01-02", kg: 80.1 }]);
  assert.deepEqual(after.favorites, []);
  assert.equal(after.plan, null);

  console.log("\nSupabase is set up correctly.");
} catch (error) {
  console.error(`\nSupabase check failed: ${error.message}`);
  console.error("Make sure supabase/schema.sql has been run in the SQL Editor and the keys in .env belong to that project.");
  process.exitCode = 1;
} finally {
  // Deleting the user removes its sessions and data too (on delete cascade).
  if (user?.id) await store.deleteUser(user.id).catch((error) => console.error("Could not delete the check account:", error.message));
}
