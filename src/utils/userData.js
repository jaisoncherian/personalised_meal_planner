import { userKey } from "./auth.js";

// Each account's data is saved on the server (/api/data, stored in Supabase). The providers still name their values
// by the localStorage keys they used before, and this maps each key to its field in the API.
export const STORAGE_KEY_RESOURCES = Object.freeze({
  "gather-v2-profile": "profile",
  "gather-v3-wizard-draft": "draft",
  "gather-v5-onboarding-step": "step",
  "gather-v2-plan": "plan",
  "gather-v2-favorites": "favorites",
  "gather-v2-grocery-checks": "groceryChecks",
  "gather-v2-online-recipes": "onlineRecipes",
  "gather-v2-diary": "diary",
  "gather-v2-custom-foods": "customFoods",
  "gather-v2-saved-meals": "savedMeals",
  "gather-v2-recent-foods": "recentFoods",
  "gather-v2-water": "water",
  "gather-v2-water-goal": "waterGoal",
  "gather-v2-weights": "weights",
});

const DAY_MAP_RESOURCES = ["diary", "water", "weights"];
// Accounts from before the move to Supabase had MongoDB ids, which is what their localStorage keys end with.
const MONGO_ID = /^[0-9a-f]{24}$/;

const sameJson = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const weightsByDate = (weights) => Object.fromEntries((Array.isArray(weights) ? weights : []).map(({ date, kg }) => [date, kg]));

function changedDays(saved = {}, current = {}) {
  const changes = {};
  for (const date of new Set([...Object.keys(saved), ...Object.keys(current)])) {
    if (current[date] === undefined) {
      if (saved[date] !== undefined) changes[date] = null;
    } else if (!sameJson(saved[date], current[date])) {
      changes[date] = current[date];
    }
  }
  return changes;
}

// What to send for one field: the whole value, or for the diary, water and weights only the days that changed
// (null removes a day). Returns undefined when nothing needs sending.
export function resourceChange(resource, saved, current) {
  if (DAY_MAP_RESOURCES.includes(resource)) {
    const changes = resource === "weights"
      ? changedDays(weightsByDate(saved), weightsByDate(current))
      : changedDays(saved ?? {}, current ?? {});
    return Object.keys(changes).length ? changes : undefined;
  }
  return sameJson(saved, current) ? undefined : current;
}

function readUserKeys(storage, ownerId) {
  const data = {};
  for (const [key, resource] of Object.entries(STORAGE_KEY_RESOURCES)) {
    try {
      const stored = storage.getItem(userKey(key, ownerId));
      if (stored !== null) data[resource] = JSON.parse(stored);
    } catch (error) {
      console.error(`Could not read saved "${key}" from this browser.`, error);
    }
  }
  return data;
}

// Data this browser saved before accounts moved to the server: first under this account's own id, otherwise under the
// one MongoDB-era account it holds (skipped when there are several, since they may belong to different people).
export function findLocalUserData(storage, userId) {
  const own = readUserKeys(storage, userId);
  if (Object.keys(own).length) return { ownerId: userId, data: own };
  const mongoOwners = new Set();
  for (let index = 0; index < storage.length; index += 1) {
    const [key, ownerId] = (storage.key(index) || "").split(":");
    if (STORAGE_KEY_RESOURCES[key] && MONGO_ID.test(ownerId || "")) mongoOwners.add(ownerId);
  }
  if (mongoOwners.size !== 1) return { ownerId: userId, data: {} };
  const [ownerId] = mongoOwners;
  return { ownerId, data: readUserKeys(storage, ownerId) };
}

// Removes local copies once the server has them, so they are not imported again.
export function removeLocalUserData(storage, ownerId, resources) {
  for (const [key, resource] of Object.entries(STORAGE_KEY_RESOURCES)) {
    if (resources.includes(resource)) storage.removeItem(userKey(key, ownerId));
  }
}
