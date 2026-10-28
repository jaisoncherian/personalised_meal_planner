import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server/app.js";
import { hashPassword, verifyPassword } from "../server/auth.js";
import { createMemoryStore } from "../server/memoryStore.js";

let server;
let baseUrl;
let store = createMemoryStore();

before(async () => {
  server = createApp({ getStore: () => store }).listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/auth`;
});
after(() => server.close());

async function call(path, body, cookie) {
  const response = await fetch(`${baseUrl}/${path}`, {
    method: body ? "POST" : "GET",
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, data: await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] };
}

const sam = { name: "Sam", email: "Sam@Example.com", password: "correct horse", confirmPassword: "correct horse" };

test("passwords are salted scrypt hashes", async () => {
  const a = await hashPassword("correct horse");
  const b = await hashPassword("correct horse");
  assert.notEqual(a.hash, b.hash);
  assert.equal(await verifyPassword("correct horse", a), true);
  assert.equal(await verifyPassword("wrong", a), false);
});

test("sign up, check the session, log out, log back in", async () => {
  const signup = await call("signup", sam);
  assert.equal(signup.status, 200);
  assert.deepEqual(Object.keys(signup.data.user).sort(), ["email", "id", "name"]);
  assert.equal(signup.data.user.email, "sam@example.com");
  assert.match(signup.cookie, /^gather_session=/);

  assert.deepEqual((await call("me", null, signup.cookie)).data.user, signup.data.user);
  assert.equal((await call("me")).data.user, null);

  await call("logout", {}, signup.cookie);
  assert.equal((await call("me", null, signup.cookie)).data.user, null);

  const login = await call("login", { email: "sam@example.com ", password: "correct horse" });
  assert.equal(login.status, 200);
  assert.equal(login.data.user.id, signup.data.user.id);
});

test("stored users keep only a hash of the password", async () => {
  const user = await store.findUserByEmail("sam@example.com");
  assert.ok(!JSON.stringify(user).includes("correct horse"));
});

test("wrong password and unknown email get the same answer", async () => {
  const wrong = await call("login", { email: "sam@example.com", password: "nope nope" });
  const unknown = await call("login", { email: "nobody@example.com", password: "correct horse" });
  assert.equal(wrong.status, 401);
  assert.deepEqual(wrong.data, unknown.data);
});

test("duplicate emails and invalid input are rejected", async () => {
  assert.equal((await call("signup", { ...sam, email: "SAM@example.com" })).status, 409);
  const invalid = await call("signup", { name: "", email: "x", password: "short", confirmPassword: "" });
  assert.equal(invalid.status, 400);
  assert.ok(invalid.data.error.email && invalid.data.error.password && invalid.data.error.name);
});

test("accounts answer 503 while the database is unavailable", async () => {
  const saved = store;
  store = null;
  try {
    assert.equal((await call("login", { email: "sam@example.com", password: "correct horse" })).status, 503);
  } finally {
    store = saved;
  }
});
