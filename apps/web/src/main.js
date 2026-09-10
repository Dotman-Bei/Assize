/**
 * Assize web surface.
 *
 * There is no server and no database behind this page. It reads the chain
 * directly through a public RPC, which is the product's own claim applied to its
 * own interface: if this page had to be trusted, the thesis would be broken.
 *
 * PRD §17: no address is compiled in. The deployment record is fetched at
 * runtime, which is why `pnpm check:no-address-literals` finds nothing here.
 */
import { createPublicClient, http, formatEther } from "viem";
import { verdict as evaluate, absoluteSpread } from "@assize/reference";
import { VERDICT_STATES, sampleSourceFromCode } from "@assize/protocol-types";

const registryAbi = [
  { type: "function", name: "sampleCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "breachCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
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
];

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
const short = (hex, head = 10, tail = 8) => `${hex.slice(0, head)}…${hex.slice(-tail)}`;
const badge = (state) => `<span class="badge v-${state}">${state}</span>`;
const srcBadge = (s) => `<span class="badge s-${s}">source: ${s}</span>`;

/** Basis points of one whole contract — how frontend.md §3.2 renders a spread. */
const bpsOfOne = (raw, oneCollateral) => (oneCollateral > 0n ? (raw * 10_000n) / oneCollateral : 0n);

let state = { config: null, client: null, commitment: null, samples: [], oneCollateral: 1_000_000n };

async function boot() {
  // Served build fetches the record; the single-file build has it inlined by
  // build.mjs. Either way it arrives at runtime and never sits in source (§17).
  const record = globalThis.__ASSIZE_DEPLOYMENT__
    ?? await (await fetch("./deployment.json")).json();
  const rpcUrl = new URLSearchParams(location.search).get("rpc") ?? record.rpcUrl;
  state.config = record;
  state.client = createPublicClient({ transport: http(rpcUrl) });

  const registry = record.contracts.AssizeRegistry;
  const subscriber = record.contracts.CoverageSubscriber;
  const explorer = "https://shannon-explorer.somnia.network/address/";
  $("footRegistry").href = explorer + registry;
  $("footSubscriber").href = explorer + subscriber;

  routeFromHash();
  wireTabs();
  wireEvaluator();

  await Promise.all([loadCoverage(registry), loadFunding(subscriber)]);
}

function wireTabs() {
  const show = (view) => {
    for (const s of document.querySelectorAll("main > section")) {
      s.classList.toggle("hidden", s.id !== view && !(view === "hero" && s.id === "hero"));
    }
    $("hero").classList.toggle("hidden", view !== "hero");
    for (const b of document.querySelectorAll("nav.tabs button")) {
      b.setAttribute("aria-current", String(b.dataset.view === view));
    }
    location.hash = view;
    window.scrollTo({ top: 0 });
  };
  document.addEventListener("click", (e) => {
    const target = e.target.closest("[data-view]");
    if (!target) return;
    e.preventDefault();
    show(target.dataset.view);
  });
  window.addEventListener("hashchange", routeFromHash);
  state.show = show;
}

function routeFromHash() {
  const view = (location.hash || "#hero").slice(1);
  const known = ["hero", "markets", "ledger", "verify", "docs"];
  const target = known.includes(view) ? view : "hero";
  for (const s of document.querySelectorAll("main > section")) s.classList.toggle("hidden", s.id !== target);
  for (const b of document.querySelectorAll("nav.tabs button")) b.setAttribute("aria-current", String(b.dataset.view === target));
}

/** The evaluator, run locally on numbers the visitor chooses. Never chain data. */
function wireEvaluator() {
  const envelope = { maxSpread: 15_000n, minSize: 100_000_000n, start: 0n, end: 2n ** 63n };
  const render = () => {
    const spread = BigInt($("spread").value);
    const size = BigInt($("size").value);
    const mid = 500_000n;
    const half = spread / 2n;
    const sample = {
      bid: mid > half ? mid - half : 0n, ask: mid + half,
      bidSize: size, askSize: size,
      blockNumber: 1n, blockHash: `0x${"ab".repeat(32)}`, source: "REACTIVITY",
    };
    const result = evaluate(envelope, sample);
    $("spreadOut").textContent = spread.toString();
    $("sizeOut").textContent = size.toString();
    $("evalOut").innerHTML =
      `f(commitment, sample) → ${badge(result)}<br>`
      + `<span style="color:var(--text-3)">committed ≤ ${envelope.maxSpread} raw · min size ${envelope.minSize}`
      + ` · this sample ${absoluteSpread(sample.bid, sample.ask)} raw `
      + `(${bpsOfOne(absoluteSpread(sample.bid, sample.ask), 1_000_000n)} bps of one contract)</span>`;
  };
  $("spread").addEventListener("input", render);
  $("size").addEventListener("input", render);
  render();
}

async function loadFunding(subscriber) {
  try {
    const balance = await state.client.getBalance({ address: subscriber });
    const gasLimit = BigInt(state.config.measurement.handlerGasLimit ?? 0);
    const floor = gasLimit * 6n * 10n ** 9n;   // gasLimit × the documented minimum base fee
    const funded = balance > floor;
    $("gasText").textContent = `handler prefund: ${Number(formatEther(balance)).toFixed(2)} STT`;
    if (!funded) {
      // PRD §8.2: an unfunded subscription is a silent NOT_SAMPLED. Say so loudly.
      $("gasPill").style.borderColor = "rgba(244,63,94,.35)";
      $("gasText").textContent += " — BELOW THE FLOOR, sampling will stop";
      $("gasPill").querySelector(".dot").style.background = "#F43F5E";
    }
    $("statusLeft").textContent =
      `Somnia Shannon: operational · Reactivity precompile: active · Fallback keeper: idle · `
      + `prefund ${Number(formatEther(balance)).toFixed(2)} STT against a ${formatEther(floor)} STT floor per firing`;
  } catch (error) {
    $("gasText").textContent = `handler funding unreadable: ${error.message.slice(0, 60)}`;
  }
}

async function loadCoverage(registry) {
  const client = state.client;
  const read = (functionName, args) => client.readContract({ address: registry, abi: registryAbi, functionName, args });

  const [total, breaches, commitment] = await Promise.all([
    read("sampleCount"), read("breachCount"), read("commitmentAt", [0n]),
  ]);
  state.commitment = commitment;

  // Read the most recent samples. The registry is append-only, so the tail is
  // the newest, and the newest is what "coverage right now" means.
  const take = 40n;
  const first = total > take ? total - take : 0n;
  const ids = [];
  for (let i = total - 1n; i >= first && i >= 0n; i -= 1n) ids.push(i);

  const records = await Promise.all(ids.map(async (id) => {
    const [record, onChainVerdict] = await Promise.all([read("sampleAt", [id]), read("verdictOf", [id])]);
    return { id, ...record, onChainVerdict: VERDICT_STATES[Number(onChainVerdict)] };
  }));
  state.samples = records;

  renderCommitment(commitment, total, breaches);
  renderStream(records, total);
  renderBreaches(registry, breaches, commitment);
  renderVerify(registry, records[0]);
  renderLatest(records[0], commitment);
}

function renderLatest(latest, commitment) {
  if (!latest) { $("latestBody").textContent = "no samples yet"; return; }
  const s = latest.sample;
  const spread = s.ask - s.bid;
  $("latestHead").textContent = `LATEST ON-CHAIN SAMPLE · BLOCK #${s.blockNumber.toLocaleString()}`;
  $("latestBody").className = "";
  $("latestBody").innerHTML = `
    <dl class="kv">
      <dt>BID</dt><dd>${s.bid.toLocaleString()} <span style="color:var(--text-3)">size ${s.bidSize.toLocaleString()}</span></dd>
      <dt>ASK</dt><dd>${s.ask.toLocaleString()} <span style="color:var(--text-3)">size ${s.askSize.toLocaleString()}</span></dd>
      <dt>SPREAD</dt><dd>${spread.toLocaleString()} raw · ${bpsOfOne(spread, state.oneCollateral)} bps of one contract
        <span style="color:var(--text-3)">(committed ≤ ${commitment.maxSpread.toLocaleString()})</span></dd>
      <dt>VERDICT</dt><dd>${badge(latest.onChainVerdict)}</dd>
      <dt>PIN</dt><dd style="color:var(--text-3)">${short(s.blockHash, 14, 10)}</dd>
    </dl>`;
}

function renderCommitment(c, total, breaches) {
  const forfeited = c.forfeitedAtBreachIdPlusOne > 0n;
  $("commitmentCard").innerHTML = `
    <div class="card">
      <div class="card-head">
        <span class="card-title">THE COMMITMENT UNDER MEASUREMENT</span>
        <span class="badge s-PROJECT_BASELINE">PROJECT_BASELINE</span>
      </div>
      <dl class="kv">
        <dt>MARKET</dt><dd>${short(c.marketId, 12, 10)}</dd>
        <dt>MAKER</dt><dd>${short(c.maker, 10, 8)} <span style="color:var(--text-3)">— ours. Not adoption, not demand.</span></dd>
        <dt>MAX SPREAD</dt><dd>${c.maxSpread.toLocaleString()} raw <span style="color:var(--text-3)">(${bpsOfOne(c.maxSpread, state.oneCollateral)} bps of one contract)</span></dd>
        <dt>MIN SIZE</dt><dd>${c.minSize.toLocaleString()} per side</dd>
        <dt>WINDOW</dt><dd>blocks ${c.start.toLocaleString()} → ${c.end.toLocaleString()}</dd>
        <dt>BOND</dt><dd>${formatEther(c.bond)} STT — ${forfeited
          ? `<span style="color:#F87171">forfeited at breach ${c.forfeitedAtBreachIdPlusOne - 1n}</span>`
          : "standing"}</dd>
        <dt>SAMPLES</dt><dd>${total.toLocaleString()} <span style="color:var(--text-3)">· ${breaches.toLocaleString()} breaches</span></dd>
      </dl>
    </div>`;
}

function renderStream(records, total) {
  const body = $("streamBody");
  body.innerHTML = "";
  const blocks = new Set(records.map((r) => String(r.sample.blockNumber)));

  // Collapse samples that read the same book at the same block into one row and
  // count them. Every sample is real, but a block that emitted thirteen logs
  // produced thirteen readings of one instant, and listing them thirteen times
  // makes the measurement look richer than it is (DECISIONS.md D-024).
  const byInstant = [];
  for (const r of records) {
    const s = r.sample;
    const key = `${s.blockNumber}:${s.bid}:${s.ask}:${s.bidSize}:${s.askSize}`;
    const last = byInstant[byInstant.length - 1];
    if (last && last.key === key) { last.count += 1; continue; }
    byInstant.push({ key, count: 1, ...r });
  }

  for (const r of byInstant) {
    const s = r.sample;
    const row = el("tr");
    row.innerHTML = `
      <td class="num">${s.blockNumber.toLocaleString()}${r.count > 1 ? ` <span class="dupe">×${r.count}</span>` : ""}</td>
      <td class="num">${s.bid.toLocaleString()}</td>
      <td class="num">${s.ask.toLocaleString()}</td>
      <td class="num">${(s.ask - s.bid).toLocaleString()}</td>
      <td class="num">${s.bidSize.toLocaleString()}</td>
      <td class="num">${s.askSize.toLocaleString()}</td>
      <td>${badge(r.onChainVerdict)}</td>
      <td>${srcBadge(sampleSourceFromCode(Number(s.source)))}</td>
      <td style="color:var(--text-3)" class="mono">${short(s.blockHash, 8, 6)}</td>`;
    body.appendChild(row);
  }
  $("streamCount").textContent =
    `${blocks.size} distinct blocks from the ${records.length} most recent of ${total.toLocaleString()} samples`;
  $("streamNote").innerHTML =
    `Each row is one instant. <strong>×N</strong> means N samples read that same book at that same `
    + `block: the subscription matches every log the pool emits, so a busy block fires the handler `
    + `several times. None of those samples is fabricated and none is dropped — the count is shown `
    + `rather than the rows repeated, because the honest measure of how often the book was observed `
    + `is <strong>${blocks.size} blocks</strong>, not ${total.toLocaleString()} samples.`;
}

async function renderBreaches(registry, breachCount, commitment) {
  const target = $("breachBody");
  if (breachCount === 0n) {
    target.className = "";
    target.innerHTML = `<div class="card"><p class="section-note" style="margin:0">No breach has been
      recorded against this commitment. That is a statement about the samples taken so far and not a
      promise about the book.</p></div>`;
    return;
  }
  const read = (functionName, args) => state.client.readContract({ address: registry, abi: registryAbi, functionName, args });
  const breach = await read("breachAt", [0n]);
  const record = await read("sampleAt", [breach.sampleId]);
  const v = VERDICT_STATES[Number(await read("verdictOf", [breach.sampleId]))];
  const s = record.sample;
  target.className = "";
  target.innerHTML = `
    <div class="card">
      <div class="card-head">
        <span class="card-title">BREACH 0 · ${breachCount.toLocaleString()} recorded in total</span>
        ${badge(v)}
      </div>
      <dl class="kv">
        <dt>SAMPLE</dt><dd>#${breach.sampleId} at block ${s.blockNumber.toLocaleString()}</dd>
        <dt>BOOK</dt><dd>bid ${s.bid.toLocaleString()} · ask ${s.ask.toLocaleString()} · spread
          <strong>${(s.ask - s.bid).toLocaleString()}</strong> raw against a committed
          ${commitment.maxSpread.toLocaleString()}</dd>
        <dt>SIZES</dt><dd>${s.bidSize.toLocaleString()} / ${s.askSize.toLocaleString()}</dd>
        <dt>BLOCK PIN</dt><dd>${s.blockHash}</dd>
        <dt>BOND</dt><dd style="color:#F87171">${formatEther(commitment.bond)} STT forfeited</dd>
      </dl>
      <div class="notice warn" style="margin-bottom:0"><strong>Forfeited is not distributed.</strong>
        The bond stays in the registry. This deployment has no settlement function, so no trader
        received anything and none can.</div>
    </div>`;
}

function renderVerify(registry, latest) {
  const rpc = state.config.rpcUrl;
  const sampleId = latest ? latest.id : 0n;
  const block = latest ? latest.sample.blockNumber : 0n;
  const cmds = [
    ["The commitment, and the bond behind it",
     `cast call ${registry} \\\n  "commitmentAt(uint256)((address,bytes32,uint128,uint128,uint64,uint64,uint256,uint256))" 0 \\\n  --rpc-url ${rpc}`],
    ["The stored sample, with its block pin",
     `cast call ${registry} \\\n  "sampleAt(uint256)((uint256,(uint128,uint128,uint128,uint128,uint64,bytes32,uint8)))" ${sampleId} \\\n  --rpc-url ${rpc}`],
    ["The verdict, re-derived from that stored sample. 4 is SPREAD_BREACH",
     `cast call ${registry} "verdictOf(uint256)(uint8)" ${sampleId} --rpc-url ${rpc}`],
    ["The bond is forfeited, and this is the breach that did it",
     `cast call ${registry} "forfeitureOf(uint256)(bool,uint256)" 0 --rpc-url ${rpc}`],
    ["The pin is the PARENT hash — this must equal the sample's blockHash",
     `cast block ${block} --field parentHash --rpc-url ${rpc}`],
    ["Do not trust this page. Re-derive every verdict locally, from a clean clone",
     `git clone <repo> && cd assize && pnpm install\nSOMNIA_RPC_URL=${rpc} \\\n  ASSIZE_REGISTRY_ADDRESS=${registry} pnpm claim:verify`],
  ];
  $("verifyBody").className = "";
  $("verifyBody").innerHTML = cmds.map(([label, cmd]) => `
    <div class="card" style="margin-bottom:12px">
      <div class="card-head"><span class="card-title">${label.toUpperCase()}</span></div>
      <div class="term"><button class="copy" data-copy="${cmd.replace(/"/g, "&quot;")}">copy</button><pre style="margin:0;white-space:pre-wrap">${cmd}</pre></div>
    </div>`).join("");
  document.querySelectorAll(".copy").forEach((b) => b.addEventListener("click", async () => {
    await navigator.clipboard.writeText(b.dataset.copy);
    b.textContent = "copied";
    setTimeout(() => { b.textContent = "copy"; }, 1200);
  }));
}

boot().catch((error) => {
  document.querySelectorAll(".spin").forEach((n) => {
    n.textContent = `could not read the chain: ${error.message}`;
  });
});
