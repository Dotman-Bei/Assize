/**
 * `pnpm test:e2e` — PRD §22 G10.
 *
 * "Loading, empty, error, insufficient STT with faucet pointer, not sampled, and
 * window closed are all reachable in the deployed app."
 *
 * Each state is driven, then asserted on the rendered page. The app under test is
 * the built artefact in `apps/web/dist`, loaded over file://, which is the file
 * actually shipped — DECISIONS.md D-037 records why this does not run against the
 * dev server.
 *
 * Exit code is the gate. Zero means every state was reached.
 */
import { chromium } from "playwright";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { chainDouble } from "./e2e/chain-double.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP = join(REPO_ROOT, "apps", "web", "dist", "assize.html");
const CHROME = process.env.CHROME_PATH
  ?? "/root/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome";

/** A wallet that answers, so the funding states can be reached without a real one. */
const FAKE_WALLET = `
  window.ethereum = {
    request: async ({ method }) => {
      if (method === "eth_requestAccounts") return ["0x1111111111111111111111111111111111111111"];
      if (method === "eth_chainId") return "0xc488";
      return null;
    },
  };
`;

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  process.stdout.write(`  ${ok ? "ok  " : "FAIL"}  ${name.padEnd(30)} ${detail}\n`);
}

async function openApp(browser, scenario, { wallet = false } = {}) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  if (wallet) await page.addInitScript(FAKE_WALLET);
  await page.route("**/dream-rpc.somnia.network/**", chainDouble(scenario));
  await page.goto(`file://${APP}`, { waitUntil: "load", timeout: 60000 });
  return page;
}

async function main() {
  if (!existsSync(APP)) {
    process.stderr.write(`No built app at ${APP}. Run: pnpm --filter @assize/web build:single\n`);
    process.exit(2);
  }
  const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
  process.stdout.write("\ntest:e2e — every state reachable (PRD §22 G10)\n\n");

  // 1. Loading. The page must say it is reading rather than showing nothing.
  {
    const page = await openApp(browser, "slow");
    const text = await page.textContent("body");
    check("loading", /reading the chain/i.test(text), "page reports it is reading the chain before data arrives");
    await page.close();
  }

  // 2. Empty. No commitments at all.
  {
    const page = await openApp(browser, "empty");
    await page.waitForTimeout(2500);
    await page.click('nav.tabs a[data-route="/markets"]');
    await page.waitForTimeout(1200);
    const text = await page.textContent("#marketRows");
    check("empty", /No active quoting commitments found/i.test(text), "directory shows its empty state");
    await page.close();
  }

  // 3. Error. The RPC fails outright.
  {
    const page = await openApp(browser, "error");
    await page.waitForTimeout(3000);
    const text = await page.textContent("body");
    const reported = /could not read the chain|unreachable/i.test(text);
    check("error", reported, "failure to read the chain is reported on screen, not swallowed");
    await page.close();
  }

  // 4. Insufficient STT, with the faucet pointer.
  {
    const page = await openApp(browser, "normal", { wallet: true });
    await page.waitForTimeout(2500);
    await page.click('nav.tabs a[data-route="/publish"]');
    await page.waitForTimeout(800);
    await page.click("#wallet");
    await page.waitForTimeout(1200);
    // The double funds the wallet with 2 STT against a 39 STT requirement.
    const text = await page.textContent("#publishState");
    const faucet = await page.$$eval('#publishState a[href*="t.me"]', (n) => n.length);
    const disabled = await page.$eval("#doPublish", (e) => e.disabled);
    check("insufficient STT", /Insufficient STT/i.test(text) && faucet > 0 && disabled,
      `warning shown, ${faucet} faucet link(s), submit disabled`);
    await page.close();
  }

  // 5. NOT_SAMPLED. A zeroed slot: nothing was observed.
  {
    const page = await openApp(browser, "notSampled");
    await page.waitForTimeout(2500);
    await page.click('nav.tabs a[data-route="/markets"]');
    await page.waitForTimeout(1500);
    const pill = await page.$$eval(".pill.p-NOT_SAMPLED", (n) => n.length);
    const banner = await page.textContent("body");
    check("not sampled", pill > 0 && /discrete instants/i.test(banner),
      `${pill} NOT_SAMPLED badge(s), with the gap explained on screen`);
    await page.close();
  }

  // 6. WINDOW_CLOSED. A reading from outside the committed window.
  {
    const page = await openApp(browser, "windowClosed");
    await page.waitForTimeout(2500);
    await page.click('nav.tabs a[data-route="/markets"]');
    await page.waitForTimeout(1500);
    const pill = await page.$$eval(".pill.p-WINDOW_CLOSED", (n) => n.length);
    check("window closed", pill > 0, `${pill} WINDOW_CLOSED badge(s) rendered`);
    await page.close();
  }

  await browser.close();

  const failed = results.filter((r) => !r.ok);
  process.stdout.write(
    failed.length === 0
      ? `\nG10 PASSED: all ${results.length} states reachable.\n`
      : `\nG10 FAILED: ${failed.length} of ${results.length} states not reachable.\n`,
  );
  process.exit(failed.length === 0 ? 0 : 1);
}

await main();
