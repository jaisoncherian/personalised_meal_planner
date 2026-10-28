import test from "node:test";
import assert from "node:assert/strict";
import { findLocalUserData, removeLocalUserData, resourceChange } from "../src/utils/userData.js";

function memoryStorage(entries = {}) {
  const map = new Map(Object.entries(entries));
  return {
    get length() { return map.size; },
    key: (index) => [...map.keys()][index] ?? null,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

test("whole values are sent only when they changed", () => {
  assert.equal(resourceChange("favorites", ["a"], ["a"]), undefined);
  assert.deepEqual(resourceChange("favorites", ["a"], ["a", "b"]), ["a", "b"]);
  assert.equal(resourceChange("profile", { name: "A" }, null), null);
});

test("the diary and water send only the days that changed", () => {
  const day = (name) => ({ breakfast: [{ id: name, name }], lunch: [], dinner: [], snacks: [] });
  const saved = { "2026-01-01": day("a"), "2026-01-02": day("b") };
  const current = { "2026-01-01": day("a"), "2026-01-03": day("c") };
  assert.deepEqual(resourceChange("diary", saved, current), { "2026-01-02": null, "2026-01-03": day("c") });
  assert.equal(resourceChange("water", { "2026-01-01": 2 }, { "2026-01-01": 2 }), undefined);
  assert.deepEqual(resourceChange("water", {}, { "2026-01-01": 1 }), { "2026-01-01": 1 });
});

test("weights are compared by date", () => {
  assert.deepEqual(
    resourceChange("weights", [{ date: "2026-01-01", kg: 80 }], [{ date: "2026-01-01", kg: 79.5 }, { date: "2026-01-02", kg: 79 }]),
    { "2026-01-01": 79.5, "2026-01-02": 79 },
  );
});

test("local data is found under the account's id, else under a single MongoDB-era account", () => {
  const own = memoryStorage({ "gather-v2-plan:user-1": JSON.stringify({ days: [] }) });
  assert.deepEqual(findLocalUserData(own, "user-1"), { ownerId: "user-1", data: { plan: { days: [] } } });

  const mongoId = "65f1c0ffee65f1c0ffee65f1";
  const legacy = memoryStorage({ [`gather-v2-favorites:${mongoId}`]: JSON.stringify(["b01"]), "gather-v3-theme": "\"dark\"" });
  assert.deepEqual(findLocalUserData(legacy, "user-2"), { ownerId: mongoId, data: { favorites: ["b01"] } });
  removeLocalUserData(legacy, mongoId, ["favorites"]);
  assert.deepEqual(findLocalUserData(legacy, "user-2").data, {});
  assert.equal(legacy.getItem("gather-v3-theme"), "\"dark\"");

  const shared = memoryStorage({
    "gather-v2-favorites:65f1c0ffee65f1c0ffee65f1": "[]",
    "gather-v2-favorites:65f1c0ffee65f1c0ffee65f2": "[]",
  });
  assert.deepEqual(findLocalUserData(shared, "user-3").data, {});
});
