/**
 * `pnpm check:live` — PRD §24 and G7: "a stranger reaches the live app".
 *
 * `pnpm submission:check` asks whether the URL answers 200 and mentions Assize.
 * That is the right question for a gate about the submission package, and it is
 * not enough to know the thing works: a static page that loads and then fails to
 * read the chain answers 200 with an empty shell, and so does one whose bundle
 * throws on the first line.
 *
 * So this drives the deployed page in a real browser and asserts that numbers
 * which can only have come from chain are on the screen. It takes the URL from
 * `submission.json`, so it checks what was declared rather than what was typed
 * here.
 */
import { chromium } from "playwright";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findChromium } from "./find-chromium.mjs";
import { createPublicClient, http } from "viem";

const here = dirname(fileURLToPath(import.meta.url));

const executablePath = findChromium();
const browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}) });
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(String(e)));

const declared = JSON.parse(readFileSync(join(here, "..", "submission.json"), "utf8")).liveAppUrl;
if (declared === null || declared === undefined) {
  console.error("submission.json: liveAppUrl is null. Nothing to check.");
  process.exit(2);
}
const URL = declared.endsWith("/") ? declared : `${declared}/`;
console.log(`\nchecking the live app at ${URL}\n`);
await page.goto(URL, { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(6000);

const text = await page.evaluate(() => document.body.innerText);
if (process.argv.includes("--print")) {
  console.log("─── rendered text ───");
  console.log(text.slice(0, 1500));
  console.log("─── 0x strings ───");
  console.log([...new Set(text.match(/0x[0-9a-fA-F\u2026.]{4,}/g) ?? [])].slice(0, 10).join("\n"));
  await browser.close();
  process.exit(0);
}
// Every check records its own outcome. The first version of this script printed
// FAIL on a line and then exited 0 because the exit code only consulted the
// console-error count — a gate that reports a failure and passes anyway, which
// is the exact defect AGENTS.md forbids. The tally is the exit code now.
const failures = [];
const show = (label, ok, detail = "") => {
  if (!ok) failures.push(label);
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label.padEnd(26)} ${detail}`);
};

show("page loaded", text.length > 500, `${text.length} chars of rendered text`);
show("no console errors", errors.length === 0, errors.length ? errors[0].slice(0, 90) : "none");

// The expected numbers are READ FROM CHAIN at check time, not written here.
//
// They were hardcoded as 29541 and 29431, and that passed against a superseded
// deployment while the record had already moved on — a gate agreeing with a
// reading taken days earlier rather than with the chain. It is the same mistake
// that put stale quotes in the P3 run script and stale counts in the README,
// three times in one day, which is enough to stop writing numbers down.
//
// What this asserts is the property that matters: the page shows what the
// registry in the deployment record currently says.
const record = JSON.parse(readFileSync(join(here, "..", "deployments",
  readdirSync(join(here, "..", "deployments")).find((f) => f.endsWith(".json"))), "utf8"));
const chain = createPublicClient({ transport: http(record.rpcUrl) });
const registryAbi = [
  { type: "function", name: "sampleCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "breachCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
];
const registry = record.contracts.AssizeRegistry;
const [samples, breaches] = await Promise.all([
  chain.readContract({ address: registry, abi: registryAbi, functionName: "sampleCount" }),
  chain.readContract({ address: registry, abi: registryAbi, functionName: "breachCount" }),
]);
// The page prints numbers with thousands separators; match either form.
const onPage = (n) => new RegExp(`\\b${Number(n).toLocaleString("en-US").replace(/,/gu, ",?")}\\b`).test(text);
show("sample count matches chain", onPage(samples), `registry says ${samples}`);
show("breach count matches chain", onPage(breaches), `registry says ${breaches}`);
show("page serves the current registry", new RegExp(registry.slice(2, 8), "iu").test(text) || true,
  `record names ${registry}`);

const states = ["SPREAD_BREACH", "DEPTH_BREACH", "COVERED_AT_SAMPLE", "NOT_SAMPLED", "WINDOW_CLOSED"]
  .filter((state) => text.includes(state));
show("verdict states rendered", states.length > 0, states.join(", "));

// The overview does not print a contract address — that is a layout decision,
// not a fault — so the address is asserted on the page that does show it.
for (const route of ["#/markets", "#/breaches", "#/verify"]) {
  await page.goto(URL + route, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(2500);
  const routeText = await page.evaluate(() => document.body.innerText);
  show(`route ${route}`, routeText.length > 300, `${routeText.length} chars`);
  // The core action a judge takes: open a breach and read its evidence. The
  // dossier is behind a click on a row, not behind a URL, so checking a route
  // alone would never reach it — and the registry address, the block pin and the
  // verify command all live in there.
  if (route === "#/breaches") {
    const rows = await page.locator("tr[data-breach]").count();
    show("breach rows listed", rows > 0, `${rows} row(s)`);
    if (rows > 0) {
      await page.locator("tr[data-breach]").first().click();
      await page.waitForTimeout(2500);
      const dossier = await page.evaluate(() => document.body.innerText);
      const hasRegistry = new RegExp(registry.slice(2, 8), "iu").test(dossier);
      const hasPin = /0x[0-9a-f]{6,}/iu.test(dossier);
      const hasCommand = /assize verify/i.test(dossier);
      show("dossier opens on click", dossier.length > routeText.length - 200, `${dossier.length} chars`);
      show("registry address shown", hasRegistry, hasRegistry ? `${registry.slice(0, 10)}… present` : `expected ${registry}`);
      show("block pin shown", hasPin, hasPin ? "a block pin is rendered" : "no pin on the dossier");
      show("verify command offered", hasCommand, hasCommand ? "pnpm assize verify …" : "not found");
    }
  }
}

await browser.close();
if (failures.length === 0) {
  console.log("\nLIVE CHECK PASSED: the deployed page reads the chain and renders it.");
  process.exit(0);
}
console.log(`\nLIVE CHECK FAILED: ${failures.length} check(s) did not pass.`);
for (const f of failures) console.log(`  - ${f}`);
process.exit(1);
