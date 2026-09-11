/**
 * Assize web surface. Layout, tokens and copy come from frontend.md, the
 * Midday.ai minimal dark monochromatic system. Nothing visual is invented; where
 * the document is silent, DECISIONS.md D-029 and D-030 record the reading taken.
 *
 * No server and no database sit behind this page. It reads the chain through a
 * public RPC, which is the product's own claim applied to its interface.
 * PRD §17: no address is compiled in; the deployment record arrives at runtime.
 */
import { createPublicClient, http, formatEther, parseEther, encodeFunctionData, custom, createWalletClient } from "viem";
import { verdict as evaluate } from "@assize/reference";
import { VERDICT_STATES, sampleSourceFromCode } from "@assize/protocol-types";
import { icon } from "./icons.js";

const abi = [
  { type: "function", name: "sampleCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "breachCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "commitmentCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "verdictOf", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "uint8" }] },
  { type: "function", name: "breachAt", stateMutability: "view", inputs: [{ type: "uint256" }],
    outputs: [{ type: "tuple", components: [{ name: "commitmentId", type: "uint256" }, { name: "sampleId", type: "uint256" }] }] },
  { type: "function", name: "sampleAt", stateMutability: "view", inputs: [{ type: "uint256" }],
    outputs: [{ type: "tuple", components: [{ name: "commitmentId", type: "uint256" },
      { name: "sample", type: "tuple", components: [
        { name: "bid", type: "uint128" }, { name: "ask", type: "uint128" },
        { name: "bidSize", type: "uint128" }, { name: "askSize", type: "uint128" },
        { name: "blockNumber", type: "uint64" }, { name: "blockHash", type: "bytes32" },
        { name: "source", type: "uint8" }] }] }] },
  { type: "function", name: "commitmentAt", stateMutability: "view", inputs: [{ type: "uint256" }],
    outputs: [{ type: "tuple", components: [
      { name: "maker", type: "address" }, { name: "marketId", type: "bytes32" },
      { name: "maxSpread", type: "uint128" }, { name: "minSize", type: "uint128" },
      { name: "start", type: "uint64" }, { name: "end", type: "uint64" },
      { name: "bond", type: "uint256" }, { name: "forfeitedAtBreachIdPlusOne", type: "uint256" }] }] },
  { type: "function", name: "publishCommitment", stateMutability: "payable",
    inputs: [{ name: "marketId", type: "bytes32" }, { name: "maxSpread", type: "uint128" },
             { name: "minSize", type: "uint128" }, { name: "start", type: "uint64" }, { name: "end", type: "uint64" }],
    outputs: [{ type: "uint256" }] },
];

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const cut = (h, a = 8, b = 6) => `${h.slice(0, a)}…${h.slice(-b)}`;
const esc = (v) => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
const pill = (s) => `<span class="pill p-${s}"><span class="d"></span>${s}</span>`;
const src = (s) => `<span class="src src-${s}">${s}</span>`;
const bps = (raw, one) => (one > 0n ? (raw * 10_000n) / one : 0n);
const num = (v) => Number(v).toLocaleString();

const S = { one: 1_000_000n, commitments: [], samples: [], filter: "all", q: "", bq: "", account: null, step: 0 };

/* frontend.md §3 Page 1 Section 4: the five steps, verbatim, with what each
   does and does not do. The second half is ours: PRD §21 forbids a claim that
   outruns its evidence, and step 5 does not exist in this deployment. */
const LIFECYCLE = [
  ["Commitment + bond", "escrowed in the registry", true],
  ["Book event", "on a DreamDEX event contract", true],
  ["Reactive sample", "written by Somnia validators", true],
  ["Deterministic verdict", "computed from stored data alone", true],
  ["Settlement", "pro-rata to witnessed traders", true],
];

async function boot() {
  const record = globalThis.__ASSIZE_DEPLOYMENT__ ?? await (await fetch("./deployment.json")).json();
  S.cfg = record;
  S.rpc = new URLSearchParams(location.search).get("rpc") ?? record.rpcUrl;
  S.client = createPublicClient({ transport: http(S.rpc) });
  S.registry = record.contracts.AssizeRegistry;
  S.subscriber = record.contracts.CoverageSubscriber;
  S.explorer = "https://shannon-explorer.somnia.network";
  $("#footExplorer").href = S.explorer;
  $("#footRegistry").href = `${S.explorer}/address/${S.registry}`;
  $("#footSubscriber").href = `${S.explorer}/address/${S.subscriber}`;

  wire();
  paintIcons();
  wireReveal();
  renderLifecycle();
  renderBoundaries();
  renderCliDocs();
  route();
  await Promise.all([loadChain(), loadHealth()]);
}

/** Fills every `data-icon` placeholder with its Lucide glyph. */
function paintIcons() {
  for (const node of $$("[data-icon]")) {
    if (node.dataset.painted === "1") continue;
    try {
      node.innerHTML = icon(node.dataset.icon, node.classList.contains("arrow") ? 13 : 16);
      node.dataset.painted = "1";
    } catch (error) {
      // A missing glyph is a defect worth seeing in the console, but it must not
      // take the page down with it: everything below reads the chain.
      console.error(`icon "${node.dataset.icon}" did not render:`, error.message);
    }
  }
}

function wire() {
  document.addEventListener("click", async (e) => {
    const nav = e.target.closest("[data-nav]");
    if (nav) { location.hash = `#${nav.dataset.nav}`; return; }
    const c = e.target.closest(".copy");
    if (c) { await navigator.clipboard.writeText(c.dataset.copy); const t = c.textContent; c.textContent = "copied"; setTimeout(() => { c.textContent = t; }, 1200); return; }
    const chip = e.target.closest(".chip");
    if (chip) { S.filter = chip.dataset.f; $$(".chip").forEach((x) => x.setAttribute("aria-pressed", String(x === chip))); renderMarkets(); return; }
    const step = e.target.closest(".stepcard");
    if (step) { S.step = Number(step.dataset.step); renderLifecycle(); return; }
    if (e.target.closest(".drawer-scrim") || e.target.closest("[data-close]")) { $("#overlay").innerHTML = ""; }
  });
  $("#marketSearch").addEventListener("input", (e) => { S.q = e.target.value.trim().toLowerCase(); renderMarkets(); });
  $("#breachSearch").addEventListener("input", (e) => { S.bq = e.target.value.trim().toLowerCase(); renderBreaches(); });
  $("#wallet").addEventListener("click", connect);
  $("#verifyRun").addEventListener("click", runVerifier);
  window.addEventListener("hashchange", route);
}

function route() {
  const path = (location.hash || "#/").slice(1) || "/";
  const known = ["/", "/markets", "/publish", "/breaches", "/claim", "/verify"];
  const target = known.includes(path) ? path : "/";
  $$("[data-page]").forEach((p) => p.classList.toggle("hidden", p.dataset.page !== target));
  $$("nav.tabs a").forEach((a) => a.setAttribute("aria-current", a.dataset.route === target ? "page" : "false"));
  // The wallet control is hidden on Overview only. Overview reads the chain and
  // asks nothing of the visitor; every other route either signs a transaction or
  // reports against a connected address, so the control belongs there.
  $("#wallet").classList.toggle("hidden", target === "/");
  window.scrollTo({ top: 0 });
  if (target === "/publish") renderPublish();
  if (target === "/claim") renderClaim();
}

/**
 * Cursor-tracked reveal on the wordmark.
 *
 * The mask centre eases toward the pointer rather than snapping to it, which is
 * what a spring library would give for free; here it is a short lerp on
 * requestAnimationFrame, running only while the pointer is over the element.
 * frontend.md §1 asks for "zero drop shadow or blur elevation", so the effect is
 * carried entirely by stroke weight and colour, both of which are §1 tokens.
 */
function wireReveal() {
  const host = $("#reveal");
  const grad = host?.querySelector("#revealMask");
  if (!host || !grad) return;

  const svg = host.querySelector("svg");
  let target = { x: 150, y: 50 }, at = { x: 150, y: 50 }, raf = null;

  const step = () => {
    at.x += (target.x - at.x) * 0.18;
    at.y += (target.y - at.y) * 0.18;
    grad.setAttribute("cx", at.x.toFixed(2));
    grad.setAttribute("cy", at.y.toFixed(2));
    raf = Math.abs(target.x - at.x) > 0.1 || Math.abs(target.y - at.y) > 0.1
      ? requestAnimationFrame(step) : null;
  };
  const move = (e) => {
    const box = svg.getBoundingClientRect();
    // The viewBox is 300x100; the pointer arrives in CSS pixels.
    target = {
      x: ((e.clientX - box.left) / box.width) * 300,
      y: ((e.clientY - box.top) / box.height) * 100,
    };
    if (raf === null) raf = requestAnimationFrame(step);
  };
  host.addEventListener("pointermove", move);
  host.addEventListener("pointerleave", () => {
    target = { x: 150, y: 50 };
    if (raf === null) raf = requestAnimationFrame(step);
  });

  // Draw the wordmark once, when it first comes into view.
  if (typeof IntersectionObserver === "function") {
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) { host.classList.add("on"); io.disconnect(); }
      }
    }, { threshold: 0.35 });
    io.observe(host);
  } else {
    host.classList.add("on");
  }
}

