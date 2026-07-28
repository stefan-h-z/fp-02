/**
 * The whole stack, in a real browser.
 *
 * Chromium loads the bundle `expo export` produced, talks to the Laravel
 * backend over HTTP, and stores the family's data in the browser's own
 * IndexedDB. Nothing here is simulated: the assertions that matter are the ones
 * no other suite can make — that the bundle boots at all, that the client and
 * the server agree on the wire format, and that a reload keeps the data.
 *
 * A console error fails the run. In a React app they are almost always a real
 * defect that renders anyway, and letting them accumulate is how a suite stops
 * meaning anything.
 */
import { chromium } from "playwright";
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:8081";
const SHOT_DIR = process.env.E2E_SHOT_DIR ?? fileURLToPath(new URL("./.artifacts", import.meta.url));
mkdirSync(SHOT_DIR, { recursive: true });

const FALLBACK_CHROMIUM = "/opt/pw-browsers/chromium";
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH ??
  (existsSync(FALLBACK_CHROMIUM) ? FALLBACK_CHROMIUM : undefined);

const browser = await chromium.launch({
  executablePath,
  headless: process.env.E2E_HEADED === undefined,
});
const context = await browser.newContext({ viewport: { width: 420, height: 900 } });
const page = await context.newPage();

const problems = [];
page.on("console", (message) => {
  if (message.type() === "error") problems.push(`console: ${message.text()}`);
});
page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));

// Every call the app makes to the backend, with its outcome. The app catches
// its own failures and shows a friendly message, so without this a failing step
// says only "the button never appeared" — never why.
page.on("response", (response) => {
  if (!response.url().includes("/api/")) return;
  console.log(`    → ${response.status()} ${response.request().method()} ${response.url()}`);
  // The body of a refusal names which rule refused, which the status alone
  // never does — two different limiters both answer 429.
  if (response.status() >= 400) {
    void response
      .text()
      .then((body) => console.log(`      ${body.slice(0, 300)}`))
      .catch(() => undefined);
  }
});
page.on("requestfailed", (request) => {
  if (!request.url().includes("/api/")) return;
  console.log(`    → FAILED ${request.method()} ${request.url()} (${request.failure()?.errorText})`);
});

let failures = 0;

async function step(name, body) {
  try {
    await body();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  ✕ ${name}\n    ${error.message}`);
    // What the person would be looking at. The app catches its own failures and
    // shows them, so the screen usually says more than the timeout does.
    const visible = await page.locator("body").innerText().catch(() => "<unreadable>");
    console.error(`    screen: ${visible.replace(/\s+/g, " ").slice(0, 400)}`);
    await page.screenshot({ path: `${SHOT_DIR}/${name.replace(/\W+/g, "-")}.png` }).catch(() => {});
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const INVITE_TOKEN = process.env.E2E_INVITE_TOKEN;
if (INVITE_TOKEN === undefined) {
  console.error("  ! E2E_INVITE_TOKEN is not set — run through e2e/run.mjs");
  process.exit(1);
}

await step("the app boots and offers the three ways in", async () => {
  // `domcontentloaded`, not `networkidle`: the app opens a sync loop as soon as
  // it boots, so the network never goes quiet and waiting for it hangs forever.
  // The explicit element waits below are the real readiness signal anyway.
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.getByTestId("join-invite").waitFor({ timeout: 30_000 });
  await page.getByTestId("join-create").waitFor();
  await page.getByTestId("join-recover").waitFor();
});

/**
 * FR-1401, FR-1402, FR-1404 — and the reason this runs *before* joining: a
 * person deciding whether to hand their family's life to an app has to be able
 * to read what happens to it first, with no account and nothing entered.
 */
await step("the legal texts are readable before joining anything", async () => {
  await page.getByTestId("join-legal").click();
  await page.getByTestId("legal-tabs").waitFor({ timeout: 30_000 });

  const privacy = await page.locator("body").innerText();
  assert(/Datenschutz|Privacy/.test(privacy), "no privacy policy on the legal screen");
  assert(/Fassung|Version/.test(privacy), "the policy carries no version");

  // The operator has not filled the placeholders in, and the screen says so
  // rather than presenting an unfinished document as final.
  await page.getByTestId("legal-privacy-incomplete").waitFor({ timeout: 10_000 });

  await page.getByTestId("legal-tab-flows").click();
  const flows = await page.locator("body").innerText();
  assert(/backend/i.test(flows), "the data-flow disclosure is empty");

  // Back is a control on the screen, not browser history: before joining, the
  // shell renders this in place of the navigator, so there is no history entry.
  await page.getByTestId("legal-back").click();
  await page.getByTestId("join-invite").waitFor({ timeout: 30_000 });
});

await step("an invitation can be redeemed against the real backend", async () => {
  await page.getByTestId("join-invite").click();

  // The design system nests the real input under `-input`; see the render tests.
  await page.getByTestId("invite-token-input").fill(INVITE_TOKEN);

  // Read it before spending it. This is FR-118 end to end: the joiner is shown
  // the name and family the inviter already chose, and types neither.
  await page.getByTestId("invite-inspect").click();
  await page.getByTestId("invite-redeem").waitFor({ timeout: 30_000 });
  const invitation = await page.getByTestId("invite-redeem").locator("xpath=ancestor::*[3]").innerText();
  assert(/Ben/.test(invitation), `the invitation did not name the joiner: ${invitation}`);

  await page.getByTestId("invite-redeem").click();

  // Watch the token field, not the chooser's button: that button disappears the
  // moment this sub-screen opens, so waiting for it to detach would pass without
  // anything having been redeemed at all.
  await page
    .getByTestId("invite-token-input")
    .waitFor({ state: "detached", timeout: 30_000 })
    .catch(async () => {
      const screen = (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 200);
      throw new Error(`still on the invitation screen — showing: ${screen}`);
    });
});

/**
 * The adoption promise (SPEC §4.2): a person signs in once per device and then
 * never again. A reload must not put them back on the join screen.
 *
 * Counting elements straight after `reload` would pass for the wrong reason —
 * nothing has mounted yet, so *every* count is zero. This waits for the app to
 * actually render something first.
 */
await step("the session survives a reload", async () => {
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => (document.body.innerText ?? "").trim().length > 0,
    undefined,
    { timeout: 30_000 },
  );
  const backOnJoin = await page.getByTestId("join-invite").count();
  const screen = (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 200);
  assert(backOnJoin === 0, `the app asked to join again after a reload — showing: ${screen}`);
});

await step("the browser really persisted something", async () => {
  const databases = await page.evaluate(() => indexedDB.databases().then((d) => d.map((x) => x.name)));
  assert(
    databases.some((name) => name?.includes("family")),
    `no family database in IndexedDB, found: ${JSON.stringify(databases)}`,
  );
});

await step("no console errors along the way", async () => {
  assert(problems.length === 0, problems.join("\n    "));
});

await page.screenshot({ path: `${SHOT_DIR}/final.png`, fullPage: true }).catch(() => {});
await browser.close();

process.exit(failures === 0 ? 0 : 1);
