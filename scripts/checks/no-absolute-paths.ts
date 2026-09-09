/**
 * AGENTS.md hard block: no absolute developer paths in any tracked file.
 * A path that only resolves on one machine breaks the "fresh clone" premise
 * that every gate in PRD §22 rests on.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { report, walk } from "./walk.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const SCAN_ROOTS = ["apps", "packages", "contracts", "scripts", "docs", ".github"] as const;

/** Home directories and Windows drive roots. */
const ABSOLUTE_PATH = /(?:\/(?:home|Users|root)\/[A-Za-z0-9._-]+|[A-Za-z]:\\{1,2}[A-Za-z0-9._-]+)/gu;

function main(): void {
  const findings: { file: string; line: number; detail: string }[] = [];
  for (const file of walk(REPO_ROOT, SCAN_ROOTS)) {
    if (file.includes("fixtures/differential.")) {
      continue;
    }
    let contents: string;
    try {
      contents = readFileSync(join(REPO_ROOT, file), "utf8");
    } catch (error) {
      // Binary or unreadable files carry no developer paths worth reporting,
      // but the reason is recorded rather than swallowed (AGENTS.md).
      process.stderr.write(`  skipped unreadable ${file}: ${(error as Error).message}\n`);
      continue;
    }
    contents.split("\n").forEach((line, index) => {
      for (const match of line.matchAll(ABSOLUTE_PATH)) {
        findings.push({ file, line: index + 1, detail: `absolute developer path ${match[0]}` });
      }
    });
  }
  process.exit(report("hygiene/paths", "no absolute developer paths", findings));
}

main();