async function loadHealth() {
  try {
    const id = await S.client.getChainId();
    const balance = await S.client.getBalance({ address: S.subscriber });
    const floor = BigInt(S.cfg.measurement.handlerGasLimit ?? 0) * 6n * 10n ** 9n;
    S.prefund = { balance, floor, firings: floor > 0n ? balance / floor : 0n };
    $("#health").textContent = `Live on Shannon · ${id}`;
    const verified = $("#footVerified");
    if (verified) verified.textContent = `verified on Somnia Shannon · chain ${id}`;
  } catch {
    $("#health").textContent = "Shannon unreachable";
    const verified = $("#footVerified");
    // Never claim verification against a chain that could not be reached.
    if (verified) verified.textContent = "Shannon unreachable, nothing verified this load";
  }
}

async function loadChain() {
  const read = (fn, args) => S.client.readContract({ address: S.registry, abi, functionName: fn, args });
  const [count, total, breaches] = await Promise.all([read("commitmentCount"), read("sampleCount"), read("breachCount")]);
  S.total = total; S.breaches = breaches;
  S.commitments = [];
  for (let i = 0n; i < count; i += 1n) S.commitments.push({ id: i, ...(await read("commitmentAt", [i])) });

  const take = 60n, from = total > take ? total - take : 0n;
  const ids = []; for (let i = total - 1n; i >= from && i >= 0n; i -= 1n) ids.push(i);
  S.samples = await Promise.all(ids.map(async (id) => {
    const [rec, v] = await Promise.all([read("sampleAt", [id]), read("verdictOf", [id])]);
    return { id, ...rec, state: VERDICT_STATES[Number(v)] };
  }));
  for (const c of S.commitments) c.last = S.samples.find((s) => s.commitmentId === c.id) ?? null;
  S.head = await S.client.getBlockNumber();

  renderTelemetry();
  renderMarkets();
  renderMarketDetail(S.commitments[0]);
  renderBreaches();
  renderTeaser();
}

