/**
 * A stand-in chain for the end-to-end state tests.
 *
 * PRD §22 G10 requires that loading, empty, error, insufficient-STT, NOT_SAMPLED
 * and WINDOW_CLOSED are all reachable in the app. Only two verdict states have
 * ever occurred on Shannon, so the rest cannot be reached by pointing the app at
 * the real chain and waiting. This serves crafted responses instead.
 *
 * AGENTS.md: nothing simulated appears on the public proof path. This lives in
 * `scripts/e2e`, is loaded only by `pnpm test:e2e`, and is never bundled into
 * `apps/web`. It exists to prove a screen can be rendered, and makes no claim
 * about anything on chain.
 */
import { encodeFunctionResult, toFunctionSelector } from "viem";

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
];

const selectors = Object.fromEntries(
  abi.map((item) => [toFunctionSelector(item), item.name]),
);

const PIN = `0x${"ab".repeat(32)}`;
const ZERO = `0x${"0".repeat(64)}`;

/** A commitment whose window is blocks 1000 to 2000. */
const commitment = {
  maker: "0x62Ec9c9410c1b59647749D4d3005c75b9F380F38",
  marketId: `0x${"11".repeat(32)}`,
  maxSpread: 15000n, minSize: 100000000n,
  start: 1000n, end: 2000n, bond: 10n ** 18n, forfeitedAtBreachIdPlusOne: 1n,
};

const samples = {
  /** In window, spread 28000 against 15000. */
  breach: { bid: 686000n, ask: 714000n, bidSize: 200000000n, askSize: 200000000n, blockNumber: 1500n, blockHash: PIN, source: 1, verdict: 4 },
  /** Outside the window: block 5000 against an end of 2000. */
  windowClosed: { bid: 686000n, ask: 714000n, bidSize: 200000000n, askSize: 200000000n, blockNumber: 5000n, blockHash: PIN, source: 1, verdict: 2 },
  /** A zeroed slot: nothing was ever observed here. */
  notSampled: { bid: 0n, ask: 0n, bidSize: 0n, askSize: 0n, blockNumber: 0n, blockHash: ZERO, source: 0, verdict: 0 },
};

/**
 * Builds a Playwright route handler for one scenario.
 * `scenario` is one of: normal, empty, error, notSampled, windowClosed, slow.
 */
export function chainDouble(scenario) {
  return async (route) => {
    if (scenario === "error") {
      await route.fulfill({ status: 500, contentType: "text/plain", body: "upstream is down" });
      return;
    }
    if (scenario === "slow") {
      // Long enough for the test to observe the loading state, then answer.
      await new Promise((r) => setTimeout(r, 4000));
    }

    const body = JSON.parse(route.request().postData() ?? "{}");
    const calls = Array.isArray(body) ? body : [body];
    const answers = calls.map((call) => ({ jsonrpc: "2.0", id: call.id, result: answer(call, scenario) }));
    await route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify(Array.isArray(body) ? answers : answers[0]),
    });
  };
}

function answer(call, scenario) {
  switch (call.method) {
    case "eth_chainId": return "0xc488";
    case "eth_blockNumber": return "0x1f40";                 // 8000
    // 0.5 STT — under the 1 STT default bond, so the insufficient-balance state
    // is reachable. It was 2 STT, which only sat below the threshold while the
    // form demanded bond + a 38 STT prefund it never sent (D-048). When that
    // requirement dropped to the bond, 2 STT became sufficient and this state
    // stopped being reachable — which this gate caught on the next run.
    case "eth_getBalance": return "0x6f05b59d3b20000";       // 0.5 STT
    case "eth_getBlockByNumber": return { number: "0x5dc", hash: PIN, parentHash: PIN, timestamp: "0x0" };
    case "eth_call": return ethCall(call.params?.[0]?.data ?? "0x", scenario);
    default: return null;
  }
}

function ethCall(data, scenario) {
  const name = selectors[data.slice(0, 10)];
  const empty = scenario === "empty";
  const pick = scenario === "notSampled" ? samples.notSampled
    : scenario === "windowClosed" ? samples.windowClosed
    : samples.breach;
  const item = abi.find((a) => a.name === name);
  if (item === undefined) return "0x";

  const value = (() => {
    switch (name) {
      case "sampleCount": return empty ? 0n : 3n;
      case "breachCount": return empty ? 0n : 1n;
      case "commitmentCount": return empty ? 0n : 1n;
      case "verdictOf": return pick.verdict;
      case "breachAt": return { commitmentId: 0n, sampleId: 0n };
      case "commitmentAt": return commitment;
      case "sampleAt": return { commitmentId: 0n, sample: pick };
      default: return 0n;
    }
  })();
  return encodeFunctionResult({ abi: [item], functionName: name, result: value });
}
