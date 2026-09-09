/**
 * G2 — evaluator agreement (PRD §22, §10, §13).
 *
 * "The Solidity evaluator and `packages/reference` agree on 10,000 generated
 * commitment and sample pairs, zero divergence."
 *
 * This driver generates the corpus, evaluates it with the TypeScript reference,
 * writes the pairs and the reference verdicts to fixtures, and hands them to a
 * Foundry test that re-evaluates each pair with `VerdictLib` and asserts equality.
 * Exit code is the gate: zero means agreement.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  SAMPLE_SOURCE_CODE,
  VERDICT_CODE,
  VERDICT_STATES,
  type VerdictState,
} from "@assize/protocol-types";
import { isBreach, isEnvelopeInDomain, isSampleInDomain, verdict } from "@assize/reference";
import { encodeAbiParameters } from "viem";

import { buildVectors } from "./differential-vectors.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE_DIR = join(REPO_ROOT, "contracts", "test", "fixtures");

/** PRD §13 and §22 G2 both name this number. */
const TOTAL_PAIRS = 10_000;
/** Pairs per fixture file, so the EVM decodes a bounded amount of memory at once. */
const CHUNK_SIZE = 1_000;
/** Fixed so a divergence found in CI reproduces locally (PRD §22: "fresh clone"). */
const SEED = 0x0a55_1235;

const CASE_TUPLE = {
  type: "tuple[]",
  components: [
    { name: "maxSpread", type: "uint32" },
    { name: "minSize", type: "uint128" },
    { name: "start", type: "uint64" },
    { name: "end", type: "uint64" },
    { name: "bid", type: "uint128" },
    { name: "ask", type: "uint128" },
    { name: "bidSize", type: "uint128" },
    { name: "askSize", type: "uint128" },
    { name: "blockNumber", type: "uint64" },
    { name: "blockHash", type: "bytes32" },
    { name: "source", type: "uint8" },
    { name: "expected", type: "uint8" },
    { name: "expectedBreach", type: "uint8" },
  ],
} as const;

function main(): void {
  const cases = buildVectors(TOTAL_PAIRS, SEED);
  if (cases.length !== TOTAL_PAIRS) {
    throw new Error(`generator produced ${cases.length} pairs, expected ${TOTAL_PAIRS}`);
  }

  const tally = new Map<VerdictState, number>(VERDICT_STATES.map((s) => [s, 0]));
  const encoded = cases.map((testCase) => {
    // The two implementations share a domain: Solidity gets it from its storage
    // widths, TypeScript has to be told. A generator escaping the domain is a
    // bug in the generator, not a divergence, so it fails loudly here.
    if (!isSampleInDomain(testCase.sample) || !isEnvelopeInDomain(testCase.envelope)) {
      throw new Error("generated pair falls outside the shared numeric domain");
    }
    const state = verdict(testCase.envelope, testCase.sample);
    tally.set(state, (tally.get(state) ?? 0) + 1);
    return {
      // viem encodes uint32 as `number`, wider ints as `bigint`. A uint32 is
      // exactly representable as a JS number, so this conversion is lossless.
      maxSpread: Number(testCase.envelope.maxSpread),
      minSize: testCase.envelope.minSize,
      start: testCase.envelope.start,
      end: testCase.envelope.end,
      bid: testCase.sample.bid,
      ask: testCase.sample.ask,
      bidSize: testCase.sample.bidSize,
      askSize: testCase.sample.askSize,
      blockNumber: testCase.sample.blockNumber,
      blockHash: testCase.sample.blockHash,
      source: SAMPLE_SOURCE_CODE[testCase.sample.source],
      expected: VERDICT_CODE[state],
      expectedBreach: isBreach(state) ? 1 : 0,
    };
  });

  mkdirSync(FIXTURE_DIR, { recursive: true });
  for (const stale of readdirSync(FIXTURE_DIR)) {
    if (stale.startsWith("differential.")) {
      rmSync(join(FIXTURE_DIR, stale));
    }
  }

  const chunkCount = Math.ceil(encoded.length / CHUNK_SIZE);
  for (let index = 0; index < chunkCount; index += 1) {
    const chunk = encoded.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE);
    const hex = encodeAbiParameters([CASE_TUPLE], [chunk]);
    writeFileSync(join(FIXTURE_DIR, `differential.${String(index).padStart(3, "0")}.hex`), hex);
  }
  writeFileSync(join(FIXTURE_DIR, "differential.manifest"), String(chunkCount));

  process.stdout.write(
    `G2 differential: ${TOTAL_PAIRS} pairs, seed 0x${SEED.toString(16)}, ${chunkCount} chunks\n`,
  );
  // PRD §14's reporting rule applied to the corpus: every state on its own line,
  // including the ones with zero occurrences. A state the corpus never reaches is
  // a state the gate did not actually test, and that should be visible.
  for (const state of VERDICT_STATES) {
    process.stdout.write(`  ${state.padEnd(18)} ${String(tally.get(state) ?? 0).padStart(6)}\n`);
  }

  const untested = VERDICT_STATES.filter((state) => (tally.get(state) ?? 0) === 0);
  if (untested.length > 0) {
    process.stderr.write(
      `G2 FAILED: the corpus never reaches ${untested.join(", ")}. `
        + "A state the corpus does not reach is not covered by this gate.\n",
    );
    process.exit(1);
  }

  const forge = process.env["FORGE_BIN"] ?? "forge";
  process.stdout.write(`\nreplaying the same pairs through VerdictLib (${forge})\n`);
  try {
    const output = execFileSync(
      forge,
      ["test", "--match-path", "contracts/test/Differential.t.sol", "-vv"],
      { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 << 20 },
    );
    process.stdout.write(output);
  } catch (error) {
    // AGENTS.md forbids an empty catch. Report what forge said, then fail the gate.
    const shell = error as { stdout?: string; stderr?: string; message?: string };
    process.stdout.write(shell.stdout ?? "");
    process.stderr.write(shell.stderr ?? shell.message ?? "forge failed with no output\n");
    process.stderr.write("\nG2 FAILED: the two evaluators diverge, or forge could not run.\n");
    process.exit(1);
  }
  process.stdout.write("G2 PASSED: zero divergence over 10,000 pairs.\n");
}

main();