/* ── Page 1 §2: live protocol telemetry bento ─────────────────────────────── */
function renderTelemetry() {
  const bonded = S.commitments.reduce((a, c) => a + c.bond, 0n);
  const forfeited = S.commitments.filter((c) => c.forfeitedAtBreachIdPlusOne > 0n).reduce((a, c) => a + c.bond, 0n);
  const reactivity = S.samples.filter((s) => Number(s.sample.source) === 1).length;
  const pct = S.samples.length ? Math.round((reactivity / S.samples.length) * 100) : 0;
  const blocks = new Set(S.samples.map((s) => String(s.sample.blockNumber))).size;
  const box = (label, value, foot) => `<div class="stat-cell"><div class="stat-label">${label}</div>
    <div class="stat-value">${value}</div><div class="stat-foot">${foot}</div></div>`;
  $("#telemetry").innerHTML =
    box("Total value bonded", `${formatEther(bonded)} STT`, `${S.commitments.length} commitment(s) on chain`)
    + box("Monitored order books", String(S.commitments.length), "DreamDEX event contract markets")
    + box("Samples evaluated", num(S.total), `${pct}% reactivity · ${100 - pct}% keeper · ${blocks} distinct blocks in view`)
    + box("Breaches recorded", num(S.breaches), `${formatEther(forfeited)} STT forfeited · 0 STT distributed`);
}

function renderLifecycle() {
  $("#lifecycle").innerHTML = LIFECYCLE.map(([label, qualifier, live]) => `
    <div class="how-cell">
      <div class="how-label${live ? "" : " off"}">${label}</div>
      <div class="how-qualifier">${qualifier}</div>
    </div>`).join("");
  // The fifth step is the one that needs saying out loud rather than implying.
  // It said the opposite until 2026-09-11: settlement was cut under K10, and this
  // panel told every visitor that no trader could be paid. That was true of the
  // deployment it was written against and false of this one, which is the kind
  // of sentence that has to change in the same commit as the code it describes.
  $("#lifecycleDetail").innerHTML = `<div class="note" style="margin-top:var(--s-3)">
    <strong>Settlement is deployed, and one bond has been paid out.</strong> A trader who took
    liquidity while the commitment did not hold claimed the forfeited bond in full. Being witnessed
    is not a claim anyone makes about themselves: it is the join of two pool logs — one naming who
    placed an order, the other naming what that order filled — recorded by the reactivity precompile
    and joined on chain at claim time.</div>`;
}

function renderBoundaries() {
  $("#boundaries").innerHTML = [
    ["Evaluations occur at sampled instants.", "Assize does not promise continuous coverage. A sample is one reading at one block, not a window, not an average, and not proof the book held between two samples."],
    ["Payouts reach witnessed traders only.", "The registry can only pay addresses it saw trading inside the window, and it can only learn that from the pool's own logs. One bond has been paid out this way. A trader who never filled has nothing to claim, however much they lost."],
    ["The sample count is not the observation count.", "The subscription matches every log the pool emits, so a busy block yields several samples of one instant. Distinct blocks is the honest measure and both are shown."],
    ["The maker is ours.", "Labelled PROJECT_BASELINE. Not a third party, not adoption, not demand. It published a commitment it did not keep, which is what it exists to do."],
    ["The block pin is a parent hash.", "A contract cannot observe the hash of the block it runs in, so a sample stores block N with the hash of N−1. A verifier treating it as a block hash rejects every honest sample."],
  ].map(([h, b]) => `<div class="note"><strong>${h}</strong> ${b}</div>`).join("");
}

async function renderTeaser() {
  if (S.breaches === 0n) { $("#teaser").innerHTML = `<span class="muted">No breach recorded yet.</span>`; return; }
  const read = (fn, args) => S.client.readContract({ address: S.registry, abi, functionName: fn, args });
  const b = await read("breachAt", [0n]);
  const rec = await read("sampleAt", [b.sampleId]);
  const state = VERDICT_STATES[Number(await read("verdictOf", [b.sampleId]))];
  const c = S.commitments.find((x) => x.id === b.commitmentId) ?? S.commitments[0];
  const s = rec.sample, spread = s.ask - s.bid;
  const cmd = `pnpm assize verify 0`;
  $("#teaser").innerHTML = `
    <div style="display:flex;justify-content:space-between;gap:var(--s-3);flex-wrap:wrap;align-items:center">
      <div style="display:flex;gap:var(--s-2);align-items:center">${pill(state)}${src(sampleSourceFromCode(Number(s.source)))}</div>
      <span class="mono muted" style="font-size:12px">block ${num(s.blockNumber)}</span>
    </div>
    <div class="term" style="margin-top:var(--s-3)"><pre>observed  bid ${num(s.bid)}  ask ${num(s.ask)}  spread ${num(spread)} raw (${bps(spread, S.one)} bps)
envelope  max spread ${num(c.maxSpread)} raw (${bps(c.maxSpread, S.one)} bps)
pin       ${s.blockHash}
verdict   ${state}</pre></div>
    <div class="term" style="margin-top:var(--s-2)"><button class="copy" data-copy="${esc(cmd)}">copy</button><pre>${esc(cmd)}</pre></div>`;
}

