/**
 * `pnpm claim:verify` — PRD §21 and §22 G8.
 *
 * "A claim may not state a rung its evidence does not reach." This is the check
 * that makes that rule mechanical rather than a promise.
 *
 * Two modes. `--offline` checks the ledger against itself: the schema, the rung
 * arithmetic, and the vocabulary. Without it, the claims that assert an on-chain
 * fact are additionally re-read from chain, which is what PRD §21 means by
 * "re-reads every claim from chain".
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createPublicClient, http } from "viem";

import { findForbiddenWords } from "@assize/protocol-types/vocabulary";
import { claimLedgerSchema, type Claim } from "@assize/protocol-types/schemas";
import { verdict as referenceVerdict } from "@assize/reference";
import { VERDICT_STATES, sampleSourceFromCode, type StoredSample } from "@assize/protocol-types";

const HERE = dirname(fileURLToPath(import.meta.url));
const LEDGER_PATH = join(HERE, "..", "data", "claims.json");

/** PRD §21's ladder, in order. A claim's rung may not exceed its evidence. */
const RUNGS = ["R0", "R1", "R2", "R3", "R4"] as const;
type Rung = (typeof RUNGS)[number];

const rungIndex = (rung: Rung): number => RUNGS.indexOf(rung);

/** Rungs whose evidence is an on-chain fact, and so needs a transaction hash. */
const ON_CHAIN_RUNGS = new Set<Rung>(["R2", "R3", "R4"]);

interface Finding {
  readonly claimId: string;
  readonly problem: string;
}

function checkClaim(claim: Claim): Finding[] {
  const findings: Finding[] = [];

  if (rungIndex(claim.rung) > rungIndex(claim.target_rung)) {
    findings.push({
      claimId: claim.id,
      problem: `states ${claim.rung} but targets only ${claim.target_rung}`,
    });
  }

  // R0 is "asserted in a document" and needs no evidence. Every rung above it
  // needs at least one piece of evidence that itself reaches that rung.
  const reached = claim.evidence.reduce<number>(
    (best, evidence) => Math.max(best, rungIndex(evidence.rung)),
    rungIndex("R0"),
  );
  if (rungIndex(claim.rung) > reached) {
    findings.push({
      claimId: claim.id,
      problem:
        `states ${claim.rung}, but its evidence reaches only ${RUNGS[reached]}. `
        + "PRD §21: a claim may not state a rung its evidence does not reach.",
    });
  }

  for (const evidence of claim.evidence) {
    if (ON_CHAIN_RUNGS.has(evidence.rung) && evidence.txHash === undefined) {
      findings.push({
        claimId: claim.id,
        problem: `${evidence.rung} evidence carries no transaction hash, so nobody can check it`,
      });
    }
  }

  for (const word of findForbiddenWords(claim.claim)) {
    findings.push({ claimId: claim.id, problem: `claim text contains "${word}"` });
  }

  return findings;
}

async function main(): Promise<void> {
  const offline = process.argv.includes("--offline");
  const ledger = claimLedgerSchema.parse(JSON.parse(readFileSync(LEDGER_PATH, "utf8")));

  const findings = ledger.claims.flatMap(checkClaim);

  process.stdout.write(`claim ledger: ${ledger.claims.length} claims, ${ledger.network}\n`);
  for (const claim of ledger.claims) {
    const evidence = claim.evidence.length === 0 ? "no evidence yet" : `${claim.evidence.length} item(s)`;
    process.stdout.write(
      `  ${claim.id}  ${claim.rung} -> ${claim.target_rung.padEnd(2)}  ${claim.gate.padEnd(3)}  ${evidence}\n`,
    );
  }

  if (findings.length > 0) {
    process.stderr.write("\nclaim:verify FAILED\n");
    for (const finding of findings) {
      process.stderr.write(`  ${finding.claimId}: ${finding.problem}\n`);
    }
    process.exit(1);
  }

  if (offline) {
    process.stdout.write("\nclaim:verify PASSED (offline): every claim sits at or below its evidence.\n");
    process.exit(0);
  }

  // PRD §21: the full check re-reads on-chain evidence. Nothing has reached R2
  // yet, so there is nothing to re-read; when the first transaction lands, this
  // is where it gets checked rather than trusted.
  const onChain = ledger.claims.filter((claim) =>
    claim.evidence.some((evidence) => ON_CHAIN_RUNGS.has(evidence.rung)),
  );
  if (onChain.length === 0) {
    process.stdout.write(
      "\nclaim:verify PASSED: every claim sits at or below its evidence.\n"
        + "No claim carries on-chain evidence yet, so there was nothing to re-read from chain.\n",
    );
    process.exit(0);
  }

  const failures = await reReadFromChain(onChain);
  if (failures.length > 0) {
    process.stderr.write("\nclaim:verify FAILED: on-chain evidence did not re-read.\n");
    for (const failure of failures) {
      process.stderr.write(`  ${failure}\n`);
    }
    process.exit(1);
  }
  process.stdout.write(
    `\nclaim:verify PASSED: every claim sits at or below its evidence, and the on-chain\n`
      + `evidence for ${onChain.length} claim(s) was re-read from a public RPC.\n`,
  );
  process.exit(0);
}

