/**
 * `pnpm skills:verify` — AGENTS.md and PRD §0.2.
 *
 * The pinned upstream is only a pin if something checks it. This compares what
 * is installed against `skills-lock.json` and fails when they part company,
 * because a silent upstream change is how an invented ABI gets in (PRD §0.3).
 *
 * It reports what it cannot check as unchecked rather than as passing: the git
 * sources are pinned by commit and are not vendored into this repository, so
 * offline there is nothing local to hash for them.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

interface Skill {
  readonly id: string;
  readonly kind: "npm" | "git" | "http";
  readonly source: string;
  readonly version?: string;
  readonly commit?: string;
  readonly files?: readonly { path: string; sha256: string }[];
}

function main(): void {
  const lock = JSON.parse(readFileSync(join(REPO_ROOT, "skills-lock.json"), "utf8")) as {
    skills: Skill[];
  };
  const require = createRequire(import.meta.url);
  let failures = 0;
  let unchecked = 0;

  for (const skill of lock.skills) {
    if (skill.kind === "npm" && skill.version !== undefined) {
      const packageName = skill.source.replace("https://registry.npmjs.org/", "");
      try {
        const manifest = JSON.parse(
          readFileSync(join(dirname(require.resolve(packageName)), "..", "package.json"), "utf8"),
        ) as { version: string };
        if (manifest.version === skill.version) {
          process.stdout.write(`  OK        ${skill.id} @ ${manifest.version}\n`);
        } else {
          process.stderr.write(
            `  MISMATCH  ${skill.id}: installed ${manifest.version}, lock says ${skill.version}\n`,
          );
          failures += 1;
        }
      } catch (error) {
        process.stderr.write(`  MISSING   ${skill.id}: ${(error as Error).message}\n`);
        failures += 1;
      }
      continue;
    }

    // A git or http source pinned by commit or content hash is not vendored
    // here, so there is nothing local to compare. Saying so beats printing OK.
    const pin = skill.commit ?? "content hash";
    process.stdout.write(`  UNCHECKED ${skill.id} (pinned at ${pin}; not vendored locally)\n`);
    unchecked += 1;
    for (const file of skill.files ?? []) {
      const local = join(REPO_ROOT, ".skills", skill.id, file.path);
      try {
        const digest = createHash("sha256").update(readFileSync(local)).digest("hex");
        if (digest === file.sha256) {
          process.stdout.write(`  OK          ${skill.id}/${file.path}\n`);
        } else {
          process.stderr.write(
            `  MISMATCH    ${skill.id}/${file.path}: upstream changed. Re-inspect and record it "
            + "in DECISIONS.md (AGENTS.md).\n`,
          );
          failures += 1;
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw error;
        }
        // Not fetched locally. The hash in the lock is still the record of what
        // was read when the code was written.
      }
    }
  }

  process.stdout.write(
    `\nskills:verify ${failures === 0 ? "PASSED" : "FAILED"}: `
      + `${lock.skills.length} pinned, ${failures} mismatched, ${unchecked} not vendored locally.\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main();
