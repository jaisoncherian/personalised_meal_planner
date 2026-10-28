// End-to-end check of the login → onboarding → results → dashboard flow in a real browser.
// Runs Vite in-process and drives headless Chrome/Edge over the DevTools protocol (no extra dependencies).
// Run with `npm run test:e2e`. Set CHROME_PATH if Chrome or Edge is not in a standard location,
// and E2E_SCREENSHOTS=<dir> to save full-page screenshots of each screen.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { createApp } from "../../server/app.js";
import { createMemoryStore } from "../../server/memoryStore.js";

const root = fileURLToPath(new URL("../..", import.meta.url));
const browserPath = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].find((path) => path && existsSync(path));

let server;
let apiServer;
let authStore = createMemoryStore();
let browser;
let profileDir;
let page;
let baseUrl;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function connect(port) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const target = targets.find((item) => item.type === "page");
      if (target) return target.webSocketDebuggerUrl;
    } catch { /* browser still starting */ }
    await sleep(100);
  }
  throw new Error("Browser did not start.");
}

function cdp(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let id = 0;
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  });
  const ready = new Promise((resolve) => socket.addEventListener("open", resolve));
  return {
    ready,
    close: () => socket.close(),
    send(method, params = {}) {
      id += 1;
      const current = id;
      return new Promise((resolve) => { pending.set(current, resolve); socket.send(JSON.stringify({ id: current, method, params })); });
    },
  };
}

async function evaluate(expression) {
  const response = await page.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (response.result?.exceptionDetails) throw new Error(response.result.exceptionDetails.exception?.description);
  return response.result?.result?.value;
}

async function waitFor(expression, message, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await evaluate(`Boolean(${expression})`).catch(() => false)) return;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for: ${message ?? expression}`);
}

async function open(path, timeout) {
  await page.send("Page.navigate", { url: `${baseUrl}${path}` });
  await waitFor("document.readyState === 'complete' && document.querySelector('#root')?.children.length", `page ${path}`, timeout);
}

// Saves a full-page screenshot when E2E_SCREENSHOTS is set; otherwise does nothing.
async function snap(name) {
  const dir = process.env.E2E_SCREENSHOTS;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  const height = await evaluate("document.documentElement.scrollHeight");
  await page.send("Emulation.setDeviceMetricsOverride", { width: 360, height: Math.min(height, 4000), deviceScaleFactor: 1, mobile: true });
  await sleep(300);
  const shot = await page.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(dir, `${name}.png`), Buffer.from(shot.result.data, "base64"));
  await page.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
}

// React tracks input values itself, so set them through the native setter and fire an input event.
const fill = (selector, value) => evaluate(`(() => {
  const input = document.querySelector(${JSON.stringify(selector)});
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, ${JSON.stringify(String(value))});
  input.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
})()`);
const click = (selector) => evaluate(`(document.querySelector(${JSON.stringify(selector)}).click(), true)`);
const text = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? ""`);
const kcal = async (selector) => Number((await text(selector)).replace(/[^\d]/g, ""));
const clickButton = (label) => evaluate(`([...document.querySelectorAll("button, a")].find((el) => el.textContent.includes(${JSON.stringify(label)})).click(), true)`);

