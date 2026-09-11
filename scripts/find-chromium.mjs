/**
 * Where Playwright keeps its browsers, discovered rather than written down.
 *
 * AGENTS.md forbids an absolute developer path in a tracked file, and one here
 * would only have worked on the machine it was written on (D-039).
 *
 * This lives in its own module because it was briefly copied instead of shared,
 * and the copy dropped `chrome-linux64` — the only layout present on this
 * machine. The copy failed to launch a browser while the original kept passing,
 * which is the whole argument against having two of these.
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export function findChromium() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const cache = join(homedir(), ".cache", "ms-playwright");
  if (!existsSync(cache)) return undefined;
  for (const entry of readdirSync(cache).filter((d) => d.startsWith("chromium"))) {
    for (const candidate of [
      join(entry, "chrome-linux64", "chrome"),
      join(entry, "chrome-linux", "chrome"),
      join(entry, "chrome-headless-shell-linux64", "chrome-headless-shell"),
      join(entry, "chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"),
    ].map((p) => join(cache, p))) {
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;   // let Playwright fall back to its own resolution
}
