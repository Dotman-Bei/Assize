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

import { findForbiddenWords } from "@assize/protocol-types/vocabulary";
import { claimLedgerSchema, type Claim } from "@assize/protocol-types/schemas";

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

function main(): void {
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

  process.stderr.write(
    `\nclaim:verify FAILED: ${onChain.length} claim(s) carry on-chain evidence, but the on-chain\n`
      + "re-read is not implemented yet. It lands with Phase P2, the phase that first produces\n"
      + "a transaction to re-read. Until then a claim above R1 cannot be verified, so it must\n"
      + "not be recorded (PRD §21: a claim and its evidence land in the same commit or neither).\n",
  );
  process.exit(1);
}

main();
