/**
 * G1, static half (PRD §22): "the address-literal check finds nothing in
 * `apps/` or `packages/`". AGENTS.md widens the scope to `contracts/src`.
 *
 * PRD §17: no market id, contract address, event signature, precompile address,
 * tick size, or token address is compiled in. An address literal in source is
 * the most common way that rule is broken, and it is mechanically detectable,
 * so it is the part that CI enforces.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { hasExtension, report, walk } from "./walk.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** AGENTS.md scope: `apps/`, `packages/`, `contracts/src`. */
const SCAN_ROOTS = ["apps", "packages", "contracts/src"] as const;
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".sol", ".json"] as const;

/** A 20-byte hex literal: the shape of an EVM address. */
const ADDRESS_LITERAL = /0x[0-9a-fA-F]{40}\b/gu;

function main(): void {
  const findings: { file: string; line: number; detail: string }[] = [];
  for (const file of walk(REPO_ROOT, SCAN_ROOTS)) {
    if (!hasExtension(file, SOURCE_EXTENSIONS)) {
      continue;
    }
    const lines = readFileSync(join(REPO_ROOT, file), "utf8").split("\n");
    lines.forEach((line, index) => {
      for (const match of line.matchAll(ADDRESS_LITERAL)) {
        findings.push({
          file,
          line: index + 1,
          detail: `address literal ${match[0]} — read it at runtime instead (PRD §17)`,
        });
      }
    });
  }
  process.exit(report("G1/address-literals", "no compiled-in address literals", findings));
}

main();