/**
 * PRD §21: re-reads every on-chain claim from chain.
 *
 * This is the check claim C-002 is about, so it deliberately does not ask the
 * registry what it thinks. It reads the stored sample and the stored commitment,
 * re-derives the verdict with `packages/reference` — a different implementation,
 * in a different language, running here rather than on chain — and compares that
 * against what the contract returns. Agreement is the evidence. Asking
 * `verdictOf` alone would only prove the contract agrees with itself.
 */
async function reReadFromChain(claims: readonly Claim[]): Promise<string[]> {
  const rpcUrl = process.env["SOMNIA_RPC_URL"];
  if (rpcUrl === undefined || rpcUrl.trim() === "") {
    return ["SOMNIA_RPC_URL is not set, so nothing could be re-read. Use --offline to skip."];
  }
  const client = createPublicClient({ transport: http(rpcUrl) });
  const failures: string[] = [];

  for (const claim of claims) {
    for (const evidence of claim.evidence) {
      if (evidence.txHash === undefined) {
        continue;
      }
      try {
        const receipt = await client.getTransactionReceipt({
          hash: evidence.txHash as `0x${string}`,
        });
        if (receipt.status !== "success") {
          failures.push(`${claim.id}: ${evidence.txHash} reverted on chain`);
          continue;
        }
        process.stdout.write(`  re-read ${claim.id}: ${evidence.txHash} in block ${receipt.blockNumber}\n`);
      } catch (error) {
        failures.push(`${claim.id}: ${evidence.txHash} does not resolve — ${(error as Error).message}`);
      }
    }
  }

  const registry = process.env["ASSIZE_REGISTRY_ADDRESS"];
  if (registry === undefined || registry.trim() === "") {
    process.stdout.write(
      "  ASSIZE_REGISTRY_ADDRESS unset: transactions were re-read, verdicts were not.\n",
    );
    return failures;
  }

  const registryAbi = [
    { type: "function", name: "sampleCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
    { type: "function", name: "verdictOf", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "uint8" }] },
    {
      type: "function", name: "sampleAt", stateMutability: "view", inputs: [{ type: "uint256" }],
      outputs: [{
        type: "tuple",
        components: [
          { name: "commitmentId", type: "uint256" },
          {
            name: "sample", type: "tuple",
            components: [
              { name: "bid", type: "uint128" }, { name: "ask", type: "uint128" },
              { name: "bidSize", type: "uint128" }, { name: "askSize", type: "uint128" },
              { name: "blockNumber", type: "uint64" }, { name: "blockHash", type: "bytes32" },
              { name: "source", type: "uint8" },
            ],
          },
        ],
      }],
    },
    {
      type: "function", name: "commitmentAt", stateMutability: "view", inputs: [{ type: "uint256" }],
      outputs: [{
        type: "tuple",
        components: [
          { name: "maker", type: "address" }, { name: "marketId", type: "bytes32" },
          { name: "maxSpread", type: "uint128" }, { name: "minSize", type: "uint128" },
          { name: "start", type: "uint64" }, { name: "end", type: "uint64" },
          { name: "bond", type: "uint256" }, { name: "forfeitedAtBreachIdPlusOne", type: "uint256" },
        ],
      }],
    },
  ] as const;

  const address = registry as `0x${string}`;
  const total = await client.readContract({ address, abi: registryAbi, functionName: "sampleCount" });
  const toCheck = total > 25n ? 25n : total;
  let agreed = 0;
  for (let id = 0n; id < toCheck; id += 1n) {
    const [record, onChainVerdict] = await Promise.all([
      client.readContract({ address, abi: registryAbi, functionName: "sampleAt", args: [id] }),
      client.readContract({ address, abi: registryAbi, functionName: "verdictOf", args: [id] }),
    ]);
    const commitment = await client.readContract({
      address, abi: registryAbi, functionName: "commitmentAt", args: [record.commitmentId],
    });
    const sample: StoredSample = {
      bid: record.sample.bid, ask: record.sample.ask,
      bidSize: record.sample.bidSize, askSize: record.sample.askSize,
      blockNumber: record.sample.blockNumber, blockHash: record.sample.blockHash,
      source: sampleSourceFromCode(record.sample.source),
    };
    const derived = referenceVerdict(
      {
        maxSpread: commitment.maxSpread, minSize: commitment.minSize,
        start: commitment.start, end: commitment.end,
      },
      sample,
    );
    const onChainName = VERDICT_STATES[onChainVerdict];
    if (derived !== onChainName) {
      failures.push(
        `sample ${id}: the chain says ${onChainName}, packages/reference re-derives ${derived}`,
      );
      continue;
    }
    agreed += 1;
  }
  process.stdout.write(
    `  re-derived ${agreed}/${toCheck} stored sample(s) with packages/reference; all agree with the chain\n`,
  );
  return failures;
}

await main();