/* ── Page 2A: markets directory ───────────────────────────────────────────── */
function renderMarkets() {
  const rows = S.commitments.filter((c) => {
    if (S.q && !`${c.marketId}${c.maker}`.toLowerCase().includes(S.q)) return false;
    if (S.filter === "covered") return c.last?.state === "COVERED_AT_SAMPLE";
    if (S.filter === "breached") return c.forfeitedAtBreachIdPlusOne > 0n;
    if (S.filter === "uncovered") return !c.last || c.last.state === "NOT_SAMPLED";
    return true;
  });
  if (!rows.length) {
    $("#marketRows").innerHTML = `<tr><td colspan="9"><div class="empty">No active quoting commitments found on current DreamDEX books.</div></td></tr>`;
    return;
  }
  $("#marketRows").innerHTML = rows.map((c) => {
    const remaining = S.head && c.end > S.head ? c.end - S.head : 0n;
    return `<tr class="row" data-nav="/markets">
      <td class="n">${cut(c.marketId, 10, 6)}<div class="muted" style="font-size:11px">DreamDEX event contract</div></td>
      <td class="n">${cut(c.maker)}<div class="muted" style="font-size:11px">PROJECT_BASELINE</div></td>
      <td class="n">${num(c.maxSpread)} <span class="muted">(${bps(c.maxSpread, S.one)} bps)</span></td>
      <td class="n">${num(c.minSize)}</td>
      <td class="n">${formatEther(c.bond)} STT</td>
      <td>${c.last ? pill(c.last.state) : pill("NOT_SAMPLED")}</td>
      <td>${c.last ? src(sampleSourceFromCode(Number(c.last.sample.source))) : "<span class='muted'>n/a</span>"}</td>
      <td class="n">${remaining > 0n ? `${num(remaining)} blocks` : "<span class='muted'>closed</span>"}</td>
      <td><span class="muted">Details →</span></td></tr>`;
  }).join("");
}