async function signUp(email = "sam@example.com", password = "correct horse") {
  await open("/login");
  await waitFor("document.querySelector('.login-card')", "login page");
  await clickButton("Create an account");
  await waitFor("document.querySelector(\"input[autocomplete='name']\")", "sign-up form");
  await fill("input[autocomplete='name']", "Sam");
  await fill("input[type='email']", email);
  await fill("input[autocomplete='new-password']", password);
  await evaluate(`(() => {
    const input = document.querySelectorAll("input[autocomplete='new-password']")[1];
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, ${JSON.stringify(password)});
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  await click(".login-submit");
  await waitFor("location.pathname !== '/login'", "signed in").catch(async (error) => { throw new Error(`${error.message}: ${await text(".login-card [role=alert]")}`); });
}

async function completeOnboarding(goal) {
  await fill("input[autocomplete='given-name']", "Sam");
  await fill("input[inputmode='numeric']", 30);
  await click("input[name='gender'][value='male']");
  await click(".wizard-next");
  await waitFor("document.querySelector(\"input[placeholder='e.g. 165']\")", "body step");
  await fill("input[placeholder='e.g. 165']", 180);
  await fill("input[placeholder='e.g. 65']", 80);
  await click(".wizard-next");
  await waitFor("document.querySelector(\"input[name='activityLevel']\")", "activity step");
  await click("input[name='activityLevel'][value='moderate']");
  await click(".wizard-next");
  await waitFor("document.querySelector(\"input[name='goal']\")", "goal step");
  await click(`input[name='goal'][value='${goal}']`);
  await click(".wizard-next");
  await waitFor("location.pathname === '/results' && document.querySelector('.results-number')", "results screen");
}

before(async () => {
  if (!browserPath) return;
  // The account API runs in-process with an in-memory store, so tests never touch the real database.
  apiServer = createApp({ getStore: () => authStore, rateLimits: false }).listen(0);
  await new Promise((resolve) => apiServer.once("listening", resolve));
  server = await createServer({ root, logLevel: "silent", server: { port: 5299, strictPort: false, proxy: { "/api": `http://127.0.0.1:${apiServer.address().port}` } } });
  await server.listen();
  baseUrl = server.resolvedUrls.local[0].replace(/\/$/, "");
  profileDir = mkdtempSync(join(tmpdir(), "gather-e2e-"));
  const port = 9400 + Math.floor(Math.random() * 400);
  browser = spawn(browserPath, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`, "--no-first-run", "about:blank"], { stdio: "ignore" });
  page = cdp(await connect(port));
  await page.ready;
  await page.send("Page.enable");
  await page.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  // Load once so Vite finishes dependency optimisation before the timed checks.
  await open("/", 60000);
  await sleep(1500);
});

after(async () => {
  page?.close();
  if (browser) {
    const exited = new Promise((resolve) => browser.once("exit", resolve));
    browser.kill();
    await Promise.race([exited, sleep(3000)]);
  }
  await server?.close();
  apiServer?.close();
  // Chrome can hold its profile files briefly after exiting; leftover temp files are harmless.
  if (profileDir) rmSync(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

const resetStorage = async () => {
  authStore = createMemoryStore();
  await page.send("Network.clearBrowserCookies");
  await open("/login");
  await evaluate("localStorage.clear(), sessionStorage.clear(), true");
};

// Starts each test with a fresh device and a newly signed-up user.
const e2e = (name, fn) => test(name, { skip: browserPath ? false : "Chrome or Edge not found (set CHROME_PATH)" }, async () => {
  await resetStorage();
  await signUp();
  await fn();
});
const e2eSignedOut = (name, fn) => test(name, { skip: browserPath ? false : "Chrome or Edge not found (set CHROME_PATH)" }, async () => {
  await resetStorage();
  await fn();
});

e2eSignedOut("a signed-out visitor is sent to the login page from any screen", async () => {
  for (const path of ["/", "/dashboard", "/onboarding"]) {
    await open(path);
    await waitFor("location.pathname === '/login' && document.querySelector('.login-card')", `${path} → login`);
  }
  await snap("login");
});

e2eSignedOut("log in validates input, rejects a wrong password, and logs out", async () => {
  await open("/login");
  await waitFor("document.querySelector('.login-card')", "login page");
  await click(".login-submit");
  await waitFor("document.querySelector('.field-error')", "inline errors");
  await signUp();
  await waitFor("location.pathname === '/onboarding'", "new account → onboarding");
  await clickButton("Log out");
  await waitFor("location.pathname === '/login'", "logged out");
  await fill("input[type='email']", "sam@example.com");
  await fill("input[autocomplete='current-password']", "wrong password");
  await click(".login-submit");
  await waitFor("document.querySelector('.login-card [role=alert]')", "wrong password message");
  await fill("input[autocomplete='current-password']", "correct horse");
  await click(".login-submit");
  await waitFor("location.pathname === '/onboarding'", "logged back in");
});

e2eSignedOut("each account keeps its own profile", async () => {
  await signUp("sam@example.com");
  await completeOnboarding("lose");
  await clickButton("Log out");
  await waitFor("location.pathname === '/login'", "logged out");
  await signUp("ana@example.com");
  await waitFor("location.pathname === '/onboarding'", "second account starts fresh");
});

e2e("a new user lands on onboarding, not the dashboard", async () => {
  await open("/");
  await waitFor("location.pathname === '/onboarding'", "redirect to onboarding");
  assert.match(await text(".progress-meta"), /Step 1 of 4/);
});

e2e("opening the dashboard URL without a profile redirects to onboarding", async () => {
  for (const path of ["/dashboard", "/results", "/diary", "/preferences"]) {
    await open(path);
    await waitFor("location.pathname === '/onboarding'", `${path} → onboarding`);
  }
});

e2e("next is blocked until the step is valid", async () => {
  await click(".wizard-next");
  await waitFor("document.querySelector('.field-error')", "inline errors");
  assert.match(await text(".progress-meta"), /Step 1 of 4/);
  assert.match(await text(".wizard-card"), /Enter your name/);
});

e2e("onboarding → results → dashboard, then editing the goal updates the dashboard", async () => {
  await completeOnboarding("lose");
  await snap("results");
  const resultsGoal = await kcal(".results-number");
  assert.equal(resultsGoal, 2260);
  assert.match(await text(".results-explanation"), /maintenance is about 2,760 kcal\. To lose ~0\.5 kg \(1 lb\) per week, your goal is 2,260 kcal/);

  await clickButton("Go to Dashboard");
  await waitFor("location.pathname === '/dashboard' && document.querySelector('.today-stats')", "dashboard");
  assert.equal(await kcal(".today-stats dd"), 2260);
  await snap("dashboard-new-user");

  // Returning users skip onboarding.
  await open("/");
  await waitFor("location.pathname === '/dashboard'", "returning user → dashboard");

  await clickButton("Edit profile");
  await waitFor("location.pathname === '/onboarding'", "edit profile");
  for (let step = 0; step < 3; step += 1) await click(".wizard-next");
  await waitFor("document.querySelector(\"input[name='goal'][value='gain']\")", "goal step");
  await click("input[name='goal'][value='gain']");
  await click(".wizard-next");
  await waitFor("location.pathname === '/results' && document.querySelector('.results-number')", "results after edit");
  assert.equal(await kcal(".results-number"), 3260);
  await clickButton("Go to Dashboard");
  await waitFor("location.pathname === '/dashboard' && document.querySelector('.today-stats')", "dashboard after edit");
  assert.equal(await kcal(".today-stats dd"), 3260);
});

e2eSignedOut("a profile saved before accounts existed is kept by the first account", async () => {
  const saved = { name: "Ana", age: 40, gender: "female", heightCm: 165, weightKg: 70, activityLevel: "light", goal: "maintain", pace: "standard", units: "metric" };
  await evaluate(`localStorage.setItem("gather-v2-profile", ${JSON.stringify(JSON.stringify(saved))}), true`);
  await signUp();
  await waitFor("location.pathname === '/dashboard' && document.querySelector('.today-stats')", "dashboard for saved profile");
  await open("/results");
  await waitFor("location.pathname === '/results' && document.querySelector('.results-number')", "results for saved profile");
});

e2e("profile and diary are saved on the server, not in the browser", async () => {
  await completeOnboarding("lose");
  await clickButton("Go to Dashboard");
  await waitFor("location.pathname === '/dashboard' && document.querySelector('.today-stats')", "dashboard");
  await open("/diary");
  await waitFor("document.querySelector('.quick-add-panel')", "diary page");
  await fill(".quick-add-panel label:nth-of-type(1) input", "Banana");
  await fill(".quick-add-panel input[type='number']", 105);
  await click(".quick-add-panel button[type='submit']");
  await waitFor("document.querySelector('.diary-page')?.textContent.includes('Banana')", "entry logged");
  await clickButton("Add a glass");
  await sleep(1200);

  // Nothing account-specific is left in localStorage, and a fresh load still has everything.
  const localKeys = await evaluate("Object.keys(localStorage).filter((key) => /^gather-v\d-(profile|diary|water|plan):/.test(key))");
  assert.deepEqual(localKeys, []);
  await evaluate("localStorage.clear(), true");
  await open("/diary");
  await waitFor("document.querySelector('.diary-page')?.textContent.includes('Banana')", "diary entry after reload");
  assert.match(await text(".water-panel"), /1 \/ 8 glasses/);
  await open("/");
  await waitFor("location.pathname === '/dashboard' && document.querySelector('.today-stats')", "dashboard after reload");
  assert.equal(await kcal(".today-stats dd"), 2260);
});
