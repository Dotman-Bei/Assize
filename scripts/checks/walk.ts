/**
 * Shared file walker for the hygiene checks (PRD §22 G1 and G8, AGENTS.md).
 * Kept separate so all three checks agree on what "a tracked source file" means.
 */

import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SKIP_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "dist",
  "out",
  "cache",
  "cache_forge",
  "broadcast",
  "coverage",
  // AGENTS.md hard block: nothing under internal/ is committed, so nothing
  // under it is scanned either.
  "internal",
  // Vendored upstream. Not ours to edit, and PRD §0.3 says inspect it rather
  // than change it.
  "lib",
]);

export function walk(root: string, roots: readonly string[]): string[] {
  const found: string[] = [];
  const visit = (directory: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(directory);
    } catch (error) {
      // AGENTS.md forbids an empty catch. A directory that is listed in the
      // scan roots but absent is normal in an early phase, and is not a failure.
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return;
      }
      throw error;
    }
    for (const entry of entries) {
      if (SKIP_DIRECTORIES.has(entry)) {
        continue;
      }
      const full = join(directory, entry);
      if (statSync(full).isDirectory()) {
        visit(full);
      } else {
        found.push(relative(root, full));
      }
    }
  };
  for (const scanRoot of roots) {
    visit(join(root, scanRoot));
  }
  return found.sort();
}

export function hasExtension(path: string, extensions: readonly string[]): boolean {
  return extensions.some((extension) => path.endsWith(extension));
}

/** Prints a findings table and returns the process exit code. */
export function report(
  gate: string,
  rule: string,
  findings: readonly { file: string; line: number; detail: string }[],
): number {
  if (findings.length === 0) {
    process.stdout.write(`${gate} PASSED: ${rule}\n`);
    return 0;
  }
  process.stderr.write(`${gate} FAILED: ${rule}\n\n`);
  for (const finding of findings) {
    process.stderr.write(`  ${finding.file}:${finding.line}  ${finding.detail}\n`);
  }
  process.stderr.write(`\n${findings.length} finding(s).\n`);
  return 1;
}
