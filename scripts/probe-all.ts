/**
 * `pnpm probe:all` — gate G1 (PRD §22).
 *
 * "Probes read live metadata and the address-literal check finds nothing in
 * `apps/` or `packages/`."
 *
 * G1 has two halves and this runs both. The static half is enforceable here and
 * now; the live half needs a reachable Shannon RPC and the pinned DreamDEX SDK.
 * When the live half cannot run, this exits non-zero and says which input is
 * missing, because PRD §26 requires a blocked capability be recorded as blocked
 * rather than hidden behind a substitute.
 */

import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { probeDreamdex } from "./probe-dreamdex.js";
import { probeReactivity } from "./probe-reactivity.js";
import { passed, printResults, type ProbeResult } from "./probe/shared.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function staticHalf(): ProbeResult[] {
  try {
    execFileSync("pnpm", ["check:no-address-literals"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return [
      {
        check: "no compiled-in address literals",
        status: "OK",
        detail: "apps/, packages/ and contracts/src carry no 20-byte hex literal (PRD §17)",
      },
    ];
  } catch (error) {
    const shell = error as { stdout?: string; stderr?: string };
    return [
      {
        check: "no compiled-in address literals",
        status: "PROTOCOL_CONFIG_CHANGED",
        detail: (shell.stdout ?? "") + (shell.stderr ?? "check:no-address-literals failed"),
      },
    ];
  }
}

async function main(): Promise<void> {
  const results: ProbeResult[] = [
    ...staticHalf(),
    ...(await probeDreamdex()),
    ...(await probeReactivity()),
  ];
  printResults("probe:all (gate G1)", results);

  const ok = passed(results);
  const blocked = results.filter((result) => result.status === "BLOCKED");
  process.stdout.write(
    `\nG1 ${ok ? "PASSED" : "NOT PASSED"}: ${results.length} check(s), ${blocked.length} blocked.\n`,
  );
  if (!ok) {
    // Name what is actually blocked. "The live half has not run" stopped being
    // true once probe:dreamdex started reading Shannon, and a summary that
    // overstates a blocker is the same defect as one that hides it.
    for (const result of blocked) {
      process.stdout.write(`  blocked: ${result.check} — ${result.detail}\n`);
    }
    process.stdout.write(
      "\nWhile any check above is blocked, no claim may state that the corresponding protocol\n"
        + "fact is read from a live source (PRD §21, §26).\n",
    );
  }
  process.exit(ok ? 0 : 1);
}

await main();
