#!/usr/bin/env node
/**
 * `assize verify <breachId>` — PRD §11 and §22 G7.
 *
 * Needs a public RPC and a registry address, and nothing else: no account, no
 * API key, and no access to anything of ours. The registry address is read from
 * the committed deployment record so a stranger with a fresh clone needs only
 * the breach id, but it is never compiled in (PRD §17) and `--registry`
 * overrides it.
 *
 * Exit code is the answer. Zero means every check passed.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Address } from "viem";

import { verify } from "./verify.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");

const USAGE = `assize — re-derive a recorded verdict from chain

  assize verify <breachId> [options]
  assize verify --sample <sampleId> [options]

Options
  --rpc <url>         JSON-RPC endpoint. Defaults to the deployment record's.
  --registry <0x..>   Registry address. Defaults to the deployment record's.
  --sample <id>       Verify a sample directly instead of a breach.
  --json              Machine-readable output.

It reads the stored sample and the stored commitment, re-derives the verdict with
packages/reference, and compares that against what the chain says. It never asks
the registry for the verdict and then believes it: agreement between two
independent implementations is the evidence.

Exit code 0 means every check passed.
`;

interface Deployment {
  readonly rpcUrl: string;
  readonly contracts: { readonly AssizeRegistry: string };
}

/** The committed record, so a fresh clone needs no configuration to verify. */
function loadDeployment(): Deployment | undefined {
  try {
    const dir = join(REPO_ROOT, "deployments");
    const file = readdirSync(dir).find((f) => f.endsWith(".json"));
    if (file === undefined) return undefined;
    return JSON.parse(readFileSync(join(dir, file), "utf8")) as Deployment;
  } catch {
    // A missing record is not an error: --rpc and --registry cover it.
    return undefined;
  }
}

function flag(argv: readonly string[], name: string): string | undefined {
  const at = argv.indexOf(name);
  return at >= 0 ? argv[at + 1] : undefined;
}

/** An environment variable, treating blank as absent. */
function env(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value.trim() === "" ? undefined : value.trim();
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h" || argv[0] !== "verify") {
    process.stdout.write(USAGE);
    process.exit(argv[0] === "--help" || argv[0] === "-h" ? 0 : 1);
  }

  const record = loadDeployment();
  // `env` rather than `process.env` directly, because `??` only falls through on
  // null and undefined. A key defined as empty — which is how `.env.example`
  // ships every address — is a string, so it won an `??` chain against the
  // deployment record and left this command reading the empty address while a
  // correct record sat unused beside it.
  const rpcUrl = flag(argv, "--rpc") ?? env("SOMNIA_RPC_URL") ?? record?.rpcUrl;
  const registry = (flag(argv, "--registry") ?? env("ASSIZE_REGISTRY_ADDRESS")
    ?? record?.contracts.AssizeRegistry) as Address | undefined;
  const sampleFlag = flag(argv, "--sample");
  const positional = argv.slice(1).find((a) => !a.startsWith("--") && /^\d+$/u.test(a));

  if (rpcUrl === undefined || registry === undefined) {
    process.stderr.write("No RPC or registry address. Pass --rpc and --registry, or run from a clone with deployments/.\n");
    process.exit(2);
  }
  const id = sampleFlag ?? positional;
  if (id === undefined) {
    process.stderr.write("Which breach? Pass a breach id, or --sample <id>.\n\n" + USAGE);
    process.exit(2);
  }

  const result = await verify({
    rpcUrl, registry, id: BigInt(id), by: sampleFlag === undefined ? "breach" : "sample",
  });

  if (argv.includes("--json")) {
    process.stdout.write(JSON.stringify({
      passed: result.passed, sampleId: result.sampleId.toString(),
      derived: result.derived, onChain: result.onChain,
      checks: result.checks,
    }, null, 2) + "\n");
    process.exit(result.passed ? 0 : 1);
  }

  process.stdout.write(`\nassize verify ${sampleFlag === undefined ? `breach ${id}` : `sample ${id}`}\n`);
  process.stdout.write(`registry ${registry}\n\n`);
  for (const check of result.checks) {
    process.stdout.write(`  ${check.ok ? "ok  " : "FAIL"}  ${check.name.padEnd(22)} ${check.detail}\n`);
  }
  process.stdout.write(
    result.passed
      ? `\nPASS. The verdict re-derives to ${result.derived} from chain alone, and the chain agrees.\n`
      : `\nFAIL. See the lines marked FAIL above.\n`,
  );
  process.exit(result.passed ? 0 : 1);
}

await main();
