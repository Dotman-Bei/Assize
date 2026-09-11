/**
 * Reads what actually happened on chain and writes it to `evidence/`.
 *
 * PRD §14's reporting rule: every state on its own line, failures included,
 * `NOT_SAMPLED` never folded into coverage and never dropped from a denominator.
 * Nothing here is computed from our own database — it is read back from the
 * registry's events, which is what a verifier reads.
 */

import { writeFileSync } from "node:fs";
import { createPublicClient, http, parseAbiItem, type Address } from "viem";

const VERDICTS = [
  "NOT_SAMPLED", "SAMPLER_FAILED", "WINDOW_CLOSED", "ABSENT",
  "SPREAD_BREACH", "DEPTH_BREACH", "COVERED_AT_SAMPLE",
] as const;
const SOURCES = ["UNLABELLED", "REACTIVITY", "KEEPER"] as const;

/** 1000-block windows to walk back. Somnia caps eth_getLogs at 1000 per call. */
const SCAN_WINDOWS = 30;

const sampleRecorded = parseAbiItem(
  "event SampleRecorded(uint256 indexed sampleId, uint256 indexed commitmentId, uint8 verdict, uint8 source, uint64 blockNumber, bytes32 blockHash, uint128 bid, uint128 ask, uint128 bidSize, uint128 askSize)",
);

/** A `--name value` flag, or undefined. */
function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

/** An environment variable, treating blank as absent. */
function env(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value.trim() === "" ? undefined : value.trim();
}