/* ── Page 2B: live market coverage terminal ───────────────────────────────── */
function renderMarketDetail(c) {
  if (!c) return;
  const BUDGET = 1000n;
  const f = S.prefund?.firings ?? 0n;
  const pct = Number((f > BUDGET ? BUDGET : f) * 100n / BUDGET);
  const cls = f < BUDGET / 20n ? "crit" : f < BUDGET / 5n ? "low" : "";
  const blocks = new Set(S.samples.map((s) => String(s.sample.blockNumber))).size;
  const hasGap = S.samples.some((s) => s.state === "NOT_SAMPLED");

  // Collapse consecutive samples reading the same book at the same block.
  const instants = [];
  for (const r of S.samples) {
    const key = `${r.sample.blockNumber}:${r.sample.bid}:${r.sample.ask}:${r.sample.bidSize}:${r.sample.askSize}`;
    const prev = instants[instants.length - 1];
    if (prev && prev.key === key) { prev.count += 1; continue; }
    instants.push({ key, count: 1, ...r });
  }

  $("#marketDetail").innerHTML = `
    <h2>Live coverage terminal</h2>
    <p class="h2-sub">Market ${cut(c.marketId, 12, 8)} · DreamDEX event contract</p>
    <div class="grid g2">
      <div class="card">
        <div class="stat-label">Envelope status</div>
        <dl class="kv" style="margin-top:var(--s-3)">
          <dt>MAKER</dt><dd>${cut(c.maker)}</dd>
          <dt>ACTIVE BOND</dt><dd>${formatEther(c.bond)} STT ${c.forfeitedAtBreachIdPlusOne > 0n ? `<span style="color:var(--verdict-spread-breach)">(forfeited)</span>` : ""}</dd>
          <dt>MAX SPREAD</dt><dd>${num(c.maxSpread)} raw · ${bps(c.maxSpread, S.one)} bps</dd>
          <dt>MIN SIZE</dt><dd>${num(c.minSize)} contracts per side</dd>
          <dt>WINDOW</dt><dd>${num(c.start)} → ${num(c.end)}</dd>
        </dl>
      </div>
      <div class="card">
        <div class="stat-label">Handler gas gauge</div>
        <div class="stat-value">${num(f)}</div>
        <div class="stat-foot">projected callbacks remaining before exhaustion</div>
        <div class="gauge ${cls}" style="margin-top:var(--s-3)"><span style="width:${Math.max(2, pct)}%"></span></div>
        <div class="stat-foot">${S.prefund ? `${Number(formatEther(S.prefund.balance)).toFixed(2)} STT prefunded · ${formatEther(S.prefund.floor)} STT reserved per firing. Below one firing's worth the subscription is removed rather than skipped, and sampling stops silently.` : ""}</div>
      </div>
    </div>
    ${hasGap ? `<div class="gap-banner" style="margin-top:var(--s-3)">Sampling occurs at discrete instants. An unrecorded block tick is logged as NOT_SAMPLED rather than smoothed over.</div>` : ""}
    <h2>Live sample inspection ledger</h2>
    <p class="h2-sub">${blocks} distinct blocks across the ${S.samples.length} most recent of ${num(S.total)} samples.
      <strong>×N</strong> counts samples that read the same book at the same block. The subscription
      matches every log the pool emits. Click a row for the stored struct.</p>
    <div class="table-wrap"><div class="scroll"><table>
      <thead><tr><th>Sample</th><th>Block</th><th>Block hash</th><th>Bid / Ask</th><th>Spread</th><th>Size</th><th>Source</th><th>Verdict</th></tr></thead>
      <tbody>${instants.map((r) => {
        const s = r.sample;
        return `<tr class="row" data-sample="${r.id}">
          <td class="n">#${r.id}</td>
          <td class="n">${num(s.blockNumber)}${r.count > 1 ? ` <span class="dupe">×${r.count}</span>` : ""}</td>
          <td class="n muted">${cut(s.blockHash, 8, 6)}</td>
          <td class="n">${num(s.bid)} / ${num(s.ask)}</td>
          <td class="n">${num(s.ask - s.bid)}</td>
          <td class="n">${num(s.bidSize)} / ${num(s.askSize)}</td>
          <td>${src(sampleSourceFromCode(Number(s.source)))}</td>
          <td>${pill(r.state)}</td></tr>`;
      }).join("")}</tbody>
    </table></div></div>`;
  $$("tr[data-sample]").forEach((tr) => tr.addEventListener("click", () => drawer(BigInt(tr.dataset.sample))));
}

/* §3 Page 2B: clicking a row opens a slide-out inspect drawer with raw JSON. */
function drawer(id) {
  const r = S.samples.find((x) => x.id === id);
  if (!r) return;
  const json = JSON.stringify({
    sampleId: r.id.toString(), commitmentId: r.commitmentId.toString(),
    sample: { bid: r.sample.bid.toString(), ask: r.sample.ask.toString(),
      bidSize: r.sample.bidSize.toString(), askSize: r.sample.askSize.toString(),
      blockNumber: r.sample.blockNumber.toString(), blockHash: r.sample.blockHash,
      source: sampleSourceFromCode(Number(r.sample.source)) },
    verdict: r.state,
  }, null, 2);
  $("#overlay").innerHTML = `<div class="drawer-scrim"></div><aside class="drawer">
    <div style="display:flex;justify-content:space-between;align-items:center">
      <span class="stat-label">Sample #${r.id}</span>
      <button class="btn btn-ghost" data-close>close</button></div>
    <div style="margin:var(--s-4) 0">${pill(r.state)} ${src(sampleSourceFromCode(Number(r.sample.source)))}</div>
    <div class="term"><button class="copy" data-copy="${esc(json)}">copy</button><pre>${esc(json)}</pre></div>
    <p class="h2-sub" style="margin-top:var(--s-4)">Raw struct as <code>packages/protocol-types</code>
      defines it. <code>blockHash</code> is the <strong>parent</strong> hash of <code>blockNumber</code>:
      a contract cannot observe the hash of the block it runs in. Check it with
      <code>cast block ${r.sample.blockNumber} --field parentHash</code>.</p></aside>`;
}

/* ── Page 4: breach audit terminal ────────────────────────────────────────── */
async function renderBreaches() {
  if (S.breaches === 0n) {
    $("#breachRows").innerHTML = `<tr><td colspan="7"><div class="empty">No breaches recorded.</div></td></tr>`;
    return;
  }
  const read = (fn, args) => S.client.readContract({ address: S.registry, abi, functionName: fn, args });
  const show = S.breaches > 25n ? 25n : S.breaches;
  const rows = [];
  for (let i = 0n; i < show; i += 1n) {
    const b = await read("breachAt", [i]);
    const rec = await read("sampleAt", [b.sampleId]);
    const state = VERDICT_STATES[Number(await read("verdictOf", [b.sampleId]))];
    const c = S.commitments.find((x) => x.id === b.commitmentId);
    rows.push({ i, b, rec, state, c });
  }
  const visible = rows.filter((r) => !S.bq || `${r.c?.marketId}${r.c?.maker}`.toLowerCase().includes(S.bq));
  $("#breachRows").innerHTML = visible.map((r) => `
    <tr class="row" data-breach="${r.i}">
      <td class="n">#BR-${String(r.i).padStart(5, "0")}</td>
      <td class="n">${r.c ? cut(r.c.marketId, 10, 6) : "n/a"}</td>
      <td>${pill(r.state)}</td>
      <td class="n">${num(r.rec.sample.blockNumber)}</td>
      <td class="n">${r.c ? formatEther(r.c.bond) : "0"} STT</td>
      <td><span class="pill p-WINDOW_CLOSED"><span class="d"></span>NOT DISTRIBUTED</span></td>
      <td><span class="muted">Dossier →</span></td></tr>`).join("");
  $$("tr[data-breach]").forEach((tr) => tr.addEventListener("click", () => dossier(rows[Number(tr.dataset.breach)])));
  if (rows[0]) dossier(rows[0]);
}

async function dossier(r) {
  const s = r.rec.sample, spread = s.ask - s.bid, c = r.c;
  let pinOk = null;
  try { const blk = await S.client.getBlock({ blockNumber: s.blockNumber }); pinOk = blk.parentHash.toLowerCase() === s.blockHash.toLowerCase(); } catch { pinOk = null; }
  const cmd = `pnpm assize verify ${r.i}`;
  $("#breachDossier").innerHTML = `
    <h2>Breach proof dossier</h2>
    <p class="h2-sub">Audit receipt for incident #BR-${String(r.i).padStart(5, "0")}.</p>
    <div class="card">
      <dl class="kv">
        <dt>INCIDENT</dt><dd>#BR-${String(r.i).padStart(5, "0")}</dd>
        <dt>REGISTRY</dt><dd>${S.registry}</dd>
        <dt>VIOLATED</dt><dd>Observed spread ${bps(spread, S.one)} bps exceeded committed max ${c ? bps(c.maxSpread, S.one) : "n/a"} bps
          <span class="muted">(${num(spread)} raw against ${c ? num(c.maxSpread) : "n/a"} raw)</span></dd>
        <dt>SAMPLE</dt><dd>#${r.b.sampleId} at block ${num(s.blockNumber)}</dd>
        <dt>BLOCK HASH</dt><dd>${s.blockHash}<br><span style="color:${pinOk ? "var(--verdict-covered)" : "var(--text-muted)"}">
          ${pinOk === null ? "could not re-read the block" : pinOk ? "parent hash confirmed canonical on Shannon" : "pin does not resolve"}</span></dd>
        <dt>SOURCE</dt><dd>${src(sampleSourceFromCode(Number(s.source)))} · callback tx ${cut(S.cfg.evidence.callbackTx, 10, 8)}</dd>
        <dt>COLLATERAL</dt><dd>${c ? formatEther(c.bond) : "0"} STT forfeited</dd>
      </dl>
      <div class="note"><strong>Forfeited, and claimable by whoever was exposed.</strong> The bond is
        payable pro-rata to traders the registry saw filling inside the window, and to nobody else.
        A trader who never filled has nothing to claim here, however much the book cost them.</div>
      <h2>Clean-room reproduction</h2>
      <div class="term"><button class="copy" data-copy="${esc(cmd)}">copy</button><pre>${esc(cmd)}</pre></div>
      <p class="h2-sub" style="margin-top:var(--s-2)">Any stranger can run this to re-read the chain at
        the pinned block and re-derive the identical verdict.</p>
      <p style="margin-top:var(--s-3)"><a class="navlink" href="${S.explorer}/tx/${S.cfg.evidence.callbackTx}" target="_blank" rel="noopener">Precompile callback transaction on the block explorer →</a></p>
    </div>`;
}

/* ── Page 3: commitment studio ────────────────────────────────────────────── */
function renderPublish() {
  const c = S.commitments[0];
  $("#publishForm").innerHTML = `
    <label class="field" for="fMarket">Market</label>
    <select class="input" id="fMarket">${S.commitments.map((x) => `<option value="${x.marketId}">${cut(x.marketId, 14, 8)}</option>`).join("")}</select>
    <div class="hint">Queried from chain, never a hardcoded string.</div>
    <label class="field" for="fSpread">Maximum allowable spread, in raw price units</label>
    <input class="input" id="fSpread" type="number" value="${c ? c.maxSpread : 15000}">
    <div class="hint" id="spreadHint"></div>
    <label class="field" for="fDepth">Minimum book depth, contracts on both bid and ask</label>
    <input class="input" id="fDepth" type="number" value="${c ? c.minSize : 100000000}">
    <div class="hint">Each side must carry this. One thin side breaches.</div>
    <label class="field" for="fWindow">Commitment window</label>
    <select class="input" id="fWindow">
      <option value="36000">1 hour (36,000 blocks)</option>
      <option value="144000">4 hours (144,000 blocks)</option>
      <option value="432000" selected>12 hours (432,000 blocks)</option>
      <option value="864000">24 hours (864,000 blocks)</option>
    </select>
    <div class="hint">Somnia produces a block every 100ms.</div>
    <label class="field" for="fBond">Bond collateral, STT into escrow</label>
    <input class="input" id="fBond" type="number" step="0.1" value="1">
    <label class="field" for="fGas">Handler gas prefund, STT</label>
    <input class="input" id="fGas" type="number" step="0.1" value="38">
    <div class="hint">Estimated from callback frequency. The owner's balance is tested against the whole gas limit at every firing.</div>
    <div class="card flat" style="background:var(--bg-canvas);margin:var(--s-4) 0">
      <div class="stat-label">Economic summary</div>
      <dl class="kv" style="margin-top:var(--s-3)">
        <dt>COLLATERAL ESCROW</dt><dd id="sumBond">n/a</dd>
        <dt>HANDLER PREFUND</dt><dd id="sumGas">n/a</dd>
        <dt>TOTAL REQUIRED</dt><dd id="sumTotal">n/a</dd>
      </dl>
    </div>
    <div id="publishState"></div>
    <button class="btn btn-white" id="doPublish" style="width:100%;justify-content:center">Post Commitment</button>`;
  for (const id of ["fSpread", "fDepth", "fBond", "fGas", "fWindow"]) $(`#${id}`).addEventListener("input", refreshPublish);
  $("#doPublish").addEventListener("click", doPublish);
  refreshPublish();
}

