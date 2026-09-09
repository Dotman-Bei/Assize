# ==============================================================================
# ASSIZE FRONTEND SPECIFICATION & DESIGN AUTHORITY (frontend.txt / frontend.md)
# Repository: assize | Target: Somnia Shannon Testnet x DreamDEX Event Contracts
# Status: Production Design Authority | Governs §0, §9, §18, §22 of PRD.md
# ==============================================================================

[DESIGN AUTHORITY DECLARATION]
This document is the sole authority for design, layouts, component hierarchy,
color systems, typography, micro-interactions, copy guardrails, and asset strategy
for the Assize web application. Engineering agents must strictly implement the
specifications herein without inventing ad-hoc UI patterns or styles.

--------------------------------------------------------------------------------
1. BRAND IDENTITY & DESIGN SYSTEM
--------------------------------------------------------------------------------

1.1 Core Aesthetic
- Style: Dark-mode precision financial terminal meets modern developer infrastructure.
- Tone: Cold, deterministic, authoritative, zero-hyperbole, mathematically grounded.
- Background: Deep obsidian (#08090C) with subtle radial ambient glow (#1E293B at 8% opacity).
- Glassmorphism: Background blur (backdrop-blur-xl) with ultra-subtle translucent borders.

1.2 Color Tokens
- Background Base:        #08090C (Canvas / Root)
- Surface Elevated:       #0D0F15 (Cards, modals, popovers)
- Surface High:           #141721 (Hover states, table rows, input fields)
- Border Subtle:          rgba(255, 255, 255, 0.07) (Standard card & divider borders)
- Border Active:          rgba(255, 255, 255, 0.18) (Focus rings, selected tabs)
- Text Primary:           #F8FAFC (Headings, primary figures, active tabs)
- Text Secondary:         #94A3B8 (Subheadings, parameter labels, timestamps)
- Text Tertiary:          #64748B (Helper text, table column headers, block hashes)

1.3 Verdict & State Badge Palette (Strictly Enumerated per §5.2)
- COVERED_AT_SAMPLE:      Text #34D399 | Bg rgba(52, 211, 153, 0.08) | Border rgba(52, 211, 153, 0.25)
- SPREAD_BREACH:          Text #F87171 | Bg rgba(248, 113, 113, 0.08) | Border rgba(248, 113, 113, 0.25)
- DEPTH_BREACH:           Text #FB923C | Bg rgba(251, 146, 60, 0.08)  | Border rgba(251, 146, 60, 0.25)
- ABSENT:                 Text #E879F9 | Bg rgba(232, 121, 249, 0.08) | Border rgba(232, 121, 249, 0.25)
- NOT_SAMPLED:            Text #94A3B8 | Bg rgba(148, 163, 184, 0.08) | Border rgba(148, 163, 184, 0.25)
- WINDOW_CLOSED:          Text #64748B | Bg rgba(100, 116, 139, 0.08) | Border rgba(100, 116, 139, 0.20)
- SAMPLER_FAILED:         Text #F43F5E | Bg rgba(244, 63, 94, 0.12)  | Border rgba(244, 63, 94, 0.35)

1.4 Provenance & Baseline Tags
- REACTIVITY Source:      Text #38BDF8 | Bg rgba(56, 189, 248, 0.08)  | Border rgba(56, 189, 248, 0.25)
- KEEPER Source:          Text #FBBF24 | Bg rgba(251, 191, 36, 0.08)  | Border rgba(251, 191, 36, 0.25)
- PROJECT_BASELINE:       Text #A855F7 | Bg rgba(168, 85, 247, 0.08)  | Border rgba(168, 85, 247, 0.25)

1.5 Typography
- Display / Headings:     Geist Sans, SF Pro Display, or Inter. Font weights: 600, 700.
                          Letter-spacing: -0.03em.
- Body / Microcopy:       Geist Sans or Inter. Font weights: 400, 500.
                          Letter-spacing: -0.01em.
- Code / Metrics / Pins:  Geist Mono or JetBrains Mono. Font weights: 400, 500.
                          Letter-spacing: 0.00em. Tabular numbers enabled (tabular-nums).

1.6 Vocabulary & Copy Enforcement Filter (§5.2 & §22 G8)
- FORBIDDEN WORDS:        "guaranteed", "safe", "liquid", "always", "protected", "insured"
- Any occurrence of these words in copy, badges, toasts, or error text will fail CI.
- Required Disclaimers:
  * "Assize measures quoting behavior at sampled instants, not continuously."
  * "Unsampled intervals are recorded as NOT_SAMPLED and never counted as coverage."
  * "Forfeited bonds are claimable pro rata exclusively by witnessed traders in that window."

--------------------------------------------------------------------------------
2. APPLICATION NAVIGATION & TOP BAR
--------------------------------------------------------------------------------

2.1 Sticky Top Navigation (Fixed, backdrop-blur-md, 56px height, border-b border-white/[0.06])
- Left:
  * Logo Icon: Minimal geometric anvil/bracket glyph (SVG inline).
  * Wordmark: "ASSIZE" in Geist Mono, 15px, font-bold, tracking-wider, text-white.
  * Environment Pill: "SHANNON TESTNET" (Text #38BDF8, bg-cyan-950/40, border border-cyan-800/40).
- Center (Tabs):
  * [Live Markets] (Active indicator: 1px bottom accent line in #38BDF8 or white).
  * [Breach Ledger]
  * [Bond Claim Portal]
  * [Verifier CLI]
  * [Documentation & Phase]
- Right:
  * Handler Gas Status Pill: "Reactive precompile funded: 42.1 STT" (Dot: pulsing green).
  * Testnet Faucet Link (Redirects to Somnia Telegram community with tooltip).
  * Wallet Connection: [Connect Wallet] button (High contrast, #FFFFFF text #000000, rounded-lg).

--------------------------------------------------------------------------------
3. LANDING PAGE & CORE SURFACES ARCHITECTURE
--------------------------------------------------------------------------------

3.1 Hero Section
- Badge Anchor:
  * "SOMNIA REACTIVITY PRECOMPILE x DREAMDEX EVENT CONTRACTS"
  * Pill with subtle rotating gradient border (zinc-700 to cyan-500).
- Headline:
  * "Liquidity is a quoting commitment backed by an on-chain bond."
  * Size: 56px (desktop), 36px (mobile). Font-weight: 700. Tracking: -0.035em.
- Subheadline:
  * "DreamDEX order books are sampled at discrete instants using Somnia validator-driven
     callbacks. When a maker breaches committed spread or depth, the bond forfeits
     pro rata to traders witnessed in that window."
  * Size: 17px. Color: #94A3B8. Max width: 680px.
- CTAs:
  * Primary: [Inspect Live Markets] (Solid White, Black text, hover:bg-zinc-200).
  * Secondary: [Publish Maker Commitment] (Translucent slate, 1px border, hover:bg-white/5).
  * Tertiary: [Verify a Breach via CLI] (Ghost button with terminal icon).

3.2 Hero Live Simulator Card (Interactive Terminal Component)
- Real-time book sampling visualizer positioned directly beside/below the hero text.
- Header: "LATEST ON-CHAIN SAMPLE · BLOCK #12,849,204" with source badge `source: REACTIVITY`.
- Live Data Ticker:
  * Bid: 0.4920 (Size: 1,500) | Ask: 0.5080 (Size: 1,200) | Spread: 160 bps (Committed: <= 200 bps)
- Interactive Toggle:
  * Slider to widen spread or simulate dropped quote.
  * Instant readout: "Pure Verdict Evaluator: f(commitment, sample) -> SPREAD_BREACH"
  * Visual payout flash: "Bond: 500 STT forfeited to 4 witnessed addresses."

3.3 Bento Grid: Protocol Guarantees & Operational Pillars
- Box 1: "Instant Reactive Sampling (Path R)"
  * Explains Somnia precompile triggering on contract events.
  * Visual: Animated event emitter wireframe connecting DreamDEX to AssizeRegistry.
- Box 2: "Zero-Trust Stranger Verification"
  * Explains deterministic evaluation. Any third party can re-derive the verdict from public RPC.
  * Visual: Copyable terminal command `npx @assize/sdk verify 0x8a3f...`.
- Box 3: "Witnessed Volume Settle"
  * Explains pro-rata bond distribution to genuine traders, self-match rejection, counterparty caps.
  * Visual: Interactive split calculation card.
- Box 4: "Unfiltered Integrity (The Anti-Dashboard)"
  * Emphasizes that NOT_SAMPLED intervals and breaches are never smoothed over or hidden.

3.4 Surface 1: Market Registry Directory (§9)
- Search & Filter Toolbar:
  * Input field: "Filter by Market ID, Symbol, or Maker address..."
  * Filter pills: [All] · [Covered at Sample] · [Active Breach] · [Uncovered] · [Testnet Baseline]
- Data Table Columns:
  1. Market (ID, Event Contract Symbol, Underlying question).
  2. Maker Address (Truncated 0x... with copy icon, baseline flagged with `PROJECT_BASELINE`).
  3. Committed Envelope (Max Spread in bps, Min Size in contracts, Expiry window).
  4. Posted Bond (STT amount locked in contract).
  5. Last Sample Verdict (Enumerated badge, timestamp, source badge).
  6. Actions ([Inspect Stream] / [View Breach]).
- Empty State: "No active quoting commitments found for this filter. Run baseline maker to seed."

3.5 Surface 2: Market Detail & Live Verification Stream (§9)
- Header:
  * Market title, active commitment parameters, time remaining in window.
  * Handler Gas Gauge: Visual meter showing prefunded execution balance for callbacks.
- Order Book Depth & Instant Sample Snapshot:
  * Visual depth chart showing committed spread boundary vs. current sampled bid/ask.
- Live Sample Stream (Virtual scroll table):
  * Columns: Time | Block Number | Block Hash (pinned) | Bid/Ask | Size | Verdict Badge | Source
  * Clicking any row opens the Stored Sample Inspector showing raw JSON struct from chain.
- NOT_SAMPLED Handling:
  * Rendered as an amber-gray row with an inline explainer:
    "Sampling gap at block #12849182. Precompile did not emit or RPC delayed. Not counted as coverage."

3.6 Surface 3: Maker Commitment Publisher Modal (§9, §12)
- Step 1: Envelope Definition
  * Market ID select (dynamically probed from DreamDEX SDK, no hardcoded strings).
  * Maximum Allowable Spread (bps or tick units).
  * Minimum Liquidity Depth (contracts).
  * Window Duration (Start timestamp to End timestamp).
- Step 2: Capital Staking & Gas Prefund
  * Bond Deposit (STT input field).
  * Reactive Handler Gas Prefund (Calculated based on estimated blocks in window).
- Low STT Warning State:
  * If wallet STT < (Bond + Gas Prefund):
    Display alert: "Insufficient STT balance. Request testnet funds from the Somnia Telegram faucet."
    Button: [Open Faucet Community]
- Step 3: Envelope Sanity Review
  * Client-side reference evaluator (`packages/reference`) dry-runs the envelope before signing.
  * Button: [Sign & Publish Commitment].

3.7 Surface 4: Breach Evidence & Stranger Verification Page (§9, §11)
- Prominent Alert Header:
  * "BREACH RECORDED: SPREAD_BREACH at Block #12,850,119"
- Evidence Card:
  * Stored Sample Record: Bid: 0.4700, Ask: 0.5350 (Spread: 650 bps vs Max 200 bps).
  * Pin Verification: Block Hash `0x4f8e91...` confirmed canonical on Shannon testnet.
  * Forfeited Bond Status: "500 STT unlocked for distribution."
- Stranger Verification Box (High contrast dark terminal):
  * "Verify this verdict independently without our servers:"
  * Terminal block with one-click copy:
    `assize verify --breach 0x9c3e2... --rpc https://dream-rpc.shannon.somnia.network`
  * Link to raw transaction on Somnia Shannon Block Explorer.

3.8 Surface 5: Trader Bond Claim Portal (§5.3, §9)
- Trader Eligibility Checker:
  * Input or auto-detected connected wallet address.
  * Status readouts:
    * ELIGIBLE: "You traded 1,200 contracts during the breach window. Claimable: 45.2 STT."
    * NOT WITNESSED: "This address was not witnessed executing orders in the registered window."
    * ALREADY CLAIMED: "Bond share of 45.2 STT claimed in tx 0x7b1..."
  * Action: [Claim Forfeited Bond Share] (Calls `claim(breachId)` on `AssizeRegistry.sol`).

--------------------------------------------------------------------------------
4. GLOBAL FOOTER SPECIFICATION
--------------------------------------------------------------------------------

4.1 Structure (4-Column Layout + Operational Status Bar)
- Status Bar (Top of footer):
  * Left: "Somnia Shannon: Operational · Reactivity Precompile: Active · Fallback Keeper: Idle"
  * Right: "Commitment Hash: Pinned via skills-lock.json"
- Column 1 (Protocol):
  * Description: Fixed standard quoting verification and penalty settlement.
  * Open-source MIT License badge.
- Column 2 (Surfaces):
  * Directory, Breach Ledger, Publisher Studio, Witnessed Claims, Verifier CLI.
- Column 3 (Resources & Documentation):
  * Phase Progress (docs/phase.md), Kill Criteria, Runbooks, SDK Docs, Somnia Faucet.
- Column 4 (Hackathon Verification Proofs):
  * Shannon Registry Address (dynamic link), Subscriber Contract, Seed Claims Ledger.
- Bottom Bar:
  * "Assize is built for the Somnia x DreamDEX Hackathon. Testnet only. No real money or tokens."

--------------------------------------------------------------------------------
5. ASSET STRATEGY & SOURCING GUIDE
--------------------------------------------------------------------------------

5.1 UI Icons
- Source: Lucide Icons or Phosphor Icons.
- Key Icons:
  * ShieldAlert (Breaches), Activity (Reactivity sampling), Terminal (CLI verification),
  * Scale (Bond settlement), Cpu (Precompile hook), ExternalLink, Copy, CheckCircle.

5.2 Background Imagery & Visual Textures
- Style: Ultra-minimal dark tech, obsidian glass textures, subtle wireframe grids.
- Sourcing Keywords for Unsplash / Pexels / Pinterest / Midjourney:
  * "Dark obsidian glass texture minimalist 8k"
  * "Abstract glowing wireframe grid dark slate UI"
  * "Monochrome geometric server telemetry dark aesthetic"
  * "Dark techno typography clean layout web3"
- Tone Guardrail: Never use neon cartoon crypto illustrations, 3D coins, rocket ships,
  or flashy marketing tropes. Keep it looking like high-consequence laboratory telemetry.

--------------------------------------------------------------------------------
6. ACCEPTANCE & VERIFICATION CHECKLIST FOR FRONTEND AGENTS
--------------------------------------------------------------------------------
- [ ] No hardcoded contract addresses or market IDs anywhere in source code (§17).
- [ ] Automated regex checks confirm zero forbidden words in all strings (§5.2, §22 G8).
- [ ] NOT_SAMPLED states are visibly rendered with plain-language explanations (§9).
- [ ] All 7 enumerated verdict states have distinct, dedicated visual badges (§5.2).
- [ ] Low STT balance states gracefully surface the Telegram faucet link (§9).
- [ ] Stranger verification terminal command is copyable directly from breach pages (§11).
- [ ] Fully responsive on 390px (mobile), 768px (tablet), and 1440px+ (desktop).
================================================================================