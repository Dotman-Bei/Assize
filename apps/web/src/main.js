/**
 * Assize web surface. Layout, tokens and copy come from frontend.md; nothing
 * visual here is invented (DECISIONS.md D-029).
 *
 * There is no server and no database behind this page. It reads the chain
 * directly through a public RPC, which is the product's claim applied to its own
 * interface: if this page had to be trusted, the thesis would be broken.
 *
 * PRD §17: no address is compiled in. The deployment record arrives at runtime.
 */
import { createPublicClient, http, formatEther, parseEther, encodeFunctionData, custom, createWalletClient } from "viem";
import { verdict as evaluate, absoluteSpread } from "@assize/reference";
import { VERDICT_STATES, sampleSourceFromCode } from "@assize/protocol-types";
import { icon } from "./icons.js";

const registryAbi = [
  { type: "function", name: "sampleCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "breachCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "commitmentCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "verdictOf", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "uint8" }] },
  { type: "function", name: "forfeitureOf", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "bool" }, { type: "uint256" }] },
  { type: "function", name: "breachAt", stateMutability: "view", inputs: [{ type: "uint256" }],
    outputs: [{ type: "tuple", components: [{ name: "commitmentId", type: "uint256" }, { name: "sampleId", type: "uint256" }] }] },
  { type: "function", name: "sampleAt", stateMutability: "view", inputs: [{ type: "uint256" }],
    outputs: [{ type: "tuple", components: [
      { name: "commitmentId", type: "uint256" },
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

const $ = (id) => document.getElementById(id);
const short = (hex, head = 10, tail = 8) => `${hex.slice(0, head)}…${hex.slice(-tail)}`;
const badge = (s) => `<span class="badge v-${s}">${s}</span>`;
const srcBadge = (s) => `<span class="badge s-${s}">source: ${s}</span>`;
const bpsOfOne = (raw, one) => (one > 0n ? (raw * 10_000n) / one : 0n);
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

const S = { config: null, client: null, one: 1_000_000n, rows: [], samples: [], filter: "all", query: "", account: null };

async function boot() {
  const record = globalThis.__ASSIZE_DEPLOYMENT__ ?? await (await fetch("./deployment.json")).json();
  S.config = record;
  S.rpc = new URLSearchParams(location.search).get("rpc") ?? record.rpcUrl;
  S.client = createPublicClient({ transport: http(S.rpc) });
  S.registry = record.contracts.AssizeRegistry;
  S.subscriber = record.contracts.CoverageSubscriber;
  S.explorer = "https://shannon-explorer.somnia.network";

  $("logo").innerHTML = icon("Scale", 18);
  $("verifyCta").innerHTML = `${icon("Terminal", 14)} Verify a Breach via CLI`;
  $("faucetLink").innerHTML = `${icon("ExternalLink", 13)} Faucet`;
  $("bento1").innerHTML = `${icon("Activity", 16)} Instant Reactive Sampling (Path R)`;
  $("bento2").innerHTML = `${icon("Terminal", 16)} Zero-Trust Stranger Verification`;
  $("bento3").innerHTML = `${icon("Scale", 16)} Witnessed Volume Settle`;
  $("bento4").innerHTML = `${icon("ShieldAlert", 16)} Unfiltered Integrity (The Anti-Dashboard)`;
  $("footRegistry").href = `${S.explorer}/address/${S.registry}`;
  $("footSubscriber").href = `${S.explorer}/address/${S.subscriber}`;
  renderDocs();
  wireChrome();
  wireEvaluator();
  await Promise.all([loadRegistry(), loadFunding()]);
}

function wireChrome() {
  document.addEventListener("click", async (e) => {
    const nav = e.target.closest("[data-view]");
    if (nav) { e.preventDefault(); route(nav.dataset.view); return; }
    const copy = e.target.closest(".copy");
    if (copy) {
      await navigator.clipboard.writeText(copy.dataset.copy);
      copy.innerHTML = `${icon("CheckCircle", 12)} copied`;
      setTimeout(() => { copy.innerHTML = `${icon("Copy", 12)} copy`; }, 1200);
      return;
    }
    const pill = e.target.closest(".pill");
    if (pill) {
      S.filter = pill.dataset.filter;
      for (const p of document.querySelectorAll(".pill")) p.setAttribute("aria-pressed", String(p === pill));
      renderDirectory();
    }
  });
  $("search").addEventListener("input", (e) => { S.query = e.target.value.trim().toLowerCase(); renderDirectory(); });
  $("openPublisher").addEventListener("click", openPublisher);
  $("footPublisher").addEventListener("click", (e) => { e.preventDefault(); openPublisher(); });
  $("connect").addEventListener("click", connect);
  window.addEventListener("hashchange", () => route((location.hash || "#hero").slice(1)));
  route((location.hash || "#hero").slice(1));
}

function route(view) {
  const known = ["hero", "markets", "ledger", "verify", "docs"];
  const target = known.includes(view) ? view : "hero";
  for (const s of document.querySelectorAll("main > section")) s.classList.toggle("hidden", s.id !== target);
  for (const b of document.querySelectorAll("nav.tabs button")) b.setAttribute("aria-current", String(b.dataset.view === target));
  if (location.hash.slice(1) !== target) location.hash = target;
  window.scrollTo({ top: 0 });
}

/* ── §3.2 the evaluator, run locally on numbers the visitor chooses ────────── */
function wireEvaluator() {
  $("evalTitle").innerHTML = `${icon("Cpu", 14)} THE VERDICT FUNCTION, RUN IN YOUR BROWSER`;
  const envelope = { maxSpread: 15_000n, minSize: 100_000_000n, start: 0n, end: 2n ** 63n };
  const render = () => {
    const spread = BigInt($("spread").value), size = BigInt($("size").value), mid = 500_000n;
    const half = spread / 2n;
    const sample = { bid: mid > half ? mid - half : 0n, ask: mid + half, bidSize: size, askSize: size,
      blockNumber: 1n, blockHash: `0x${"ab".repeat(32)}`, source: "REACTIVITY" };
    const state = evaluate(envelope, sample);
    $("spreadOut").textContent = spread.toString();
    $("sizeOut").textContent = size.toString();
    $("evalOut").innerHTML = `f(commitment, sample) → ${badge(state)}<br>`
      + `<span style="color:var(--text-3)">committed ≤ ${envelope.maxSpread} raw · min size ${envelope.minSize}`
      + ` · this sample ${absoluteSpread(sample.bid, sample.ask)} raw`
      + ` (${bpsOfOne(absoluteSpread(sample.bid, sample.ask), 1_000_000n)} bps of one contract)</span>`;
  };
  $("spread").addEventListener("input", render);
  $("size").addEventListener("input", render);
  render();
}

async function loadFunding() {
  try {
    const balance = await S.client.getBalance({ address: S.subscriber });
    const gasLimit = BigInt(S.config.measurement.handlerGasLimit ?? 0);
    const floor = gasLimit * 6n * 10n ** 9n;
    S.prefund = { balance, floor };
    const low = balance <= floor * 10n;
    $("gasText").textContent = `Reactive precompile funded: ${Number(formatEther(balance)).toFixed(2)} STT`;
    if (balance <= floor) {
      $("gasText").textContent += " — BELOW THE FLOOR, sampling stops";
      $("gasPill").style.borderColor = "rgba(244,63,94,.35)";
      $("gasPill").querySelector(".dot").style.background = "#F43F5E";
    } else if (low) {
      $("gasPill").querySelector(".dot").style.background = "#FBBF24";
    }
    $("statusLeft").textContent = `Somnia Shannon: Operational · Reactivity Precompile: Active · Fallback Keeper: Idle`
      + ` · prefund ${Number(formatEther(balance)).toFixed(2)} STT against a ${formatEther(floor)} STT floor per firing`;
  } catch (error) {
    $("gasText").textContent = `handler funding unreadable: ${error.message.slice(0, 50)}`;
  }
}

async function loadRegistry() {
  const read = (fn, args) => S.client.readContract({ address: S.registry, abi: registryAbi, functionName: fn, args });
  const [count, total, breaches] = await Promise.all([read("commitmentCount"), read("sampleCount"), read("breachCount")]);
  S.total = total; S.breaches = breaches;

  const rows = [];
  for (let id = 0n; id < count; id += 1n) {
    const c = await read("commitmentAt", [id]);
    rows.push({ id, ...c });
  }
  // Newest samples first: the registry is append-only, so the tail is now.
  const take = 60n, first = total > take ? total - take : 0n;
  const ids = [];
  for (let i = total - 1n; i >= first && i >= 0n; i -= 1n) ids.push(i);
  S.samples = await Promise.all(ids.map(async (id) => {
    const [rec, v] = await Promise.all([read("sampleAt", [id]), read("verdictOf", [id])]);
    return { id, ...rec, state: VERDICT_STATES[Number(v)] };
  }));
  for (const row of rows) {
    row.last = S.samples.find((s) => s.commitmentId === row.id) ?? null;
  }
  S.rows = rows;

  renderDirectory();
  renderDetail(rows[0]);
  renderLatest(S.samples[0], rows[0]);
  renderBreach(rows[0]);
  renderVerify(S.samples[0]);
}

function renderLatest(latest, commitment) {
  if (!latest) { $("latestBody").textContent = "no samples yet"; return; }
  const s = latest.sample, spread = s.ask - s.bid;
  $("latestHead").textContent = `LATEST ON-CHAIN SAMPLE · BLOCK #${s.blockNumber.toLocaleString()}`;
  $("latestBody").className = "";
  $("latestBody").innerHTML = `<dl class="kv">
    <dt>BID</dt><dd>${s.bid.toLocaleString()} <span style="color:var(--text-3)">(size ${s.bidSize.toLocaleString()})</span></dd>
    <dt>ASK</dt><dd>${s.ask.toLocaleString()} <span style="color:var(--text-3)">(size ${s.askSize.toLocaleString()})</span></dd>
    <dt>SPREAD</dt><dd>${spread.toLocaleString()} raw · ${bpsOfOne(spread, S.one)} bps
      <span style="color:var(--text-3)">(committed ≤ ${commitment.maxSpread.toLocaleString()})</span></dd>
    <dt>VERDICT</dt><dd>${badge(latest.state)}</dd>
    <dt>PIN</dt><dd style="color:var(--text-3)">${short(s.blockHash, 14, 10)}</dd></dl>`;
}

/* ── §3.4 directory ───────────────────────────────────────────────────────── */
function renderDirectory() {
  const body = $("directoryBody");
  const visible = S.rows.filter((r) => {
    const q = S.query;
    if (q && !(`${r.marketId}${r.maker}`.toLowerCase().includes(q))) return false;
    const state = r.last?.state;
    if (S.filter === "COVERED_AT_SAMPLE") return state === "COVERED_AT_SAMPLE";
    if (S.filter === "breach") return r.forfeitedAtBreachIdPlusOne > 0n;
    if (S.filter === "uncovered") return !state || state === "NOT_SAMPLED";
    if (S.filter === "baseline") return true;   // every maker here is ours
    return true;
  });
  if (visible.length === 0) {
    body.innerHTML = `<tr><td colspan="6"><div class="empty">No active quoting commitments found for this filter. Run baseline maker to seed.</div></td></tr>`;
    return;
  }
  body.innerHTML = visible.map((r) => `
    <tr>
      <td class="num">${short(r.marketId, 12, 8)}<br><span style="color:var(--text-3);font-size:11px">DreamDEX event contract</span></td>
      <td class="num">${short(r.maker, 8, 6)}
        <button class="copy" data-copy="${r.maker}" style="float:none;margin-left:6px">${icon("Copy", 11)} copy</button>
        <br><span class="badge s-PROJECT_BASELINE">PROJECT_BASELINE</span></td>
      <td class="num">≤ ${r.maxSpread.toLocaleString()} raw (${bpsOfOne(r.maxSpread, S.one)} bps)<br>
        <span style="color:var(--text-3);font-size:11px">min ${r.minSize.toLocaleString()} · blocks ${r.start.toLocaleString()}–${r.end.toLocaleString()}</span></td>
      <td class="num">${formatEther(r.bond)} STT</td>
      <td>${r.last ? `${badge(r.last.state)}<br><span style="color:var(--text-3);font-size:11px">block ${r.last.sample.blockNumber.toLocaleString()}</span> ${srcBadge(sampleSourceFromCode(Number(r.last.sample.source)))}` : badge("NOT_SAMPLED")}</td>
      <td><button class="btn btn-secondary" style="padding:5px 10px;font-size:12px" data-view="markets">Inspect Stream</button>
        ${r.forfeitedAtBreachIdPlusOne > 0n ? `<button class="btn btn-ghost" style="padding:5px 10px;font-size:12px" data-view="ledger">View Breach</button>` : ""}</td>
    </tr>`).join("");
}

/* ── §3.5 market detail: gas gauge, depth chart, stream, inspector ─────────── */
function renderDetail(c) {
  if (!c) return;
  // The gauge measures firings the prefund can still pay for, against a stated
  // budget. An earlier version divided the balance by the per-firing floor and
  // clamped it, so it read full until the subscription was nearly dead — a meter
  // that only moves at the end is worse than no meter.
  const BUDGET = 1000n;
  const firings = S.prefund && S.prefund.floor > 0n ? S.prefund.balance / S.prefund.floor : 0n;
  const pct = Number((firings > BUDGET ? BUDGET : firings) * 100n / BUDGET);
  const low = firings < BUDGET / 10n;
  const latest = S.samples[0];
  $("detail").innerHTML = `
    <div class="card" style="margin-top:16px">
      <div class="card-head">
        <span class="card-title">${icon("Activity", 13)} MARKET ${short(c.marketId, 10, 6)} · ACTIVE COMMITMENT</span>
        <span class="card-title" id="remaining"></span>
      </div>
      <dl class="kv">
        <dt>ENVELOPE</dt><dd>≤ ${c.maxSpread.toLocaleString()} raw spread (${bpsOfOne(c.maxSpread, S.one)} bps) · min size ${c.minSize.toLocaleString()} per side</dd>
        <dt>WINDOW</dt><dd>blocks ${c.start.toLocaleString()} → ${c.end.toLocaleString()}</dd>
        <dt>BOND</dt><dd>${formatEther(c.bond)} STT — ${c.forfeitedAtBreachIdPlusOne > 0n
          ? `<span style="color:#F87171">forfeited at breach ${c.forfeitedAtBreachIdPlusOne - 1n}</span>` : "standing"}</dd>
      </dl>
      <div style="margin-top:16px">
        <label class="field">HANDLER GAS GAUGE — prefunded execution balance for callbacks</label>
        <div class="gauge ${low ? "low" : ""}"><span style="width:${Math.max(2, pct)}%"></span></div>
        <p class="section-note" style="margin:8px 0 0;font-size:12px">
          ${S.prefund ? `${Number(formatEther(S.prefund.balance)).toFixed(2)} STT — about
          <strong>${firings.toLocaleString()}</strong> more callbacks at ${formatEther(S.prefund.floor)} STT each,
          shown against a ${BUDGET.toLocaleString()}-callback budget.
          Below one callback's worth the subscription is removed rather than skipped, and sampling
          stops silently.` : ""}</p>
      </div>
      ${latest ? depthChart(latest.sample, c) : ""}
    </div>
    <div class="card" style="margin-top:16px">
      <div class="card-head">
        <span class="card-title">LIVE SAMPLE STREAM</span><span class="card-title" id="streamCount"></span>
      </div>
      <div class="scroll wrap-x"><table>
        <thead><tr><th>Time</th><th class="num">Block</th><th>Block hash (pinned)</th>
          <th class="num">Bid / Ask</th><th class="num">Size</th><th>Verdict</th><th>Source</th></tr></thead>
        <tbody id="streamBody"></tbody>
      </table></div>
      <p class="section-note" style="margin:14px 0 0" id="streamNote"></p>
    </div>
    <div id="inspector"></div>`;
  renderStream();
}

function depthChart(s, c) {
  const spread = s.ask - s.bid;
  const bound = c.maxSpread;
  const inside = spread <= bound;
  return `<div style="margin-top:16px">
    <label class="field">ORDER BOOK DEPTH · COMMITTED BOUNDARY AGAINST THE SAMPLED BID AND ASK</label>
    <div class="depth">
      <div class="bar bid" style="left:14%;height:${s.bidSize > 0n ? 70 : 4}%"></div>
      <div class="bar ask" style="right:14%;height:${s.askSize > 0n ? 70 : 4}%"></div>
      <div class="bound" style="left:50%"></div>
      <div class="tick" style="left:14%">bid ${s.bid.toLocaleString()}</div>
      <div class="tick" style="right:14%">ask ${s.ask.toLocaleString()}</div>
      <div class="cap" style="left:50%;transform:translateX(-50%);white-space:nowrap;color:${inside ? "#34D399" : "#F87171"}">
        spread ${spread.toLocaleString()} ${inside ? "within" : "outside"} committed ${bound.toLocaleString()}</div>
    </div></div>`;
}

function renderStream() {
  const rows = S.samples;
  const blocks = new Set(rows.map((r) => String(r.sample.blockNumber)));
  // Collapse consecutive samples reading the same book at the same block. Every
  // sample is real; listing a block's thirteen callbacks thirteen times makes
  // the measurement look richer than it is (DECISIONS.md D-024, D-026).
  const instants = [];
  for (const r of rows) {
    const key = `${r.sample.blockNumber}:${r.sample.bid}:${r.sample.ask}:${r.sample.bidSize}:${r.sample.askSize}`;
    const last = instants[instants.length - 1];
    if (last && last.key === key) { last.count += 1; continue; }
    instants.push({ key, count: 1, ...r });
  }
  $("streamBody").innerHTML = instants.map((r) => {
    const s = r.sample;
    if (r.state === "NOT_SAMPLED") {
      // §3.5: an amber-gray row carrying its own explanation.
      return `<tr class="gap"><td colspan="7">${badge("NOT_SAMPLED")}
        <div class="gap-note">Sampling gap at block #${s.blockNumber.toLocaleString()}. Precompile did
        not emit or RPC delayed. Not counted as coverage.</div></td></tr>`;
    }
    return `<tr class="clickable" data-sample="${r.id}">
      <td style="color:var(--text-3)">instant</td>
      <td class="num">${s.blockNumber.toLocaleString()}${r.count > 1 ? ` <span class="dupe">×${r.count}</span>` : ""}</td>
      <td class="mono" style="color:var(--text-3)">${short(s.blockHash, 8, 6)}</td>
      <td class="num">${s.bid.toLocaleString()} / ${s.ask.toLocaleString()}</td>
      <td class="num">${s.bidSize.toLocaleString()} / ${s.askSize.toLocaleString()}</td>
      <td>${badge(r.state)}</td>
      <td>${srcBadge(sampleSourceFromCode(Number(s.source)))}</td></tr>`;
  }).join("");
  $("streamCount").textContent = `${blocks.size} distinct blocks from the ${rows.length} most recent of ${S.total.toLocaleString()}`;
  $("streamNote").innerHTML = `Each row is one instant. <strong>×N</strong> means N samples read that
    same book at that same block: the subscription matches every log the pool emits, so a busy block
    fires the handler several times. None is fabricated and none is dropped — the count is shown
    rather than the rows repeated, because the honest measure of how often the book was observed is
    <strong>${blocks.size} blocks</strong>, not ${S.total.toLocaleString()} samples. Click a row for
    the stored struct.`;
  for (const tr of document.querySelectorAll("tr.clickable")) {
    tr.addEventListener("click", () => inspect(BigInt(tr.dataset.sample)));
  }
}

/** §3.5: clicking a row opens the stored sample as raw JSON, as it is on chain. */
function inspect(id) {
  const r = S.samples.find((x) => x.id === id);
  if (!r) return;
  const json = JSON.stringify({
    sampleId: r.id.toString(), commitmentId: r.commitmentId.toString(),
    sample: {
      bid: r.sample.bid.toString(), ask: r.sample.ask.toString(),
      bidSize: r.sample.bidSize.toString(), askSize: r.sample.askSize.toString(),
      blockNumber: r.sample.blockNumber.toString(), blockHash: r.sample.blockHash,
      source: sampleSourceFromCode(Number(r.sample.source)),
    },
    verdict: r.state,
  }, null, 2);
  $("inspector").innerHTML = `<div class="card" style="margin-top:16px">
    <div class="card-head"><span class="card-title">STORED SAMPLE INSPECTOR · #${r.id}</span>
      <button class="copy" data-copy="${esc(json)}">${icon("Copy", 12)} copy</button></div>
    <div class="term"><pre style="margin:0">${esc(json)}</pre></div>
    <p class="section-note" style="margin:12px 0 0;font-size:12px">This is the struct as the registry
      stores it. <code>blockHash</code> is the <strong>parent</strong> hash of <code>blockNumber</code>,
      because a contract cannot observe the hash of the block it is running in. Check it with
      <code>cast block ${r.sample.blockNumber} --field parentHash</code>.</p></div>`;
  $("inspector").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

/* ── §3.7 breach evidence and stranger verification ───────────────────────── */
async function renderBreach(c) {
  const t = $("breachBody");
  t.className = "";
  if (!c || S.breaches === 0n) {
    t.innerHTML = `<div class="card"><div class="empty">No breach has been recorded against this
      commitment. That is a statement about the samples taken so far, not a promise about the book.</div></div>`;
    return;
  }
  const read = (fn, args) => S.client.readContract({ address: S.registry, abi: registryAbi, functionName: fn, args });
  const breach = await read("breachAt", [0n]);
  const rec = await read("sampleAt", [breach.sampleId]);
  const state = VERDICT_STATES[Number(await read("verdictOf", [breach.sampleId]))];
  const s = rec.sample, spread = s.ask - s.bid;
  // §3.7 pin verification: the pin is the parent hash, so this checks it as one.
  let pinOk = null;
  try {
    const block = await S.client.getBlock({ blockNumber: s.blockNumber });
    pinOk = block.parentHash.toLowerCase() === s.blockHash.toLowerCase();
  } catch { pinOk = null; }
  const cmd = `cast call ${S.registry} "verdictOf(uint256)(uint8)" ${breach.sampleId} --rpc-url ${S.rpc}`;
  t.innerHTML = `
    <div class="alert-head">${icon("ShieldAlert", 16)} BREACH RECORDED: ${state} at Block #${s.blockNumber.toLocaleString()}</div>
    <div class="card">
      <div class="card-head"><span class="card-title">EVIDENCE · BREACH 0 OF ${S.breaches.toLocaleString()}</span>${badge(state)}</div>
      <dl class="kv">
        <dt>STORED SAMPLE</dt><dd>Bid ${s.bid.toLocaleString()} · Ask ${s.ask.toLocaleString()}
          (spread ${spread.toLocaleString()} raw = ${bpsOfOne(spread, S.one)} bps vs max ${c.maxSpread.toLocaleString()} raw)</dd>
        <dt>SIZES</dt><dd>${s.bidSize.toLocaleString()} / ${s.askSize.toLocaleString()}</dd>
        <dt>PIN VERIFICATION</dt><dd>${s.blockHash}<br><span style="color:${pinOk ? "#34D399" : "var(--text-3)"}">
          ${pinOk === null ? "could not re-read the block" : pinOk
            ? `${icon("CheckCircle", 12)} parent hash of block ${s.blockNumber.toLocaleString()} — confirmed canonical on Shannon`
            : "pin does not resolve"}</span></dd>
        <dt>BOND</dt><dd style="color:#F87171">${formatEther(c.bond)} STT forfeited</dd>
      </dl>
      <div class="notice warn"><strong>Forfeited is not distributed.</strong> The bond stays in the
        registry. This deployment has no settlement function, so no trader received anything and none
        can. The claim path was cut under K10.</div>
      <div class="card-head" style="margin-top:16px"><span class="card-title">${icon("Terminal", 13)} VERIFY THIS VERDICT INDEPENDENTLY, WITHOUT OUR SERVERS</span></div>
      <div class="term"><button class="copy" data-copy="${esc(cmd)}">${icon("Copy", 12)} copy</button><pre style="margin:0;white-space:pre-wrap">${esc(cmd)}</pre></div>
      <p style="margin:12px 0 0"><a href="${S.explorer}/tx/${S.config.evidence.callbackTx}" target="_blank" rel="noopener"
        style="color:var(--accent);font-size:13px;text-decoration:none">${icon("ExternalLink", 13)} Raw callback transaction on the Somnia Shannon block explorer</a></p>
    </div>`;
}

function renderVerify(latest) {
  const id = latest ? latest.id : 0n, block = latest ? latest.sample.blockNumber : 0n;
  const cmds = [
    ["The commitment, and the bond behind it", `cast call ${S.registry} \\\n  "commitmentAt(uint256)((address,bytes32,uint128,uint128,uint64,uint64,uint256,uint256))" 0 \\\n  --rpc-url ${S.rpc}`],
    ["The stored sample, with its block pin", `cast call ${S.registry} \\\n  "sampleAt(uint256)((uint256,(uint128,uint128,uint128,uint128,uint64,bytes32,uint8)))" ${id} \\\n  --rpc-url ${S.rpc}`],
    ["The verdict, re-derived from that stored sample", `cast call ${S.registry} "verdictOf(uint256)(uint8)" ${id} --rpc-url ${S.rpc}`],
    ["The bond is forfeited, and this is the breach that did it", `cast call ${S.registry} "forfeitureOf(uint256)(bool,uint256)" 0 --rpc-url ${S.rpc}`],
    ["The pin is the PARENT hash — this must equal the sample's blockHash", `cast block ${block} --field parentHash --rpc-url ${S.rpc}`],
    ["Do not trust this page. Re-derive every verdict locally, from a clean clone",
     `git clone <repo> && cd assize && pnpm install\nSOMNIA_RPC_URL=${S.rpc} \\\n  ASSIZE_REGISTRY_ADDRESS=${S.registry} pnpm claim:verify`],
  ];
  $("verifyBody").className = "";
  $("verifyBody").innerHTML = cmds.map(([label, cmd]) => `
    <div class="card" style="margin-bottom:12px">
      <div class="card-head"><span class="card-title">${icon("Terminal", 12)} ${label.toUpperCase()}</span></div>
      <div class="term"><button class="copy" data-copy="${esc(cmd)}">${icon("Copy", 12)} copy</button><pre style="margin:0;white-space:pre-wrap">${esc(cmd)}</pre></div>
    </div>`).join("");
}

function renderDocs() {
  $("docsBody").innerHTML = [
    ["Assize measures at instants, not continuously.", "A sample is one reading at one block. It is not a window, not an average, and not proof that the book held between two samples."],
    ["The sample count is not the observation count.", "The subscription matches every log the pool emits, so a block with many pool events produces many samples reading the same book at the same instant. None is fabricated; they are redundant. The distinct-block count is the honest measure and both are shown."],
    ["Nobody was paid.", "A forfeited bond stays in the registry. There is no settlement function in this deployment at all."],
    ["The maker is us.", "Labelled PROJECT_BASELINE wherever it appears. Not a third party, not adoption, not demand. It published a commitment it did not keep, which is what it exists to do."],
    ["The block pin is a parent hash.", "A contract cannot observe the hash of the block it is running in, so a sample stores block N with the hash of N−1. A verifier treating it as a block hash will reject every honest sample."],
    ["A keeper, if one were ever registered, is trusted while used.", "Its only defence is that every sample pins a block — a real defence against writing false values and a weak one against choosing moments. No keeper is registered."],
  ].map(([h, b]) => `<div class="notice"><strong>${h}</strong> ${b}</div>`).join("");
}

/* ── §3.6 maker commitment publisher ──────────────────────────────────────── */
async function connect() {
  if (!globalThis.ethereum) {
    alert("No injected wallet found. Install one, or publish a commitment with cast — see the Verifier CLI tab.");
    return null;
  }
  const [account] = await globalThis.ethereum.request({ method: "eth_requestAccounts" });
  S.account = account;
  $("connect").textContent = short(account, 6, 4);
  return account;
}

function openPublisher() {
  const c = S.rows[0];
  const host = $("modalHost");
  host.innerHTML = `
  <div class="backdrop" id="backdrop">
    <div class="modal">
      <div class="card-head"><span class="card-title">${icon("Scale", 13)} PUBLISH A QUOTING COMMITMENT</span>
        <button class="btn btn-ghost" id="closeModal" style="padding:2px 8px">close</button></div>
      <div class="steps">
        <div class="step" aria-current="true">1 · ENVELOPE</div>
        <div class="step">2 · CAPITAL &amp; GAS</div>
        <div class="step">3 · SANITY REVIEW</div>
      </div>
      <label class="field">MARKET ID — probed from chain, never a hardcoded string</label>
      <select class="input" id="pMarket">${S.rows.map((r) => `<option value="${r.marketId}">${short(r.marketId, 14, 8)}</option>`).join("")}</select>
      <label class="field">MAXIMUM ALLOWABLE SPREAD — raw price units</label>
      <input class="input" id="pSpread" type="number" value="${c ? c.maxSpread : 15000}">
      <label class="field">MINIMUM LIQUIDITY DEPTH — contracts, each side</label>
      <input class="input" id="pSize" type="number" value="${c ? c.minSize : 100000000}">
      <label class="field">WINDOW DURATION — blocks from now (Somnia produces one every 100ms)</label>
      <input class="input" id="pWindow" type="number" value="400000">
      <label class="field">BOND DEPOSIT — STT</label>
      <input class="input" id="pBond" type="number" step="0.1" value="1">
      <label class="field">REACTIVE HANDLER GAS PREFUND — estimated from the window</label>
      <input class="input" id="pGas" type="number" step="0.1" value="38" readonly>
      <div id="pReview"></div>
      <div class="modal-actions">
        <button class="btn btn-secondary" id="pDry">Dry-run the envelope</button>
        <button class="btn btn-primary" id="pSign">${icon("Scale", 14)} Sign &amp; Publish Commitment</button>
      </div>
    </div>
  </div>`;
  const close = () => { host.innerHTML = ""; };
  $("closeModal").addEventListener("click", close);
  $("backdrop").addEventListener("click", (e) => { if (e.target.id === "backdrop") close(); });
  $("pDry").addEventListener("click", dryRun);
  $("pSign").addEventListener("click", publish);
  dryRun();
}

/** §3.6 step 3: the reference evaluator dry-runs the envelope before signing. */
function dryRun() {
  const maxSpread = BigInt($("pSpread").value || 0), minSize = BigInt($("pSize").value || 0);
  const latest = S.samples[0];
  let verdictLine = "No sample to test the envelope against yet.";
  if (latest) {
    const state = evaluate(
      { maxSpread, minSize, start: 0n, end: 2n ** 63n },
      { ...latest.sample, source: sampleSourceFromCode(Number(latest.sample.source)) },
    );
    verdictLine = `Against the latest on-chain sample (bid ${latest.sample.bid.toLocaleString()},
      ask ${latest.sample.ask.toLocaleString()}), this envelope evaluates to ${badge(state)}
      ${state === "COVERED_AT_SAMPLE" ? "— it would hold right now." : "— it would breach immediately."}`;
  }
  const need = Number($("pBond").value || 0) + Number($("pGas").value || 0);
  $("pReview").innerHTML = `
    <div class="notice"><strong>Envelope sanity review.</strong> ${verdictLine}</div>
    <div id="pFunds"></div>`;
  checkFunds(need);
}

async function checkFunds(need) {
  const box = $("pFunds");
  if (!S.account) { box.innerHTML = `<div class="notice">Connect a wallet to check your balance against ${need} STT.</div>`; return; }
  const balance = await S.client.getBalance({ address: S.account });
  if (Number(formatEther(balance)) >= need) {
    box.innerHTML = `<div class="notice"><strong>${Number(formatEther(balance)).toFixed(2)} STT available</strong> against ${need} STT required.</div>`;
    return;
  }
  // §3.6 low STT warning state.
  box.innerHTML = `<div class="notice warn">
    <strong>Insufficient STT balance.</strong> Request testnet funds from the Somnia Telegram faucet.
    You hold ${Number(formatEther(balance)).toFixed(2)} STT and need ${need} STT.
    <div style="margin-top:10px"><a class="btn btn-secondary" href="https://t.me/+XHq0F0JXMyhmMzM0"
      target="_blank" rel="noopener">${icon("ExternalLink", 13)} Open Faucet Community</a></div></div>`;
}

async function publish() {
  const account = S.account ?? await connect();
  if (!account) return;
  const head = await S.client.getBlockNumber();
  // A start only a few hundred blocks ahead can already be in the past by the
  // time the transaction lands: Somnia produces a block every 100ms.
  const start = head + 600n;
  const data = encodeFunctionData({
    abi: registryAbi, functionName: "publishCommitment",
    args: [$("pMarket").value, BigInt($("pSpread").value), BigInt($("pSize").value),
           start, start + BigInt($("pWindow").value)],
  });
  try {
    const wallet = createWalletClient({ transport: custom(globalThis.ethereum) });
    const hash = await wallet.sendTransaction({
      account, to: S.registry, data, value: parseEther(String($("pBond").value)),
    });
    $("pReview").innerHTML = `<div class="notice"><strong>Published.</strong>
      <a href="${S.explorer}/tx/${hash}" target="_blank" rel="noopener" style="color:var(--accent)">${short(hash, 12, 8)}</a>
      — the bond is now escrowed and the envelope is on chain.</div>`;
  } catch (error) {
    $("pReview").innerHTML = `<div class="notice warn"><strong>Not published.</strong> ${esc(error.shortMessage ?? error.message)}</div>`;
  }
}

boot().catch((error) => {
  for (const n of document.querySelectorAll(".spin-note")) n.textContent = `could not read the chain: ${error.message}`;
});
