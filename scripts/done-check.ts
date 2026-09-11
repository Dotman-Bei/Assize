/**
 * `pnpm check:done` — PRD §28, the Definition of Done, as a command.
 *
 * §28 is eleven checkboxes and they were being counted by hand. Twice that
 * produced a wrong answer about item 10: `BUILD_LOG.md` fell behind, was fixed,
 * and fell behind again within three commits, because no gate looked at it. A
 * checklist nothing executes drifts from the thing it describes, which is the
 * same failure this project spends its whole design avoiding elsewhere.
 *
 * Two states only, and never three: an item is met or it is not. "Partly" is how
 * a checklist lies. Where an item cannot be met at all — a payout that no
 * deployed code can perform — it is reported as unmeetable and counted as not
 * met, because the honest total is the one that does not round in our favour.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const FIVE_BEATS = ["Problem", "Solution", "Product", "Demonstration", "Future vision"] as const;
const REQUIRED_DOCS = [
  "DEPLOYMENT.md", "SETUP.md", ".env.example", "LICENSE", "SECURITY.md", "ARCHITECTURE.md",
] as const;

/** Paths whose change should be reflected in the build log. */
const LOGGED_PATHS = ["contracts/", "packages/", "apps/", "scripts/"] as const;

type State = "met" | "not-met" | "unmeetable";

interface Item {
  readonly n: number;
  readonly text: string;
  readonly state: State;
  readonly detail: string;
}

function git(...args: readonly string[]): string {
  return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" }).trim();
}

function read(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), "utf8");
}

function runs(script: string): boolean {
  try {
    execFileSync("pnpm", ["-s", script], { cwd: REPO_ROOT, stdio: "ignore", timeout: 600_000 });
    return true;
  } catch {
    // Not swallowed: a non-zero exit is the answer, and the caller reports it.
    return false;
  }
}

function declaration(): Record<string, unknown> {
  return JSON.parse(read("submission.json")) as Record<string, unknown>;
}

/** Commits touching logged paths since a file was last updated. */
function commitsUnlogged(file: string): readonly string[] {
  const last = git("log", "-1", "--format=%H", "--", file);
  if (last === "") return ["never committed"];
  const out = git("log", "--format=%h %s", `${last}..HEAD`, "--", ...LOGGED_PATHS);
  return out === "" ? [] : out.split("\n");
}

