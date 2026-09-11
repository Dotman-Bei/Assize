/**
 * `pnpm submission:check` — the gate command PRD §22 names for G12.
 *
 * G12 asks for a submission package: the app live on testnet, the repository
 * public with `DEPLOYMENT.md` and `LICENSE`, a video recorded to the five beats,
 * and the feedback report filed. Half of that is in the repository and half is
 * held by the owner, and the two halves fail differently. A missing file is a
 * bug; an unrecorded video is unfinished work. Both stop a submission, so both
 * exit non-zero here, but they are reported apart so the remaining work is
 * legible rather than a wall of red.
 *
 * The rule this follows is PRD §21's: a claim may not outrun its evidence. So a
 * declaration in `submission.json` is never taken at its word. A URL written
 * there is fetched. A repository said to be public is asked, unauthenticated,
 * whether it is. A commit said to be pushed is compared against the tip the
 * remote actually serves. The file says where to look, not what is true.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** PRD §23, in the official order. The README and the video both follow it. */
const FIVE_BEATS = ["Problem", "Solution", "Product", "Demonstration", "Future vision"] as const;

/** PRD §24, plus the documents AGENTS.md requires a reader to be able to find. */
const REQUIRED_FILES = [
  "README.md",
  "SETUP.md",
  "LICENSE",
  "DEPLOYMENT.md",
  ".env.example",
  "SECURITY.md",
  "ARCHITECTURE.md",
  "FEEDBACK.md",
  "WHAT_IS_MEASURED.md",
] as const;

type State = "pass" | "fail" | "outstanding";

interface Check {
  readonly name: string;
  readonly state: State;
  readonly lines: readonly string[];
}

interface Declaration {
  readonly repository: string | null;
  readonly liveAppUrl: string | null;
  readonly videoUrl: string | null;
  readonly feedbackFiledAt: string | null;
  readonly demo: { readonly beat4LimitationStatement: string | null };
}

interface Deployment {
  readonly contracts: Record<string, string>;
}

function git(...args: readonly string[]): string {
  return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" }).trim();
}

function read(relative: string): string {
  return readFileSync(join(REPO_ROOT, relative), "utf8");
}

function deployment(): Deployment {
  const dir = join(REPO_ROOT, "deployments");
  const file = readdirSync(dir).find((f) => f.endsWith(".json"));
  if (file === undefined) throw new Error("no deployment record in deployments/");
  return JSON.parse(readFileSync(join(dir, file), "utf8")) as Deployment;
}