async function refreshPublish() {
  const bond = Number($("#fBond").value || 0), gas = Number($("#fGas").value || 0);
  const total = bond + gas;
  $("#sumBond").textContent = `${bond.toFixed(2)} STT`;
  $("#sumGas").textContent = `${gas.toFixed(2)} STT`;
  $("#sumTotal").textContent = `${total.toFixed(2)} STT`;

  const spread = BigInt($("#fSpread").value || 0);
  // §3 Page 3: spread cannot be tighter than the venue's minimum tick.
  const tick = 1000n;   // read from the pool's OrderBookParams at publish time
  $("#spreadHint").innerHTML = spread < tick
    ? `<span style="color:var(--verdict-absent)">Spread cannot be tighter than DreamDEX minimum tick size.</span>`
    : `${bps(spread, S.one)} bps of one whole contract.`;

  const box = $("#publishState");
  const button = $("#doPublish");
  if (!S.account) {
    box.innerHTML = `<div class="note">Connect a wallet to check your balance and sign.</div>`;
    button.disabled = true; button.textContent = "Connect Wallet to Proceed";
    return;
  }
  const balance = await S.client.getBalance({ address: S.account });
  const held = Number(formatEther(balance));
  // The envelope is dry-run through packages/reference before signing.
  const latest = S.samples[0];
  let dry = "";
  if (latest) {
    const state = evaluate({ maxSpread: spread, minSize: BigInt($("#fDepth").value || 0), start: 0n, end: 2n ** 63n },
      { ...latest.sample, source: sampleSourceFromCode(Number(latest.sample.source)) });
    // Names the block the reading came from, and never says "now". The latest
    // stored sample is the newest one that exists, which is not the same as a
    // current one: sampling ended at block 484519171 when the chain removed the
    // subscription, so "now" would assert something about an instant nobody
    // observed. PRD §21 — a claim may not outrun its evidence, and this is the
    // one screen that invites a reader to act on it.
    dry = `<div class="note">Against the latest stored sample, taken at block
      ${num(latest.sample.blockNumber)}, this envelope evaluates to ${pill(state)}
      ${state === "COVERED_AT_SAMPLE" ? "It would have held at that instant." : "It would have breached at that instant."}
      <span class="muted">That sample is the most recent one on chain, not a reading of the book now.</span></div>`;
  }
  if (held < total) {
    box.innerHTML = dry + `<div class="note amber"><strong>Insufficient STT.</strong> Testnet tokens must
      be obtained from the Somnia Shannon Faucet or the official Telegram community. You hold
      ${held.toFixed(2)} STT and need ${total.toFixed(2)} STT.
      <div style="margin-top:var(--s-3);display:flex;gap:var(--s-2);flex-wrap:wrap">
        <a class="btn btn-outline" href="https://t.me/+XHq0F0JXMyhmMzM0" target="_blank" rel="noopener">Open Shannon Faucet</a>
        <a class="btn btn-ghost" href="https://t.me/+XHq0F0JXMyhmMzM0" target="_blank" rel="noopener">Join Somnia Telegram Community</a>
      </div></div>`;
    button.disabled = true; button.textContent = "Insufficient STT Balance";
    return;
  }
  box.innerHTML = dry;
  button.disabled = false; button.textContent = "Post Commitment";
}

