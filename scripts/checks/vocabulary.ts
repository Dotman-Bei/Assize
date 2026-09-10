/**
 * G8, vocabulary half (PRD §22): "No forbidden word in any claim or UI string".
 * AGENTS.md: "Never write, in code, copy, README, commit message, or claim:
 * guaranteed, safe, liquid, always, protected, insured, risk-free."
 *
 * Scope (DECISIONS.md D-007). Scanned: source and comments under `apps/`,
 * `packages/`, `scripts/`, `contracts/`, plus the claim text in `claims.json`
 * and the user-facing documents at the repository root.
 *
 * Not scanned: the documents that define the rule — `PRD.md`, `AGENTS.md`,
 * `WHAT_IS_MEASURED.md`, `frontend.md`, `DECISIONS.md`, `docs/kill-criteria.md`
 * — the `rules` array in `claims.json`, and `packages/protocol-types/src/
 * vocabulary.ts`. Each has to name the forbidden words in order to forbid them,
 * and a check that fails on its own rulebook is one nobody can keep green.
 *
 * Matching is on word boundaries, so "liquidity" and "safeParse" pass while
 * "liquid" and "safe" do not. See `vocabulary.ts` for why.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { findForbiddenWords, forbiddenWordPattern } from "@assize/protocol-types/vocabulary";
import { claimLedgerSchema } from "@assize/protocol-types/schemas";

import { hasExtension, report, walk } from "./walk.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const SCAN_ROOTS = ["apps", "packages", "scripts", "contracts/src", "contracts/test"] as const;
const SCANNED_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".sol"] as const;

/** Root documents that speak to a user, and so must not overclaim. */
const SCANNED_DOCUMENTS = [
  "README.md",
  "SETUP.md",
  "DEPLOYMENT.md",
  "SECURITY.md",
  "ARCHITECTURE.md",
  "FEEDBACK.md",
] as const;

/** The rule's own rulebook. See the module comment. */
const EXEMPT = new Set([
  "packages/protocol-types/src/vocabulary.ts",
  "scripts/checks/vocabulary.ts",
]);

const CLAIMS = "packages/claim-ledger/data/claims.json";

function main(): void {
  const findings: { file: string; line: number; detail: string }[] = [];

  const record = (file: string, text: string): void => {
    text.split("\n").forEach((line, index) => {
      for (const match of line.matchAll(forbiddenWordPattern())) {
        findings.push({
          file,
          line: index + 1,
          detail: `forbidden word "${match[0]}" — PRD §5.2 and AGENTS.md`,
        });
      }
    });
  };

  for (const file of walk(REPO_ROOT, SCAN_ROOTS)) {
    if (EXEMPT.has(file) || !hasExtension(file, SCANNED_EXTENSIONS)) {
      continue;
    }
    record(file, readFileSync(join(REPO_ROOT, file), "utf8"));
  }

  for (const document of SCANNED_DOCUMENTS) {
    try {
      record(document, readFileSync(join(REPO_ROOT, document), "utf8"));
    } catch (error) {
      // A document that does not exist yet is not a violation. PRD §19 requires
      // these at submission; G12 is where their absence is a failure, not here.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }

  // Claims are checked field by field rather than as raw JSON, so that the
  // `rules` array can go on naming the words it forbids.
  const ledger = claimLedgerSchema.parse(
    JSON.parse(readFileSync(join(REPO_ROOT, CLAIMS), "utf8")),
  );
  for (const claim of ledger.claims) {
    for (const word of findForbiddenWords(claim.claim)) {
      findings.push({
        file: CLAIMS,
        line: 0,
        detail: `claim ${claim.id} contains the forbidden word "${word}"`,
      });
    }
    for (const evidence of claim.evidence) {
      for (const word of findForbiddenWords(evidence.description)) {
        findings.push({
          file: CLAIMS,
          line: 0,
          detail: `evidence for ${claim.id} contains the forbidden word "${word}"`,
        });
      }
    }
  }

  process.exit(report("G8/vocabulary", "no forbidden word in code, copy or claims", findings));
}

main();