/** A fetch that gives up rather than hanging a gate. */
async function reach(url: string): Promise<{ readonly ok: boolean; readonly status: number; readonly body: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => { controller.abort(); }, 20_000);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: "follow" });
    const body = response.ok ? (await response.text()).slice(0, 200_000) : "";
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    // Not swallowed: the reason is carried out as a status of zero plus the
    // message, so an unreachable URL and a 404 are told apart in the report.
    return { ok: false, status: 0, body: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

/* ---------------------------------------------------------------------- *
 * The repository half
 * ---------------------------------------------------------------------- */

function checkFilesPresent(): Check {
  const missing: string[] = [];
  const empty: string[] = [];
  for (const file of REQUIRED_FILES) {
    const path = join(REPO_ROOT, file);
    if (!existsSync(path)) missing.push(file);
    else if (statSync(path).size === 0) empty.push(file);
  }
  if (missing.length > 0 || empty.length > 0) {
    return {
      name: "required files (PRD §24)",
      state: "fail",
      lines: [
        ...missing.map((f) => `${f} is missing`),
        ...empty.map((f) => `${f} is present but empty`),
      ],
    };
  }
  return {
    name: "required files (PRD §24)",
    state: "pass",
    lines: [`all ${REQUIRED_FILES.length} present and non-empty`],
  };
}

function checkReadmeBeats(): Check {
  const readme = read("README.md");
  const positions = FIVE_BEATS.map((beat) => ({
    beat,
    at: readme.search(new RegExp(`^##\\s+${beat}\\s*$`, "mu")),
  }));

  const absent = positions.filter((p) => p.at < 0).map((p) => p.beat);
  if (absent.length > 0) {
    return {
      name: "README opens with the five beats (PRD §23)",
      state: "fail",
      lines: [`no heading for: ${absent.join(", ")}`],
    };
  }

  const outOfOrder = positions.slice(1).some((p, i) => p.at < positions[i]!.at);
  if (outOfOrder) {
    const order = [...positions].sort((a, b) => a.at - b.at).map((p) => p.beat);
    return {
      name: "README opens with the five beats (PRD §23)",
      state: "fail",
      lines: [`the beats appear as ${order.join(" -> ")}, not in the official order`],
    };
  }
  return {
    name: "README opens with the five beats (PRD §23)",
    state: "pass",
    lines: [FIVE_BEATS.join(" -> ")],
  };
}

/**
 * The published addresses and the deployment record must agree.
 * @remarks This is the check that catches a redeploy: the contracts move, the
 * record is rewritten, and `DEPLOYMENT.md` keeps pointing judges at a dead
 * address. Both halves are read from the repository, so this holds without a
 * network. Whether the address is live on chain is `pnpm verify:testnet`'s
 * question, not this one.
 */
function checkDeploymentDocument(): Check {
  const doc = read("DEPLOYMENT.md").toLowerCase();
  const contracts = Object.entries(deployment().contracts);
  const absent = contracts.filter(([, address]) => !doc.includes(address.toLowerCase()));
  if (absent.length > 0) {
    return {
      name: "DEPLOYMENT.md matches deployments/ (PRD §24)",
      state: "fail",
      lines: absent.map(([name, address]) => `${name} ${address} is in the record but not in DEPLOYMENT.md`),
    };
  }
  return {
    name: "DEPLOYMENT.md matches deployments/ (PRD §24)",
    state: "pass",
    lines: contracts.map(([name, address]) => `${name} ${address}`),
  };
}

/** Nothing uncommitted, because the submission is what the repository holds. */
function checkWorkingTreeClean(): Check {
  const dirty = git("status", "--porcelain");
  if (dirty.length > 0) {
    return {
      name: "working tree is clean",
      state: "fail",
      lines: ["uncommitted changes would not reach a judge:", ...dirty.split("\n").map((l) => `  ${l}`)],
    };
  }
  return { name: "working tree is clean", state: "pass", lines: ["nothing uncommitted"] };
}

/* ---------------------------------------------------------------------- *
 * The owner-held half
 * ---------------------------------------------------------------------- */

function repositorySlug(url: string): string | null {
  const match = /github\.com[/:]([^/]+)\/([^/.]+)/u.exec(url);
  return match === null ? null : `${match[1]}/${match[2]}`;
}

async function checkRepositoryPublic(declared: string | null): Promise<Check> {
  const name = "repository is public (PRD §24)";
  if (declared === null) {
    return { name, state: "outstanding", lines: ["submission.json: repository is null"] };
  }
  const slug = repositorySlug(declared);
  if (slug === null) {
    return { name, state: "fail", lines: [`${declared} is not a GitHub repository URL`] };
  }
  // Unauthenticated on purpose: this asks the question a judge's browser asks.
  const response = await reach(`https://api.github.com/repos/${slug}`);
  if (!response.ok) {
    return {
      name,
      state: "outstanding",
      lines: [
        response.status === 404
          ? `${slug} is not readable without credentials — private, or it does not exist`
          : `could not reach GitHub for ${slug} (${response.status || response.body})`,
      ],
    };
  }
  const meta = JSON.parse(response.body) as { private: boolean; license: { spdx_id: string } | null };
  const lines = [`${slug} is public`];
  if (meta.license === null) {
    return { name, state: "fail", lines: [...lines, "but GitHub detects no LICENSE"] };
  }
  lines.push(`LICENSE detected as ${meta.license.spdx_id}`);
  return { name, state: meta.private ? "outstanding" : "pass", lines };
}

/**
 * Every local commit is on the remote.
 * @remarks A submission is judged from the public repository, so work that is
 * committed but unpushed is work that does not exist for the judge.
 */
async function checkEverythingIsPushed(declared: string | null): Promise<Check> {
  const name = "local commits are all pushed";
  const slug = declared === null ? null : repositorySlug(declared);
  if (slug === null) {
    return { name, state: "outstanding", lines: ["no repository declared to compare against"] };
  }
  const head = git("rev-parse", "HEAD");
  const branch = git("rev-parse", "--abbrev-ref", "HEAD");
  const response = await reach(`https://api.github.com/repos/${slug}/commits/${branch}`);
  if (!response.ok) {
    return {
      name,
      state: "outstanding",
      lines: [`could not read ${slug}@${branch} from GitHub (${response.status || response.body})`],
    };
  }
  const tip = (JSON.parse(response.body) as { sha: string }).sha;
  if (tip === head) {
    return { name, state: "pass", lines: [`${branch} on GitHub is at ${head.slice(0, 9)}, the local tip`] };
  }
  let ahead = "";
  try {
    ahead = git("rev-list", "--count", `${tip}..HEAD`);
  } catch {
    // The remote tip is not an object we hold, which means the remote carries
    // commits this clone has never fetched. Reported rather than guessed at.
    return {
      name,
      state: "outstanding",
      lines: [`GitHub serves ${tip.slice(0, 9)} for ${branch}, which is not in this clone — fetch before comparing`],
    };
  }
  return {
    name,
    state: "outstanding",
    lines: [
      `GitHub serves ${tip.slice(0, 9)} for ${branch}; the local tip is ${head.slice(0, 9)}`,
      `${ahead} local commit(s) are not on the remote — git push origin ${branch}`,
    ],
  };
}

async function checkLiveApp(url: string | null): Promise<Check> {
  const name = "app is live on a public URL (PRD §24, G7)";
  if (url === null) {
    return {
      name,
      state: "outstanding",
      lines: [
        "submission.json: liveAppUrl is null",
        "dist/assize.html is a single self-contained file and needs only static hosting",
      ],
    };
  }
  const response = await reach(url);
  if (!response.ok) {
    return { name, state: "fail", lines: [`${url} answered ${response.status || response.body}`] };
  }
  // A 200 from a parked domain is still a 200. The page must be ours.
  if (!/assize/iu.test(response.body)) {
    return { name, state: "fail", lines: [`${url} answered 200 but the page does not mention Assize`] };
  }
  return { name, state: "pass", lines: [`${url} answered 200 and serves the app`] };
}

async function checkVideo(url: string | null): Promise<Check> {
  const name = "demo video recorded (PRD §23)";
  if (url === null) {
    return { name, state: "outstanding", lines: ["submission.json: videoUrl is null — 2 to 3 minutes, five beats"] };
  }
  const response = await reach(url);
  return response.ok
    ? { name, state: "pass", lines: [`${url} answered 200`] }
    : { name, state: "fail", lines: [`${url} answered ${response.status || response.body}`] };
}

/**
 * Beat 4 must state the limitation that survives settlement being real.
 *
 * @remarks This check used to require the opposite. Settlement was cut under
 * §26 K10, so beat 4 could not be performed as §23 writes it, and the video was
 * required to say out loud that nobody was paid. That is no longer true: P3
 * shipped, a witnessed trader claimed a forfeited bond in full, and the
 * transaction is on chain (D-047). A gate still demanding "nobody was paid"
 * would now be enforcing a false statement, which is worse than enforcing none.
 *
 * What replaces it is the limitation §23 beat 4 actually names, and it is the
 * one a viewer is most likely to get wrong: **payouts reach witnessed traders
 * only.** The registry can pay an address only if it saw that address fill
 * inside the window, learned from the pool's own logs. Someone who held the
 * position and lost money but never traded during the window is owed nothing
 * here. A demo that implies otherwise oversells the instrument in the place an
 * audience can least check it.
 */
function checkBeatFourHonesty(statement: string | null): Check {
  const name = "beat 4 states who a payout can reach (PRD §23)";
  if (statement === null) {
    return {
      name,
      state: "outstanding",
      lines: [
        "submission.json: demo.beat4LimitationStatement is null",
        "settlement is live, so the video must say out loud that only witnessed traders can be paid",
      ],
    };
  }
  // A heuristic, and named as one. It cannot judge whether a sentence is true,
  // only that the declaration is on the subject: it must be about payment, and
  // it must scope who a payment reaches. That rejects a beat 4 note which never
  // mentions the limit, and accepts the several honest ways of stating it.
  const aboutPayment = /\b(?:paid|pay|payout|payouts|payment|settle|settled|settlement|claim|claimed|claims|bond)\b/iu
    .test(statement);
  const scopesWho = /\b(?:witness|witnessed|only|nobody|no one|none|traded|trading|filled|fill)\b/iu
    .test(statement);
  const saysNobodyPaid = aboutPayment && scopesWho;
  if (!saysNobodyPaid) {
    return {
      name,
      state: "fail",
      lines: [
        `the declared statement does not scope who a payout reaches: ${JSON.stringify(statement)}`,
        "it must be unambiguous, because a viewer cannot check it against chain",
      ],
    };
  }
  return { name, state: "pass", lines: [JSON.stringify(statement)] };
}

function checkFeedbackFiled(where: string | null): Check {
  const name = "feedback report filed (PRD §20)";
  const findings = (read("FEEDBACK.md").match(/^##\s/gmu) ?? []).length;
  if (where === null) {
    return {
      name,
      state: "outstanding",
      lines: [
        "submission.json: feedbackFiledAt is null",
        `FEEDBACK.md is written (${findings} sections) but filing it with the organisers is owner-held`,
      ],
    };
  }
  return { name, state: "pass", lines: [`filed at ${where}`, `FEEDBACK.md carries ${findings} sections`] };
}

/* ---------------------------------------------------------------------- *
 * Report
 * ---------------------------------------------------------------------- */

async function main(): Promise<void> {
  const declaration = JSON.parse(read("submission.json")) as Declaration;

  const inRepository: readonly Check[] = [
    checkFilesPresent(),
    checkReadmeBeats(),
    checkDeploymentDocument(),
    checkWorkingTreeClean(),
  ];
  const ownerHeld: readonly Check[] = [
    await checkRepositoryPublic(declaration.repository),
    await checkEverythingIsPushed(declaration.repository),
    await checkLiveApp(declaration.liveAppUrl),
    await checkVideo(declaration.videoUrl),
    checkBeatFourHonesty(declaration.demo.beat4LimitationStatement),
    checkFeedbackFiled(declaration.feedbackFiledAt),
  ];

  const mark = (state: State): string =>
    state === "pass" ? "[PASS       ]" : state === "fail" ? "[FAIL       ]" : "[OUTSTANDING]";

  const section = (title: string, checks: readonly Check[]): void => {
    process.stdout.write(`\n${title}\n${"-".repeat(title.length)}\n`);
    for (const check of checks) {
      process.stdout.write(`  ${mark(check.state)} ${check.name}\n`);
      for (const line of check.lines) process.stdout.write(`      ${line}\n`);
    }
  };

  process.stdout.write("\nsubmission:check — G12, PRD §24\n");
  section("in the repository", inRepository);
  section("owner-held", ownerHeld);

  const all = [...inRepository, ...ownerHeld];
  const failed = all.filter((c) => c.state === "fail");
  const outstanding = all.filter((c) => c.state === "outstanding");

  process.stdout.write("\n");
  if (failed.length === 0 && outstanding.length === 0) {
    process.stdout.write("G12 PASSED: the submission package is complete.\n");
    process.exit(0);
  }
  if (failed.length > 0) {
    process.stdout.write(`${failed.length} check(s) FAILED, something in the repository is wrong.\n`);
    for (const check of failed) process.stdout.write(`  - ${check.name}\n`);
  }
  if (outstanding.length > 0) {
    process.stdout.write(`${outstanding.length} check(s) OUTSTANDING, owner-held work not yet done.\n`);
    for (const check of outstanding) process.stdout.write(`  - ${check.name}\n`);
  }
  process.stdout.write("\nG12 does not pass. PRD §24: nothing is submitted before G12 passes.\n");
  process.exit(1);
}

await main();
