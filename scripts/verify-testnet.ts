/**
 * `pnpm verify:testnet -- C-003` — the gate command PRD §22 names for G3, G4 and
 * G5, and the `verified_by` recorded against those claims in `claims.json`.
 *
 * Each claim has a condition, and this checks that condition against chain. A
 * claim whose capability was cut is reported as cut rather than passed: PRD §26
 * requires a blocked capability be recorded as blocked and never hidden behind a
 * substitute, and a gate that reports success for code that does not exist is
 * exactly such a substitute.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createPublicClient, http, type Address } from "viem";

import { sampleSourceFromCode } from "@assize/protocol-types";
import { isBreach } from "@assize/reference";
import { registryAbi, verify } from "@assize/verifier";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

interface Deployment {
  readonly rpcUrl: string;
  readonly contracts: { readonly AssizeRegistry: string; readonly CoverageSubscriber: string };
  readonly evidence: { readonly callbackTx: string };
}

type Outcome = { readonly state: "pass" | "fail" | "cut"; readonly lines: readonly string[] };

function record(): Deployment {
  const dir = join(REPO_ROOT, "deployments");
  const file = readdirSync(dir).find((f) => f.endsWith(".json"));
  if (file === undefined) throw new Error("no deployment record in deployments/");
  return JSON.parse(readFileSync(join(dir, file), "utf8")) as Deployment;
}

async function main(): Promise<void> {
  const claimId = process.argv.slice(2).find((a) => /^C-\d{3}$/u.test(a));
  if (claimId === undefined) {
    process.stderr.write("Which claim? e.g. pnpm verify:testnet -- C-004\n");
    process.exit(2);
  }
  const deployment = record();
  const rpcUrl = process.env["SOMNIA_RPC_URL"] ?? deployment.rpcUrl;
  const registry = deployment.contracts.AssizeRegistry as Address;
  const subscriber = deployment.contracts.CoverageSubscriber as Address;
  const client = createPublicClient({ transport: http(rpcUrl) });
  const read = <T>(fn: string, args: unknown[]): Promise<T> =>
    client.readContract({ address: registry, abi: registryAbi, functionName: fn, args }) as Promise<T>;

  const checks: Record<string, () => Promise<Outcome>> = {
    /** A sample was delivered by the reactivity path on a live market. */
    "C-003": async () => {
      const lines: string[] = [];
      const total = await read<bigint>("sampleCount", []);
      if (total === 0n) return { state: "fail", lines: ["no samples recorded"] };
      lines.push(`registry holds ${total} sample(s)`);

      const latest = await read<{ sample: { source: number; blockNumber: bigint; blockHash: string } }>(
        "sampleAt", [total - 1n]);
      const source = sampleSourceFromCode(Number(latest.sample.source));
      lines.push(`most recent sample is labelled ${source}`);
      if (source !== "REACTIVITY") return { state: "fail", lines: [...lines, "G3 requires source: REACTIVITY"] };

      // The callback must be a reactive transaction, not one we sent.
      const tx = await client.getTransaction({ hash: deployment.evidence.callbackTx as `0x${string}` });
      const reactive = tx.from.toLowerCase() === subscriber.toLowerCase()
        && (tx.to ?? "").toLowerCase() === subscriber.toLowerCase();
      lines.push(reactive
        ? `callback ${deployment.evidence.callbackTx} has from and to both the subscriber, which is the shape of a reactive transaction`
        : `callback ${deployment.evidence.callbackTx} is not shaped like a reactive transaction`);
      return { state: reactive ? "pass" : "fail", lines };
    },

    /** A real quoting breach was recorded against a live market. */
    "C-004": async () => {
      const lines: string[] = [];
      const breaches = await read<bigint>("breachCount", []);
      if (breaches === 0n) return { state: "fail", lines: ["no breach recorded"] };
      lines.push(`registry holds ${breaches} breach record(s)`);
      const result = await verify({ rpcUrl, registry, id: 0n, by: "breach" });
      for (const check of result.checks) lines.push(`${check.ok ? "ok  " : "FAIL"} ${check.name}: ${check.detail}`);
      if (!result.passed) return { state: "fail", lines };
      lines.push(`breach 0 re-derives to ${result.derived}, which ${isBreach(result.derived as never) ? "forfeits a bond" : "does not forfeit a bond"}`);
      return { state: "pass", lines };
    },

    /** A forfeited bond was paid to witnessed traders. */
    "C-005": async () => {
      // This reported CUT until 2026-09-11, and reported it correctly: settlement
      // was cut under PRD §26 K10 (D-021), and the deployed registry had no way
      // to send ether at all — no CALL opcode anywhere in its runtime. P3 shipped
      // it (D-047), so the gate now asks against chain the question it was meant
      // to ask from the start.
      const lines: string[] = [];
      const paid = await read<bigint>("paidOut", [0n]);
      const volume = await read<bigint>("witnessedVolume", [0n]);
      const commitment = await read<{ bond: bigint; forfeitedAtBreachIdPlusOne: bigint }>(
        "commitmentAt",
        [0n],
      );
      const forfeited = commitment.forfeitedAtBreachIdPlusOne > 0n;

      lines.push(`commitment 0 bond ${commitment.bond} wei, forfeited: ${forfeited}`);
      lines.push(`witnessed volume ${volume}, paid out ${paid} wei`);

      if (!forfeited) return { state: "fail", lines: [...lines, "no bond forfeited, so no payout is due"] };
      if (volume === 0n) return { state: "fail", lines: [...lines, "no witnessed volume, so nobody could be paid"] };
      if (paid === 0n) return { state: "fail", lines: [...lines, "the bond forfeited and nothing was paid out"] };
      if (paid > commitment.bond) {
        return { state: "fail", lines: [...lines, `paid ${paid} against a bond of ${commitment.bond}`] };
      }
      lines.push("a payout reached a trader the chain saw filling inside the window, and never exceeded the bond");
      lines.push("One witnessed trader, so the pro-rata split was not exercised against competing claimants here.");
      return { state: "pass", lines };
    },

    /** Gaps are recorded as NOT_SAMPLED and never counted as coverage. */
    "C-006": async () => {
      const lines: string[] = [];
      const total = await read<bigint>("sampleCount", []);
      // An id past the end reads a zeroed slot, which must be NOT_SAMPLED.
      const beyond = await read<number>("verdictOf", [total + 1000n]);
      const ok = Number(beyond) === 0;
      lines.push(ok
        ? `an unwritten sample id re-derives to NOT_SAMPLED, not to any positive state`
        : `an unwritten sample id returned verdict code ${beyond}, which should be 0 (NOT_SAMPLED)`);
      lines.push("NOT_SAMPLED is not a breach and is not coverage: covered by the differential and unit tests.");
      lines.push("R3 needs a sustained campaign, which has not been run. This confirms the property, not the rung.");
      return { state: ok ? "pass" : "fail", lines };
    },
  };

  const check = checks[claimId];
  if (check === undefined) {
    process.stderr.write(`${claimId} has no on-chain condition this command can check.\n`);
    process.exit(2);
  }

  process.stdout.write(`\nverify:testnet ${claimId}\n  registry ${registry}\n  rpc      ${rpcUrl}\n\n`);
  const outcome = await check();
  for (const line of outcome.lines) process.stdout.write(`  ${line}\n`);

  if (outcome.state === "cut") {
    process.stdout.write(`\n${claimId}: CUT. Not passing, by design.\n`);
    process.exit(1);
  }
  process.stdout.write(`\n${claimId}: ${outcome.state === "pass" ? "PASS" : "FAIL"}\n`);
  process.exit(outcome.state === "pass" ? 0 : 1);
}

await main();
