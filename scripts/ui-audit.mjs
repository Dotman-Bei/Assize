/**
 * `pnpm audit:ui` — click everything on the deployed app and report what happened.
 *
 * `check:live` asks whether the page reads the chain. That is a different
 * question from whether its controls do anything, and the difference was found
 * by a user rather than by us: the market rows carry `data-nav="/markets"`, so
 * clicking "Details" navigates to the page you are already on and nothing moves.
 * Nothing failed, nothing errored, and nothing happened.
 *
 * So this drives each control and records whether the page changed. A control
 * that produces no change is reported by name, which is the only way a dead
 * button is distinguishable from a working one that had nothing to do.
 */
import { chromium } from "playwright";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findChromium } from "./find-chromium.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const declared = JSON.parse(readFileSync(join(here, "..", "submission.json"), "utf8")).liveAppUrl;
if (!declared) { console.error("submission.json: liveAppUrl is null."); process.exit(2); }
const URL = declared.endsWith("/") ? declared : `${declared}/`;

const findings = [];
const ok = (area, detail) => console.log(`  ok    ${area.padEnd(28)} ${detail}`);
const dead = (area, detail) => { findings.push({ area, detail }); console.log(`  DEAD  ${area.padEnd(28)} ${detail}`); };

const browser = await chromium.launch({ executablePath: findChromium() });
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(String(e)));

console.log(`\nauditing every control on ${URL}\n`);

/** Snapshot enough of the page that a change is detectable. */
const snapshot = () => page.evaluate(() => ({
  hash: location.hash,
  text: document.body.innerText,
  visible: [...document.querySelectorAll("[data-page]")]
    .filter((p) => !p.classList.contains("hidden")).map((p) => p.dataset.page).join(","),
}));