async function main(): Promise<void> {
  // Blank counts as unset. `.env.example` ships these keys with empty values, so
  // a clone that sources it has them defined and empty — which slipped past an
  // `=== undefined` guard and reached viem as an empty address, surfacing as a
  // stack trace instead of the one-line message directly below.
  const rpcUrl = env("SOMNIA_RPC_URL");
  const registry = env("ASSIZE_REGISTRY_ADDRESS") as Address | undefined;
  if (rpcUrl === undefined || registry === undefined) {
    process.stderr.write("SOMNIA_RPC_URL and ASSIZE_REGISTRY_ADDRESS are required.\n");
    process.exit(1);
  }
  const client = createPublicClient({ transport: http(rpcUrl) });
  const head = await client.getBlockNumber();

  // The registry's own totals, which are cumulative and independent of any scan
  // window. Reported alongside the scan because a log scan on a chain producing
  // a block every 100ms covers minutes, not history: 30,000 blocks is under an
  // hour. Without these two numbers beside it, a scan that finds nothing reads
  // as "nothing ever happened" rather than "nothing happened lately".
  const registryAbi = [
    { type: "function", name: "sampleCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
    { type: "function", name: "breachCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  ] as const;
  const [totalSamples, totalBreaches] = await Promise.all([
    client.readContract({ address: registry, abi: registryAbi, functionName: "sampleCount" }),
    client.readContract({ address: registry, abi: registryAbi, functionName: "breachCount" }),
  ]);

  // The range to scan. By default the last SCAN_WINDOWS*1000 blocks, which is
  // the "is it sampling right now" question. `--from`/`--to` asks a different
  // and equally real question — what a completed run did over its own window —
  // and a run that has ended cannot be described by a scan pinned to the head.
  const fromFlag = flag("from");
  const toFlag = flag("to");
  const explicitRange = fromFlag !== undefined || toFlag !== undefined;
  const scanTo = toFlag === undefined ? head : BigInt(toFlag);
  const scanFrom = fromFlag === undefined
    ? (scanTo > BigInt(SCAN_WINDOWS * 1000) ? scanTo - BigInt(SCAN_WINDOWS * 1000) : 0n)
    : BigInt(fromFlag);
  if (scanFrom > scanTo) {
    process.stderr.write(`--from ${scanFrom} is after --to ${scanTo}.\n`);
    process.exit(2);
  }

  // Somnia caps eth_getLogs at 1000 blocks per call, so walk the range in windows.
  const logs = [];
  let failedWindows = 0;
  let scannedWindows = 0;
  for (let start = scanFrom; start <= scanTo; start += 1000n) {
    const end = start + 999n > scanTo ? scanTo : start + 999n;
    scannedWindows += 1;
    try {
      logs.push(...(await client.getLogs({
        address: registry, event: sampleRecorded, fromBlock: start, toBlock: end,
      })));
    } catch {
      failedWindows += 1;
    }
  }

  const byVerdict = new Map<string, number>(VERDICTS.map((v) => [v, 0]));
  const bySource = new Map<string, number>(SOURCES.map((s) => [s, 0]));
  const blocks = new Set<string>();
  for (const log of logs) {
    const a = log.args;
    byVerdict.set(VERDICTS[Number(a.verdict)] ?? "?", (byVerdict.get(VERDICTS[Number(a.verdict)] ?? "?") ?? 0) + 1);
    bySource.set(SOURCES[Number(a.source)] ?? "?", (bySource.get(SOURCES[Number(a.source)] ?? "?") ?? 0) + 1);
    blocks.add(String(a.blockNumber));
  }

  const lines: string[] = [];
  lines.push(`Assize evidence — read from chain, not from our database`);
  lines.push(`generated ${new Date().toISOString()}`);
  lines.push(`registry ${registry}   chain ${await client.getChainId()}   head ${head}`);
  lines.push(``);
  lines.push(`TOTALS, read from the registry and cumulative since deployment:`);
  lines.push(`  samples recorded:  ${totalSamples}`);
  lines.push(`  breaches recorded: ${totalBreaches}`);
  lines.push(``);
  lines.push(`The rest of this report covers a log scan of blocks ${scanFrom} to ${scanTo}`);
  lines.push(`(${scanTo - scanFrom + 1n} blocks, ${scannedWindows} windows of 1000). Somnia produces a block`);
  lines.push(`every 100ms, so 30000 blocks is well under an hour.`);
  if (explicitRange) {
    lines.push(`This range was given explicitly, so it describes whatever happened between those two`);
    lines.push(`blocks and says nothing about any other part of the chain.`);
  } else {
    lines.push(`A count of zero below means nothing was sampled in the last hour — not that nothing`);
    lines.push(`was ever sampled. The totals above are the record.`);
  }
  lines.push(``);
  lines.push(`samples observed in the scanned range: ${logs.length}`);
  lines.push(`distinct blocks sampled:               ${blocks.size}`);
  lines.push(``);
  lines.push(`verdicts, every state on its own line (PRD §14):`);
  for (const v of VERDICTS) lines.push(`  ${v.padEnd(18)} ${String(byVerdict.get(v) ?? 0).padStart(6)}`);
  lines.push(``);
  lines.push(`sample source, in storage and on screen (AGENTS.md):`);
  for (const s of SOURCES) lines.push(`  ${s.padEnd(18)} ${String(bySource.get(s) ?? 0).padStart(6)}`);
  lines.push(``);
  lines.push(`infrastructure: ${failedWindows} log window(s) failed during the scan`);
  lines.push(``);
  lines.push(`READ THIS BEFORE QUOTING THE SAMPLE COUNT.`);
  lines.push(`The subscription filters on the pool's address with a wildcard topic, so every`);
  lines.push(`log the pool emits triggers one callback. A block containing many pool events`);
  lines.push(`therefore produces many samples that read the same book at the same instant.`);
  lines.push(`They are real observations and none is fabricated, but they are redundant, and`);
  lines.push(`the honest measure of how often the book was observed is the distinct-block`);
  lines.push(`count above, not the sample count. Neither number is dropped here.`);
  const out = explicitRange ? `evidence/run-${scanFrom}-${scanTo}.txt` : "evidence/live-run.txt";
  writeFileSync(out, lines.join("\n") + "\n");
  lines.push(``);
  lines.push(`written to ${out}`);
  process.stdout.write(lines.join("\n") + "\n");
}

await main();
