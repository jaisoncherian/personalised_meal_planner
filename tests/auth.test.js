import test from "node:test";
import assert from "node:assert/strict";
import { claimLegacyData, userKey, validateCredentials } from "../src/utils/auth.js";

const memoryStorage = (entries = {}) => {
  const data = new Map(Object.entries(entries));
  return { getItem: (key) => (data.has(key) ? data.get(key) : null), setItem: (key, value) => data.set(key, String(value)) };
};

test("login and sign-up forms are validated", () => {
  assert.deepEqual(validateCredentials({ email: "sam@example.com", password: "x" }), {});
  assert.ok(validateCredentials({ email: "not-an-email", password: "" }).email);
  assert.ok(validateCredentials({ email: "sam@example.com", password: "" }).password);
  const signup = validateCredentials({ name: " ", email: "sam@example.com", password: "short", confirmPassword: "other" }, "signup");
  assert.deepEqual(Object.keys(signup).sort(), ["confirmPassword", "name", "password"]);
  assert.deepEqual(validateCredentials({ name: "Sam", email: "sam@example.com", password: "longenough", confirmPassword: "longenough" }, "signup"), {});
});

test("the first account adopts data saved before accounts existed", () => {
  const storage = memoryStorage({ "gather-v2-profile": '{"name":"Ana"}', "gather-v3-theme": '"dark"', [userKey("gather-v2-plan", "u1")]: '"mine"', "gather-v2-plan": '"old"' });
  claimLegacyData(storage, "u1");
  assert.equal(storage.getItem(userKey("gather-v2-profile", "u1")), '{"name":"Ana"}');
  assert.equal(storage.getItem(userKey("gather-v2-plan", "u1")), '"mine"');
  assert.equal(storage.getItem(userKey("gather-v3-theme", "u1")), null);
  // Only the first account in a browser adopts it.
  claimLegacyData(storage, "u2");
  assert.equal(storage.getItem(userKey("gather-v2-profile", "u2")), null);
});