await page.goto(URL, { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(6000);

/* ------------------------------- the tabs ------------------------------- */
const tabs = await page.$$eval("nav.tabs a", (as) => as.map((a) => ({ route: a.dataset.route, label: a.textContent.trim() })));
console.log("tabs");
for (const tab of tabs) {
  await page.goto(URL + "#" + tab.route, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(2500);
  const after = await snapshot();
  if (after.visible === tab.route && after.text.length > 200) ok(`${tab.label} (${tab.route})`, `${after.text.length} chars`);
  else dead(`${tab.label} (${tab.route})`, `shows "${after.visible}", ${after.text.length} chars`);
}

/* ----------------------------- market rows ------------------------------ */
console.log("\nmarket directory");
await page.goto(URL + "#/markets", { waitUntil: "networkidle", timeout: 45000 });
await page.waitForTimeout(3000);
const rows = await page.$$("#marketRows tr");
ok("rows rendered", `${rows.length} row(s)`);
if (rows.length > 1) {
  const before = await snapshot();
  await rows[1].click();
  await page.waitForTimeout(2000);
  const after = await snapshot();
  if (after.text === before.text) dead("clicking a market row", "page unchanged — the Details affordance does nothing");
  else ok("clicking a market row", "the page changed");
}

/* ------------------------------- filters -------------------------------- */
const chips = await page.$$(".chip");
if (chips.length > 0) {
  let moved = 0;
  for (const chip of chips) {
    const label = await chip.textContent();
    const before = await snapshot();
    await chip.click();
    await page.waitForTimeout(1200);
    const after = await snapshot();
    if (after.text !== before.text) moved += 1;
    else if (label.trim() !== "All Books") dead(`filter "${label.trim()}"`, "no change");
  }
  ok("filter chips", `${chips.length} chip(s), ${moved} changed the table`);
}

/* ------------------------------ breaches -------------------------------- */
console.log("\nbreaches");
await page.goto(URL + "#/breaches", { waitUntil: "networkidle", timeout: 45000 });
await page.waitForTimeout(3000);
const breachRows = await page.$$("tr[data-breach]");
ok("breach rows", `${breachRows.length} row(s)`);
if (breachRows.length > 1) {
  // Click the SECOND row. The dossier renders the first breach on load, so
  // clicking row 0 changes nothing and looks like a dead control.
  const before = await snapshot();
  await breachRows[1].click();
  await page.waitForTimeout(2500);
  const after = await snapshot();
  if (after.text === before.text) dead("clicking a breach row", "no dossier opened");
  else ok("clicking a breach row", "dossier rendered");
}

/* ------------------------------- verifier ------------------------------- */
console.log("\nverifier");
await page.goto(URL + "#/verify", { waitUntil: "networkidle", timeout: 45000 });
await page.waitForTimeout(2500);
const runBtn = await page.$("#verifyRun");
if (runBtn === null) dead("verify run button", "#verifyRun not on the page");
else {
  const input = await page.$("#verifyInput");
  if (input) { await input.fill("0"); }
  await runBtn.click();
  await page.waitForTimeout(6000);
  const log = await page.$eval("#verifyLog", (n) => n.innerText).catch(() => "");
  if (log.trim().length === 0) dead("verify run button", "clicked, log stayed empty");
  else ok("verify run button", log.split("\n").filter(Boolean).slice(-1)[0]?.slice(0, 60) ?? "");
}

/* -------------------------------- claim --------------------------------- */
console.log("\nclaim");
await page.goto(URL + "#/claim", { waitUntil: "networkidle", timeout: 45000 });
await page.waitForTimeout(2500);
const claimText = await page.evaluate(() => document.body.innerText);
const claimButtons = await page.$$eval("[data-page='/claim'] button", (bs) =>
  bs.map((b) => ({ label: b.textContent.trim(), disabled: b.disabled })));
for (const b of claimButtons) {
  if (b.disabled) dead(`claim button "${b.label}"`, "permanently disabled in markup");
  else ok(`claim button "${b.label}"`, "enabled");
}
// Statements the deployment has since falsified.
for (const stale of ["witnesses no fills", "not deployed here", "no wallet did", "would strictly enforce"]) {
  if (claimText.includes(stale)) dead("claim page copy", `still says "${stale}"`);
}

/* -------------------------------- footer --------------------------------- */
console.log("\nfooter");
await page.goto(URL, { waitUntil: "networkidle", timeout: 45000 });
await page.waitForTimeout(4000);

// Every anchor in the footer, and whether it points anywhere. An <a> whose href
// is never filled in renders as a link, hovers like a link, and does nothing —
// the same failure class as the Details cell.
const footerLinks = await page.$$eval("footer a", (as) => as.map((a) => ({
  label: a.textContent.trim().replace(/\s+/gu, " "),
  href: a.getAttribute("href"),
})));
for (const link of footerLinks) {
  if (link.href === null || link.href === "" || link.href === "#") {
    dead(`footer "${link.label}"`, "no href — renders as a link, goes nowhere");
  } else {
    ok(`footer "${link.label}"`, link.href.length > 44 ? link.href.slice(0, 44) + "\u2026" : link.href);
  }
}

// A hash link must land on a real route rather than falling back to Overview.
const routes = ["/", "/markets", "/publish", "/breaches", "/claim", "/verify"];
for (const link of footerLinks.filter((l) => (l.href ?? "").startsWith("#"))) {
  const route = link.href.slice(1) || "/";
  if (!routes.includes(route)) dead(`footer "${link.label}"`, `${link.href} is not a route`);
}

// Statements the deployment has falsified.
const footText = await page.$eval("footer", (f) => f.innerText);
for (const stale of ["No payout path is deployed", "not distributed", "Hackathon"]) {
  if (footText.includes(stale)) dead("footer copy", `still says "${stale}"`);
}

/* -------------------------------- report -------------------------------- */
console.log("\nconsole errors:", errors.length === 0 ? "none" : errors.length);
for (const e of errors.slice(0, 3)) console.log("   ", e.slice(0, 100));

console.log("\n" + "-".repeat(70));
if (findings.length === 0) { console.log("  every control does something.\n"); }
else {
  console.log(`  ${findings.length} control(s) or statement(s) with no purpose:`);
  for (const f of findings) console.log(`    - ${f.area}: ${f.detail}`);
  console.log();
}
await browser.close();
process.exit(findings.length === 0 && errors.length === 0 ? 0 : 1);
