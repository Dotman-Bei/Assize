/**
 * `pnpm audit:responsive` — load every page at every width and find what breaks.
 *
 * `frontend.md` specifies a four-column bento, multi-column tables and a 640px
 * form container, and says nothing at all about small screens. So this does not
 * check the layout against a spec — there is none to check against. It checks
 * for the things that are wrong at any width regardless of design: content wider
 * than the window, text too small to read, and controls too small to hit.
 *
 * Horizontal overflow is the one that matters most. A page that scrolls sideways
 * on a phone is not a styling preference, it is content the reader cannot reach.
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findChromium } from "./find-chromium.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const target = process.argv.includes("--local")
  ? `file://${join(here, "..", "apps", "web", "dist", "assize.html")}`
  : (() => {
      const url = JSON.parse(readFileSync(join(here, "..", "submission.json"), "utf8")).liveAppUrl;
      if (!url) { console.error("submission.json: liveAppUrl is null. Use --local."); process.exit(2); }
      return url.endsWith("/") ? url : `${url}/`;
    })();

/** Widths worth checking, and why each is here. */
const WIDTHS = [
  [320, "iPhone SE, the narrowest phone still in use"],
  [390, "iPhone 14"],
  [430, "iPhone Pro Max"],
  [768, "iPad portrait"],
  [1024, "iPad landscape, small laptop"],
  [1280, "laptop"],
  [1920, "desktop"],
];
const ROUTES = ["/", "/markets", "/publish", "/breaches", "/claim", "/verify"];

const findings = [];
const note = (w, route, what, detail) => {
  findings.push({ w, route, what, detail });
  console.log(`  ${String(w).padStart(4)}px ${route.padEnd(10)} ${what.padEnd(22)} ${detail}`);
};

const browser = await chromium.launch({ executablePath: findChromium() });
console.log(`\nresponsive audit of ${target}\n`);

for (const [width, why] of WIDTHS) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  let clean = true;
  for (const route of ROUTES) {
    await page.goto(target + "#" + route, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(route === "/" ? 3500 : 1800);

    const report = await page.evaluate((vw) => {
      const doc = document.documentElement;
      const out = { overflow: doc.scrollWidth - vw, wide: [], small: [], tight: [] };

      // Anything rendering wider than the window, named so it can be fixed.
      for (const el of document.querySelectorAll("body *")) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.right > vw + 1 || r.left < -1) {
          // An element wider than the window is fine inside something that
          // scrolls. `.scroll` and `nav.tabs` both carry `overflow: auto`, and
          // omitting them reported a working horizontally-scrolling table as a
          // layout defect on every narrow width — 24 findings that were not bugs.
          const inScroller = el.closest(".scroll, .tablewrap, .term, pre, nav.tabs, [style*='overflow']");
          if (!inScroller) {
            const id = el.id ? `#${el.id}` : `${el.tagName.toLowerCase()}.${[...el.classList].slice(0, 2).join(".")}`;
            if (!out.wide.some((x) => x.id === id)) out.wide.push({ id, right: Math.round(r.right) });
          }
        }
      }

      // Text below 12px is a readability problem on a phone, not a style.
      for (const el of document.querySelectorAll("p, td, dd, span, a, li, .hint, .h2-sub")) {
        if (!el.textContent.trim()) continue;
        const size = parseFloat(getComputedStyle(el).fontSize);
        if (size > 0 && size < 12) {
          const id = `${el.tagName.toLowerCase()}.${[...el.classList].slice(0, 1).join(".")}`;
          if (!out.small.some((x) => x.id === id)) out.small.push({ id, size });
        }
      }

      // Tap targets. 32px is lenient; 44 is the usual guidance.
      for (const el of document.querySelectorAll("button, a.btn, .chip, nav.tabs a")) {
        const r = el.getBoundingClientRect();
        if (r.height > 0 && r.height < 32) {
          const label = (el.textContent || "").trim().slice(0, 18);
          if (!out.tight.some((x) => x.label === label)) out.tight.push({ label, h: Math.round(r.height) });
        }
      }
      return out;
    }, width);

    if (report.overflow > 1) { note(width, route, "horizontal overflow", `${report.overflow}px past the window`); clean = false; }
    for (const w of report.wide.slice(0, 3)) { note(width, route, "wider than window", `${w.id} reaches ${w.right}px`); clean = false; }
    // Text size and tap targets are only checked on touch widths. An 11px label
    // is a deliberate part of the type scale and a 31px tab is fine under a
    // mouse; reporting them on a 1920px desktop buried the findings that matter
    // under 24 identical lines per width.
    if (width <= 768) {
      for (const s of report.small.slice(0, 2)) { note(width, route, "text under 12px", `${s.id} at ${s.size}px`); clean = false; }
      for (const t of report.tight.slice(0, 2)) { note(width, route, "tap target under 32px", `"${t.label}" is ${t.h}px`); clean = false; }
    }
  }
  if (clean) console.log(`  ${String(width).padStart(4)}px  clean  (${why})`);
  await page.close();
}

console.log("\n" + "-".repeat(72));
if (findings.length === 0) console.log("  no layout defects at any width.\n");
else {
  const byWidth = {};
  for (const f of findings) byWidth[f.w] = (byWidth[f.w] ?? 0) + 1;
  console.log(`  ${findings.length} finding(s): ` + Object.entries(byWidth).map(([w, n]) => `${w}px×${n}`).join("  "));
  console.log();
}
await browser.close();
process.exit(findings.length === 0 ? 0 : 1);