function main(): void {
  const decl = declaration();
  const demo = decl["demo"] as { beat4NobodyWasPaidStatement: string | null } | undefined;
  const items: Item[] = [];

  /* 1 ---------------------------------------------------------------- */
  // §22's gates. G5 was cut and G6 was never attempted, both recorded, so this
  // item cannot be met however the rest go. Named individually rather than
  // summarised, because "gates pass" with two cut underneath it is the summary
  // that would mislead.
  const g12 = runs("submission:check");
  items.push({
    n: 1, text: "Every gate in §22 passes on a fresh clone",
    state: "not-met",
    detail: `G5 cut under K10, G6 not attempted, G9 no testers, G12 ${g12 ? "passes" : "outstanding"}`,
  });

  /* 2 ---------------------------------------------------------------- */
  const claims = runs("claim:verify");
  items.push({
    n: 2, text: "Every claim states a reachable rung, claim:verify exits zero",
    state: claims ? "met" : "not-met",
    detail: claims ? "pnpm claim:verify exits 0" : "pnpm claim:verify exits non-zero",
  });

  /* 3 ---------------------------------------------------------------- */
  // A payout needs settlement code, and none is deployed. This is the item that
  // must never be reported as partly done: two of three is not this checkbox.
  items.push({
    n: 3, text: "A live sample, a real breach, and a real payout, all re-derivable",
    state: "unmeetable",
    detail: "sample and breach are on chain and re-derive; no deployed code can perform a payout (K10, D-021)",
  });

  /* 4 ---------------------------------------------------------------- */
  const reports = existsSync(join(REPO_ROOT, "evidence"))
    ? readdirSync(join(REPO_ROOT, "evidence")).filter((f) => f.endsWith(".txt"))
    : [];
  const withNotSampled = reports.filter((f) =>
    /^\s*NOT_SAMPLED\s+\d+\s*$/mu.test(read(join("evidence", f))));
  items.push({
    n: 4, text: "Campaign totals published with NOT_SAMPLED on its own line",
    state: withNotSampled.length > 0 ? "met" : "not-met",
    detail: withNotSampled.length > 0
      ? `${withNotSampled.join(", ")} in evidence/`
      : "no report in evidence/ carries a NOT_SAMPLED line",
  });

  /* 5 ---------------------------------------------------------------- */
  const testers = decl["userTesting"] as { testers?: unknown[] } | undefined;
  const count = Array.isArray(testers?.testers) ? testers.testers.length : 0;
  items.push({
    n: 5, text: "Three strangers completed the core action unaided",
    state: count >= 3 ? "met" : "not-met",
    detail: `${count} recorded in submission.json (userTesting.testers); G9 needs 3`,
  });

  /* 6 ---------------------------------------------------------------- */
  const readme = read("README.md");
  const beatsInOrder = (() => {
    const at = FIVE_BEATS.map((b) => readme.search(new RegExp(`^##\\s+${b}\\s*$`, "mu")));
    return at.every((p) => p >= 0) && at.every((p, i) => i === 0 || p > at[i - 1]!);
  })();
  const limitations = /^## Limitations$/mu.test(readme)
    && (readme.split(/^## Limitations$/mu)[1] ?? "").split(/^## /mu)[0]!.split("\n")
      .filter((l) => l.trim().startsWith("-")).length >= 3;
  items.push({
    n: 6, text: "README opens with the five beats, limitations section is specific",
    state: beatsInOrder && limitations ? "met" : "not-met",
    detail: `beats ${beatsInOrder ? "in order" : "missing or out of order"}, limitations ${limitations ? "itemised" : "thin or absent"}`,
  });

  /* 7 ---------------------------------------------------------------- */
  const missing = REQUIRED_DOCS.filter((f) => {
    const p = join(REPO_ROOT, f);
    return !existsSync(p) || statSync(p).size === 0;
  });
  items.push({
    n: 7, text: "DEPLOYMENT, SETUP, .env.example, LICENSE, SECURITY, ARCHITECTURE present",
    state: missing.length === 0 ? "met" : "not-met",
    detail: missing.length === 0 ? `all ${REQUIRED_DOCS.length} present and non-empty` : `missing: ${missing.join(", ")}`,
  });

  /* 8 ---------------------------------------------------------------- */
  const video = decl["videoUrl"];
  const beat4 = demo?.beat4NobodyWasPaidStatement ?? null;
  items.push({
    n: 8, text: "Demo video recorded, 2 to 3 minutes, to the five beats",
    state: typeof video === "string" && video.length > 0 ? "met" : "not-met",
    detail: typeof video === "string" && video.length > 0
      ? String(video)
      : `submission.json: videoUrl is null (script written; beat 4 wording ${beat4 === null ? "not set" : "set"})`,
  });

  /* 9 ---------------------------------------------------------------- */
  const filed = decl["feedbackFiledAt"];
  const findings = (read("FEEDBACK.md").match(/^##\s+\d+\./gmu) ?? []).length;
  items.push({
    n: 9, text: "SDK and documentation feedback report filed",
    state: typeof filed === "string" && filed.length > 0 ? "met" : "not-met",
    detail: typeof filed === "string" && filed.length > 0
      ? String(filed)
      : `FEEDBACK.md has ${findings} findings and is linked from the README; filing is owner-held`,
  });

  /* 10 --------------------------------------------------------------- */
  // The item that drifted twice. A commit touching contracts, packages, apps or
  // scripts is work a reader of the log should be able to find.
  const unloggedBuild = commitsUnlogged("BUILD_LOG.md");
  const unloggedDecisions = commitsUnlogged("DECISIONS.md");
  const logsCurrent = unloggedBuild.length === 0;
  items.push({
    n: 10, text: "DECISIONS.md and BUILD_LOG.md current, every cut recorded",
    state: logsCurrent ? "met" : "not-met",
    detail: logsCurrent
      ? `BUILD_LOG current; DECISIONS at ${(read("DECISIONS.md").match(/^## (D-\d+)/gmu) ?? []).slice(-1)[0] ?? "none"}, ${unloggedDecisions.length} commit(s) since`
      : `${unloggedBuild.length} commit(s) touching source since BUILD_LOG was updated.\n        ${unloggedBuild.join("\n        ")}`,
  });

  /* 11 --------------------------------------------------------------- */
  const hygiene = ["check:vocabulary", "check:no-address-literals", "check:paths"] as const;
  const failed = hygiene.filter((h) => !runs(h));
  items.push({
    n: 11, text: "No forbidden vocabulary, no address literal in source, no mainnet",
    state: failed.length === 0 ? "met" : "not-met",
    detail: failed.length === 0 ? hygiene.join(", ") + " all pass" : `failing: ${failed.join(", ")}`,
  });

  /* report ------------------------------------------------------------ */
  const mark = (s: State): string => (s === "met" ? "[x]" : s === "unmeetable" ? "[-]" : "[ ]");
  process.stdout.write("\npnpm check:done — PRD §28, Definition of Done\n");
  process.stdout.write("=".repeat(78) + "\n\n");
  for (const item of items) {
    process.stdout.write(`  ${mark(item.state)} ${item.n}. ${item.text}\n`);
    process.stdout.write(`        ${item.detail}\n\n`);
  }

  const met = items.filter((i) => i.state === "met").length;
  const unmeetable = items.filter((i) => i.state === "unmeetable");
  process.stdout.write("-".repeat(78) + "\n");
  process.stdout.write(`  ${met} of ${items.length} met.\n`);
  if (unmeetable.length > 0) {
    process.stdout.write(`  ${unmeetable.length} cannot be met by this build, counted as not met.\n`);
    for (const i of unmeetable) process.stdout.write(`    ${i.n}. ${i.text}\n`);
  }
  const remaining = items.filter((i) => i.state === "not-met");
  if (remaining.length > 0) {
    process.stdout.write(`  ${remaining.length} outstanding: ${remaining.map((i) => i.n).join(", ")}\n`);
  }
  process.stdout.write("\n");
  process.exit(met === items.length ? 0 : 1);
}

main();
