/**
 * Browser end-to-end: boots what the product actually is, then drives it.
 *
 * Everything else in this repository tests the app with the browser taken out —
 * Vitest runs the pure logic, jest-expo renders the screens into a test
 * renderer. Both are fast and neither can tell you that the bundle loads, that
 * IndexedDB really persists, or that the client and the Laravel backend agree on
 * the wire. That is what this does, in Chromium, against the real server.
 *
 * It boots two things and tears them down again:
 *
 *   :8000  the Laravel backend (`php artisan serve`), unless E2E_API_URL says
 *          one is already running
 *   :8081  a static server over `dist`, the output of `expo export`
 *
 * The static server falls back to `index.html` for unknown paths, because the
 * app is client-routed and a deep link would otherwise 404 — the same rule any
 * real host needs.
 *
 * Environment:
 *   E2E_API_URL    reuse a running backend instead of booting one
 *   E2E_BASE_URL   reuse a running static server instead of booting one
 *   E2E_FILTER     substring filter on harness filenames
 *   E2E_HEADED     run with a visible browser
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const here = fileURLToPath(new URL(".", import.meta.url));
const appDir = fileURLToPath(new URL("..", import.meta.url));
const backendDir = "/home/user/backend-php-01";
const distDir = join(appDir, "dist");

const API_URL = process.env.E2E_API_URL ?? "http://127.0.0.1:8000";
const BASE_URL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:8081";
const BOOT_TIMEOUT_MS = 120_000;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
};

const started = [];

function shutdown() {
  for (const stop of started.reverse()) {
    try {
      stop();
    } catch {
      // Already gone. Tearing down is best-effort by nature.
    }
  }
}

process.on("exit", shutdown);
process.on("SIGINT", () => {
  shutdown();
  process.exit(130);
});

async function answers(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return response.status < 500;
  } catch {
    return false;
  }
}

async function waitUntil(label, url) {
  const start = Date.now();
  while (!(await answers(url))) {
    if (Date.now() - start > BOOT_TIMEOUT_MS) {
      console.error(`[e2e] ${label} did not come up at ${url}`);
      process.exit(1);
    }
    await delay(1000);
  }
  console.log(`[e2e] ${label} up after ${((Date.now() - start) / 1000).toFixed(0)}s`);
}

// ── The backend ────────────────────────────────────────────────────────────
if (process.env.E2E_API_URL === undefined && !(await answers(`${API_URL}/up`))) {
  if (!existsSync(join(backendDir, "vendor/autoload.php"))) {
    console.error(
      "[e2e] the backend has no vendor/ — run composer install in backend-php-01 first,\n" +
        "      or point E2E_API_URL at a backend running elsewhere.",
    );
    process.exit(1);
  }
  console.log("[e2e] starting the Laravel backend…");
  const server = spawn("php", ["artisan", "serve", "--host=127.0.0.1", "--port=8000"], {
    cwd: backendDir,
    stdio: ["ignore", "ignore", "inherit"],
    detached: true,
  });
  started.push(() => process.kill(-server.pid, "SIGTERM"));
  await waitUntil("backend", `${API_URL}/up`);
}

// ── A family to join ───────────────────────────────────────────────────────
/*
 * The browser joins by invitation rather than creating a family, and that is
 * the honest choice rather than a shortcut: creating one is the single endpoint
 * guarded by the platform's own `auth:api` + `verified.email`, which needs a
 * magic-link round trip the app does not implement yet (docs/status.md).
 * Redeeming is also the path everyone except the very first adult takes.
 */
const seeded = {};
if (process.env.E2E_INVITE_TOKEN === undefined) {
  const output = await new Promise((resolve, reject) => {
    const child = spawn(
      "php",
      ["artisan", "tinker", "--execute", `require '${join(here, "seed-invite.php")}';`],
      { cwd: backendDir, stdio: ["ignore", "pipe", "inherit"] },
    );
    let text = "";
    child.stdout.on("data", (chunk) => (text += chunk));
    child.on("exit", (code) => (code === 0 ? resolve(text) : reject(new Error("seeding failed"))));
  });

  for (const line of output.split("\n")) {
    const match = /^(E2E_[A-Z_]+)=(.+)$/.exec(line.trim());
    if (match !== null) seeded[match[1]] = match[2];
  }
  if (seeded["E2E_INVITE_TOKEN"] === undefined) {
    console.error(`[e2e] seeding produced no invite token:\n${output}`);
    process.exit(1);
  }
  console.log("[e2e] seeded a family and an invitation");
}

// ── The web build ──────────────────────────────────────────────────────────
if (process.env.E2E_BASE_URL === undefined) {
  if (!existsSync(distDir)) {
    console.error("[e2e] no dist/ — run `pnpm --filter @fam/app export:web` first.");
    process.exit(1);
  }

  const server = createServer((request, response) => {
    const requested = decodeURIComponent(new URL(request.url, BASE_URL).pathname);
    // `normalize` before joining: a path with `..` in it must not escape dist.
    const candidate = join(distDir, normalize(requested));
    const file =
      candidate.startsWith(distDir) && existsSync(candidate) && statSync(candidate).isFile()
        ? candidate
        : join(distDir, "index.html");

    response.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    response.end(readFileSync(file));
  });

  await new Promise((resolve) => server.listen(8081, "127.0.0.1", resolve));
  started.push(() => server.close());
  console.log(`[e2e] serving ${distDir} on ${BASE_URL}`);
}

// ── The harnesses ──────────────────────────────────────────────────────────
const filter = process.env.E2E_FILTER;
const harnesses = readdirSync(here)
  .filter((name) => name.endsWith(".e2e.mjs"))
  .filter((name) => filter === undefined || name.includes(filter))
  .sort();

if (harnesses.length === 0) {
  console.error("[e2e] no harnesses matched");
  process.exit(1);
}

let failures = 0;
for (const harness of harnesses) {
  console.log(`\n[e2e] ── ${harness} ──`);
  const code = await new Promise((resolve) => {
    const child = spawn(process.execPath, [join(here, harness)], {
      stdio: "inherit",
      env: { ...process.env, ...seeded, E2E_BASE_URL: BASE_URL, E2E_API_URL: API_URL },
    });
    child.on("exit", (status) => resolve(status ?? 1));
  });
  if (code !== 0) failures += 1;
}

shutdown();
console.log(failures === 0 ? "\n[e2e] all harnesses passed" : `\n[e2e] ${failures} harness(es) failed`);
process.exit(failures === 0 ? 0 : 1);
