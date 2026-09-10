/**
 * `pnpm preflight` — is this deployment funded well enough to measure anything?
 *
 * PRD §8.2: "an unfunded subscription is a silent NOT_SAMPLED, which is the worst
 * failure this product can have." DECISIONS.md D-020 makes that sharper: when the
 * subscriber's balance cannot cover a whole `gasLimit` at firing time, the
 * subscription is not skipped, it is REMOVED. Sampling ends and nothing says so.
 *
 * This checks the funding before that can happen, rather than diagnosing it after.
 * It reads balances only and never a private key.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createPublicClient, formatEther, http, type Address } from "viem";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * From the pinned `@somnia-chain/reactivity-contracts` at 0.2.1.
 * `contracts/test/FundingConstants.t.sol` asserts these against the library's own
 * constants, so an upstream change fails a test rather than a deployment.
 */
const SUBSCRIPTION_OWNER_MINIMUM_BALANCE = 32n * 10n ** 18n;
const MINIMUM_BASE_FEE_PER_GAS = 6n * 10n ** 9n;

/**
 * Measured against a LIVE pool with `cast estimate`: 2,730,154 gas.
 *
 * The same handler costs 254,574 against a test fixture, and a limit set from
 * that number made every callback run out of gas — charged, and writing nothing
 * (DECISIONS.md D-022). Re-estimate against the pool actually being sampled
 * rather than reusing this constant; G11 requires publishing the cost per sample.
 */
const RECOMMENDED_GAS_LIMIT = 6_000_000n;

/** Enough samples for gate G6, at the recommended limit. */
const CAMPAIGN_SAMPLES = 300n;

interface Row {
  readonly label: string;
  readonly address: Address;
  readonly need: bigint;
  readonly why: string;
}

function readAddresses(): Record<string, string> {
  // Addresses only. The keys in .env.local are never read by this script.
  try {
    return Object.fromEntries(
      readFileSync(join(REPO_ROOT, "wallets.public.txt"), "utf8")
        .split("\n")
        .map((line) => line.trim().split(/\s+/u))
        .filter((parts): parts is [string, string] => parts.length === 2 && /^0x[0-9a-fA-F]{40}$/u.test(parts[1] ?? ""))
        .map(([role, address]) => [role, address]),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

async function main(): Promise<void> {
  const rpcUrl = process.env["SOMNIA_RPC_URL"];
  if (rpcUrl === undefined || rpcUrl.trim() === "") {
    process.stderr.write("SOMNIA_RPC_URL is not set. See .env.example.\n");
    process.exit(1);
  }
  const client = createPublicClient({ transport: http(rpcUrl) });

  const wallets = readAddresses();
  const bond = BigInt(process.env["ASSIZE_BOND_WEI"] ?? String(10n ** 18n));
  const perFiring = MINIMUM_BASE_FEE_PER_GAS * RECOMMENDED_GAS_LIMIT;
  const campaignBudget = perFiring * CAMPAIGN_SAMPLES;

  const rows: Row[] = [];
  const deployer = wallets["DEPLOYER"];
  const maker = wallets["MAKER"];
  const subscriber = process.env["ASSIZE_SUBSCRIBER_ADDRESS"];

  if (deployer !== undefined) {
    rows.push({
      label: "DEPLOYER",
      address: deployer as Address,
      // Deployment gas, the 210,000 the reference charges for creating a
      // subscription, and the balance it forwards to the subscriber.
      need: SUBSCRIPTION_OWNER_MINIMUM_BALANCE + campaignBudget + 2n * 10n ** 18n,
      why: "deploy gas, subscribe (210k gas), and the balance it forwards to the subscriber",
    });
  }
  if (maker !== undefined) {
    rows.push({
      label: "MAKER",
      address: maker as Address,
      need: bond + 10n ** 18n,
      why: "the bond it posts, plus gas to publish and to quote",
    });
  }
  if (subscriber !== undefined && subscriber.trim() !== "") {
    rows.push({
      label: "SUBSCRIBER",
      address: subscriber as Address,
      need: SUBSCRIPTION_OWNER_MINIMUM_BALANCE + campaignBudget,
      why: "minimum owner balance at subscribe(), plus a campaign's worth of handler gas",
    });
  }

  if (rows.length === 0) {
    process.stderr.write(
      "Nothing to check: no wallets.public.txt and no ASSIZE_SUBSCRIBER_ADDRESS.\n",
    );
    process.exit(1);
  }

  process.stdout.write("preflight — funding\n-------------------\n");
  let short = 0;
  for (const row of rows) {
    const balance = await client.getBalance({ address: row.address });
    const ok = balance >= row.need;
    if (!ok) {
      short += 1;
    }
    process.stdout.write(
      `  [${ok ? "OK     " : "SHORT  "}] ${row.label.padEnd(10)} ${row.address}\n`
        + `      has ${formatEther(balance)} STT, wants ${formatEther(row.need)} STT — ${row.why}\n`,
    );
  }

  process.stdout.write(
    `\n  The subscriber's balance is tested against a whole gasLimit at every firing,\n`
      + `  not against gas used. At ${RECOMMENDED_GAS_LIMIT} gas and ${MINIMUM_BASE_FEE_PER_GAS / 10n ** 9n} gwei that is `
      + `${formatEther(perFiring)} STT that must stay free,\n`
      + `  or the subscription is removed rather than skipped (DECISIONS.md D-020).\n`,
  );

  if (short > 0) {
    process.stdout.write(`\npreflight NOT READY: ${short} account(s) short.\n`);
    process.exit(1);
  }
  process.stdout.write("\npreflight READY: every account meets its floor.\n");
}

await main();