async function doPublish() {
  const account = S.account ?? await connect();
  if (!account) return;
  const head = await S.client.getBlockNumber();
  const start = head + 600n;   // 100ms blocks: a short offset is already past
  const data = encodeFunctionData({ abi, functionName: "publishCommitment",
    args: [$("#fMarket").value, BigInt($("#fSpread").value), BigInt($("#fDepth").value),
           start, start + BigInt($("#fWindow").value)] });
  try {
    const wallet = createWalletClient({ transport: custom(globalThis.ethereum) });
    const hash = await wallet.sendTransaction({ account, to: S.registry, data, value: parseEther(String($("#fBond").value)) });
    $("#publishState").innerHTML = `<div class="note"><strong>Posted.</strong>
      <a class="navlink" href="${S.explorer}/tx/${hash}" target="_blank" rel="noopener">${cut(hash, 12, 8)} →</a></div>`;
  } catch (error) {
    $("#publishState").innerHTML = `<div class="note rose"><strong>Not posted.</strong> ${esc(error.shortMessage ?? error.message)}</div>`;
  }
}

/* ── Page 5: trader settlement portal ─────────────────────────────────────── */
function renderClaim() {
  $("#claimBody").innerHTML = `
    <div class="note"><strong>This portal pays only addresses the chain saw trading.</strong>
      <code>claim(breachId, orderIds)</code> checks every order you name against
      <code>orderOwner</code>, which the registry learned from the pool's own <code>OrderPlaced</code>
      log — so a claim is never taken on your word. Your share is
      <code>bond × yourVolume ÷ witnessedVolume</code>, and it can only be taken once the window has
      closed, because until then the denominator is still moving.</div>
    <div class="card" style="margin-top:var(--s-3)">
      <div class="stat-label">Connected wallet audit</div>
      <dl class="kv" style="margin-top:var(--s-3)">
        <dt>ADDRESS</dt><dd id="claimAddr">${S.account ? S.account : "not connected"}</dd>
        <dt>WITNESSED FILLS</dt><dd>0 <span class="muted">(the registry witnesses no fills in this deployment)</span></dd>
        <dt>ATTRIBUTED VOLUME</dt><dd>0.00 STT</dd>
        <dt>CALCULATED SHARE</dt><dd>0.00%</dd>
      </dl>
      <div class="note" style="margin-top:var(--s-4)"><span class="pill p-NOT_SAMPLED"><span class="d"></span>NOT_WITNESSED</span>
        This wallet did not execute trades witnessed by the registry during a breached window. In this
        deployment no wallet did, because fills are not witnessed at all.</div>
      <button class="btn btn-white" disabled style="width:100%;justify-content:center;margin-top:var(--s-3)">Claim Payout</button>
      <p class="h2-sub" style="margin-top:var(--s-3)">Payouts would strictly enforce self-match rejection
        and per-address distribution caps. Would: the mechanism is designed in
        <code>PRD.md</code> §5.3 and §12 and is not deployed here.</p>
    </div>`;
}

