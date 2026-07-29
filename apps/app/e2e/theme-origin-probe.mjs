/**
 * Where does a text colour come from — a class rule, or an inline style?
 *
 * That distinction splits the remaining possibilities in two. An inline
 * `color: rgb(17,24,39)` means the component resolved the theme in JavaScript at
 * render time and read the light one. A class whose rule carries the light value
 * means the theme was right and the stylesheet is stale or unswitched.
 *
 * Runs against the join screen, which needs no backend and no session.
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const distDir = fileURLToPath(new URL("../dist", import.meta.url));
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2", ".ttf": "font/ttf" };

const server = createServer((request, response) => {
  const requested = decodeURIComponent(new URL(request.url, "http://x").pathname);
  const candidate = join(distDir, normalize(requested));
  const file = candidate.startsWith(distDir) && existsSync(candidate) && statSync(candidate).isFile()
    ? candidate
    : join(distDir, "index.html");
  response.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
  response.end(readFileSync(file));
});
await new Promise((resolve) => server.listen(8099, "127.0.0.1", resolve));

const FALLBACK = "/opt/pw-browsers/chromium";
const browser = await chromium.launch({
  executablePath: existsSync(FALLBACK) ? FALLBACK : undefined,
  headless: true,
});

async function inspect(scheme) {
  const page = await browser.newPage();
  await page.emulateMedia({ colorScheme: scheme });
  await page.goto("http://127.0.0.1:8099/", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => (document.body.innerText ?? "").trim().length > 0, undefined, { timeout: 30_000 });

  const result = await page.evaluate(() => {
    // The first element that actually renders text.
    const node = Array.from(document.querySelectorAll("div,span,p,button"))
      .filter((n) => !["STYLE", "SCRIPT"].includes(n.tagName))
      .find((n) => n.children.length === 0 && (n.textContent ?? "").trim().length > 3);
    if (!node) return { error: "no text node found" };

    const colour = getComputedStyle(node).color;
    const inline = node.getAttribute("style") ?? "";
    const classes = Array.from(node.classList);

    // Which stylesheet rules match this element and set a colour.
    const matching = [];
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        for (const rule of Array.from(sheet.cssRules)) {
          const text = String(rule.cssText);
          if (!/[^-]color:/.test(text)) continue;
          try {
            if (node.matches(rule.selectorText)) matching.push(text.slice(0, 110));
          } catch { /* non-style rule */ }
        }
      } catch { /* cross-origin */ }
    }

    // The chain of theme classes from the document down to this node.
    const chain = [];
    for (let n = node; n; n = n.parentElement) {
      for (const c of Array.from(n.classList)) {
        if (/^t_(light|dark)$/.test(c)) chain.unshift(`${c}@${n.tagName}`);
      }
    }

    return {
      themeChainOutermostFirst: chain,
      textPrimaryVar: getComputedStyle(node).getPropertyValue("--textPrimary").trim(),
      text: (node.textContent ?? "").trim().slice(0, 30),
      computedColour: colour,
      inlineStyle: inline.slice(0, 160),
      inlineHasColour: /(^|;)\s*color\s*:/.test(inline),
      classes: classes.slice(0, 6),
      matchingColourRules: matching.slice(0, 4),
    };
  });

  await page.close();
  return result;
}

console.log("LIGHT:", JSON.stringify(await inspect("light"), null, 1));
console.log("DARK :", JSON.stringify(await inspect("dark"), null, 1));

await browser.close();
server.close();
