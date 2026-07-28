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

/**
 * FR-1211. The app follows the device rather than offering a switch of its own,
 * so the only honest way to test it is to change the device — `emulateMedia`.
 *
 * The assertion is the theme *class*, not the rendered colour, and that is a
 * deliberate limit rather than a weaker test. Tamagui marks the tree `t_dark`
 * when the dark theme is active, which is exactly what this app controls. The
 * colour values behind those classes are not in the static export — the design
 * system's CSS custom properties come out empty (`--t-color`), so both themes
 * currently paint the same. That is a packaging gap in how `@cp/ui` is consumed
 * on web, recorded in docs/status.md; asserting colours here would fail for a
 * reason this code cannot fix and would hide the thing it can.
 */
await step("dark mode follows the device", async () => {
  const themeClasses = async () =>
    page.evaluate(() => {
      const found = new Set();
      for (const el of Array.from(document.querySelectorAll("*")).slice(0, 300)) {
        for (const name of Array.from(el.classList)) if (/^t_(light|dark)$/.test(name)) found.add(name);
      }
      return [...found].sort().join(",");
    });

  const settle = async () => {
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => (document.body.innerText ?? "").trim().length > 0, undefined, {
      timeout: 30_000,
    });
  };

  await page.emulateMedia({ colorScheme: "light" });
  await settle();
  const light = await themeClasses();

  await page.emulateMedia({ colorScheme: "dark" });
  await settle();
  const dark = await themeClasses();

  assert(!light.includes("t_dark"), `a light device rendered the dark theme: ${light}`);
  assert(dark.includes("t_dark"), `a dark device did not render the dark theme: ${dark}`);
  await page.emulateMedia({ colorScheme: "light" });
});

/**
 * Past the join wall, which is where every earlier version of this harness
 * stopped. Everything above proves a person can get in; these prove the app they
 * got into is real — deep-linked routes render, the client-side router survives
 * a cold load of a sub-path, and the screens draw against data this browser is
 * holding in its own IndexedDB.
 */
async function openRoute(path) {
  await page.goto(`${BASE_URL}${path}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => (document.body.innerText ?? "").trim().length > 0, undefined, {
    timeout: 30_000,
  });
  const backOnJoin = await page.getByTestId("join-invite").count();
  assert(backOnJoin === 0, `${path} bounced back to the join screen`);
}

await step("a deep-linked route renders rather than 404ing", async () => {
  await openRoute("/calendar");
  await page.getByTestId("calendar-month").waitFor({ timeout: 30_000 });
});

/**
 * FR-206 in the browser. The render tests already prove the four views against a
 * test renderer; what only a browser can say is that switching between them
 * repaints — a screen whose state changes without the DOM following is a class
 * of bug the test renderer cannot see, because it re-reads the tree either way.
 */
await step("the calendar switches between its four views", async () => {
  await page.getByTestId("calendar-tab-agenda").click();
  await page
    .locator('[data-testid="calendar-agenda"], [data-testid="calendar-agenda-empty"]')
    .first()
    .waitFor({ timeout: 30_000 });
  assert(
    (await page.getByTestId("calendar-month").count()) === 0,
    "the month grid was still on the page after switching to the agenda",
  );

  await page.getByTestId("calendar-tab-day").click();
  await page
    .locator('[data-testid="calendar-day"], [data-testid="calendar-day-empty"]')
    .first()
    .waitFor({ timeout: 30_000 });

  await page.getByTestId("calendar-tab-timeline").click();
  await page
    .locator('[data-testid="calendar-timeline"], [data-testid="calendar-timeline-empty"]')
    .first()
    .waitFor({ timeout: 30_000 });

  await page.getByTestId("calendar-tab-month").click();
  await page.getByTestId("calendar-month").waitFor({ timeout: 30_000 });
});

await step("paging the calendar moves the window", async () => {
  const monthLabel = async () => page.getByTestId("calendar-month").innerText();
  const before = await monthLabel();

  await page.getByTestId("calendar-next").click();
  await page.waitForFunction(
    (previous) => {
      const node = document.querySelector('[data-testid="calendar-month"]');
      return node !== null && node.innerText !== previous;
    },
    before,
    { timeout: 30_000 },
  );

  const after = await monthLabel();
  assert(after !== before, "paging forward left the same month on screen");
});

/**
 * The screens a family actually opens. Each is loaded cold at its own URL rather
 * than navigated to, because a client-routed app that only works when you arrive
 * through the home page is broken for everybody who bookmarks anything.
 */
for (const [path, marker] of [
  ["/", "body"],
  ["/shopping", "body"],
  ["/plan", "body"],
  ["/settings", "privacy-learning"],
  ["/my-day", "body"],
  ["/conflicts", "body"],
]) {
  await step(`${path} loads cold and draws something`, async () => {
    await openRoute(path);
    if (marker === "body") {
      const text = (await page.locator("body").innerText()).trim();
      assert(text.length > 0, `${path} rendered an empty page`);
    } else {
      await page.getByTestId(marker).waitFor({ timeout: 30_000 });
    }
  });
}

/**
 * A write, in a browser, that survives a reload.
 *
 * Everything above this point reads. This is the one that proves the whole loop
 * closes on web: a tap produces an operation, the operation reaches IndexedDB,
 * and a cold reload finds it there. The learning switch is the subject because
 * it is a single visible boolean with no server round trip to confuse the
 * result.
 */
await step("a setting changed in the browser survives a reload", async () => {
  await openRoute("/settings");

  // The design system nests the real control under `-input` — the same
  // convention the invitation field follows. Clicking the outer wrapper hits a
  // presentational box and toggles nothing.
  const toggle = page.getByTestId("privacy-learning-input");
  await toggle.waitFor({ timeout: 30_000 });

  const readState = async () =>
    page.evaluate(() => {
      const node = document.querySelector('[data-testid="privacy-learning-input"]');
      if (node === null) return "gone";
      return node.getAttribute("aria-checked") ?? String(node.checked ?? "");
    });

  const before = await readState();
  await toggle.click();
  await page.waitForFunction(
    (previous) => {
      const node = document.querySelector('[data-testid="privacy-learning-input"]');
      if (node === null) return false;
      return (node.getAttribute("aria-checked") ?? String(node.checked ?? "")) !== previous;
    },
    before,
    { timeout: 30_000 },
  );

  await openRoute("/settings");
  await toggle.waitFor({ timeout: 30_000 });
  const after = await readState();
  assert(after !== before, `the switch went back to ${before} after a reload`);
});

await step("no console errors along the way", async () => {
  assert(problems.length === 0, problems.join("\n    "));
});

await page.screenshot({ path: `${SHOT_DIR}/final.png`, fullPage: true }).catch(() => {});
await browser.close();

process.exit(failures === 0 ? 0 : 1);