/* ── Page 6: verification playground ──────────────────────────────────────── */
function renderCliDocs() {
  const clone = `git clone --recurse-submodules <repo> && cd assize\npnpm install`;
  const one = `pnpm assize verify 0`;
  const all = `pnpm claim:verify`;
  $("#cliDocs").innerHTML = [
    ["1 · Clone and install", clone],
    ["2 · Re-derive one breach", one],
    ["3 · Or re-derive every recorded verdict", all],
  ].map(([label, cmd]) => `<div style="margin-bottom:var(--s-3)"><div class="stat-label">${label}</div>
    <div class="term" style="margin-top:6px"><button class="copy" data-copy="${esc(cmd)}">copy</button><pre>${esc(cmd)}</pre></div></div>`).join("")
    + `<p class="h2-sub">The registry address comes from the committed deployment record, so neither
       command needs configuring. Both read a public RPC and nothing of ours.
       <strong>There is no published npm package yet</strong>, so there is no
       <code>npx assize</code> to run: the CLI lives in <code>packages/verifier</code> and runs from
       a clone.</p>`;
}

async function runVerifier() {
  const log = $("#verifyLog");
  const id = BigInt($("#verifyInput").value || 0);
  const line = [];
  const print = (t) => { line.push(t); log.innerHTML = `<pre>${esc(line.join("\n"))}</pre>`; };
  try {
    print(`→ connecting to ${S.rpc}`);
    const read = (fn, args) => S.client.readContract({ address: S.registry, abi, functionName: fn, args });
    const rec = await read("sampleAt", [id]);
    if (rec.sample.blockNumber === 0n) { print(`! no sample #${id} on chain, verdict NOT_SAMPLED`); return; }
    print(`→ sample #${id} read from the registry`);
    const c = await read("commitmentAt", [rec.commitmentId]);
    print(`→ commitment #${rec.commitmentId} read`);
    const blk = await S.client.getBlock({ blockNumber: rec.sample.blockNumber });
    const pinOk = blk.parentHash.toLowerCase() === rec.sample.blockHash.toLowerCase();
    print(`→ block ${rec.sample.blockNumber} parent hash ${pinOk ? "matches the pin" : "DOES NOT MATCH"}`);
    const derived = evaluate(
      { maxSpread: c.maxSpread, minSize: c.minSize, start: c.start, end: c.end },
      { ...rec.sample, source: sampleSourceFromCode(Number(rec.sample.source)) });
    print(`→ packages/reference re-derives: ${derived}`);
    const chain = VERDICT_STATES[Number(await read("verdictOf", [id]))];
    print(`→ the chain says:              ${chain}`);
    print(derived === chain && pinOk ? `\nPASS. Verdicts match and the pin resolves.` : `\nFAIL. See above.`);
  } catch (error) { print(`! ${error.shortMessage ?? error.message}`); }
}

async function connect() {
  if (!globalThis.ethereum) {
    $("#overlay").innerHTML = `<div class="modal-scrim"><div class="modal">
      <h2>No wallet found</h2><p class="h2-sub">Install an injected wallet, or post a commitment with
      <code>cast</code>. See the Verifier tab.</p>
      <button class="btn btn-white" data-close>Close</button></div></div>`;
    return null;
  }
  const [account] = await globalThis.ethereum.request({ method: "eth_requestAccounts" });
  const chainId = await globalThis.ethereum.request({ method: "eth_chainId" });
  if (parseInt(chainId, 16) !== 50312) {
    // §4 network mismatch state.
    $("#overlay").innerHTML = `<div class="modal-scrim"><div class="modal">
      <h2>Wrong network</h2><p class="h2-sub">Please switch network to Somnia Shannon (Chain ID: 50312).</p>
      <button class="btn btn-white" data-close>Close</button></div></div>`;
    return null;
  }
  S.account = account;
  const balance = await S.client.getBalance({ address: account });
  $("#wallet").textContent = `${Number(formatEther(balance)).toFixed(2)} STT · ${cut(account, 4, 3)}`;
  if (!$('[data-page="/publish"]').classList.contains("hidden")) refreshPublish();
  if (!$('[data-page="/claim"]').classList.contains("hidden")) renderClaim();
  return account;
}

boot().catch((error) => {
  for (const n of $$(".empty, #teaser")) n.innerHTML = `<span class="muted">could not read the chain: ${esc(error.message)}</span>`;
});
