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

const sampleRecorded = parseAbiItem(
  "event SampleRecorded(uint256 indexed sampleId, uint256 indexed commitmentId, uint8 verdict, uint8 source, uint64 blockNumber, bytes32 blockHash, uint128 bid, uint128 ask, uint128 bidSize, uint128 askSize)",
);

async function main(): Promise<void> {
  const rpcUrl = process.env["SOMNIA_RPC_URL"];
  const registry = process.env["ASSIZE_REGISTRY_ADDRESS"] as Address | undefined;
  if (rpcUrl === undefined || registry === undefined) {
    process.stderr.write("SOMNIA_RPC_URL and ASSIZE_REGISTRY_ADDRESS are required.\n");
    process.exit(1);
  }
  const client = createPublicClient({ transport: http(rpcUrl) });
  const head = await client.getBlockNumber();

  // Somnia caps eth_getLogs at 1000 blocks, so walk backwards in windows.
  const logs = [];
  let failedWindows = 0;
  for (let i = 0; i < 30; i += 1) {
    const toBlock = head - BigInt(i) * 1000n;
    if (toBlock <= 0n) break;
    try {
      logs.push(...(await client.getLogs({
        address: registry, event: sampleRecorded,
        fromBlock: toBlock - 999n, toBlock,
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
  writeFileSync("evidence/live-run.txt", lines.join("\n") + "\n");
  process.stdout.write(lines.join("\n") + "\n");
}

await main();
