================================================================================
ASSIZE FRONTEND SPECIFICATION & ARCHITECTURE AUTHORITY (frontend.txt)
Lineage: Midday.ai Minimal Dark Monochromatic System
Network: Somnia Shannon Testnet | Protocol Target: DreamDEX Event Contracts
Governing Document: PRD.md
================================================================================

1. SYSTEM DESIGN TOKENS & ATOMIC STYLES
--------------------------------------------------------------------------------
Visual Identity:
  - Exact clone of Midday.ai: ultra-dark monochrome canvas, hairline borders,
    high-contrast white primary buttons, and monospace data readouts.
  - Border treatments: 1px hairline rgba(255, 255, 255, 0.06) across all cards,
    tables, and dividers.
  - Interactive hover states: transition to rgba(255, 255, 255, 0.12) with zero
    drop shadow or blur elevation.

Color Palette:
  --bg-canvas:              #08080a (Base application background)
  --bg-surface:             #0f0f12 (Card containers and table rows)
  --bg-surface-elevated:    #16161a (Drawers, modals, dropdown menus)
  --bg-surface-hover:       #1a1a20 (Table row and interactive card hover)
  
  --border-subtle:          rgba(255, 255, 255, 0.06)
  --border-strong:          rgba(255, 255, 255, 0.14)
  --border-focus:           rgba(255, 255, 255, 0.35)

  --text-primary:           #f4f4f5 (Headings, primary metrics, active navigation)
  --text-secondary:         #a1a1aa (Secondary metrics, input placeholders, labels)
  --text-muted:             #52525b (Explanatory footnotes, timestamps, disabled items)

Semantic State Badges (PRD §5.2):
  --verdict-covered:        #10b981 (COVERED_AT_SAMPLE - emerald pill + dot)
  --verdict-spread-breach:  #f59e0b (SPREAD_BREACH - amber pill + dot)
  --verdict-depth-breach:   #f97316 (DEPTH_BREACH - orange pill + dot)
  --verdict-absent:         #ef4444 (ABSENT - rose pill + dot)
  --verdict-not-sampled:    #71717a (NOT_SAMPLED - neutral zinc pill + dot)

Source Attribution Badges (PRD §0.9):
  --badge-reactivity:       bg-sky-500/10 text-sky-400 border-sky-500/20 [REACTIVITY]
  --badge-keeper:           bg-amber-500/10 text-amber-400 border-amber-500/20 [KEEPER]

Typography:
  --font-sans:              Geist Sans, Inter, -apple-system, sans-serif
  --font-mono:              Geist Mono, JetBrains Mono, monospace (for hashes,
                            amounts, spreads, block numbers, CLI commands, states)

Linter Rules & Prohibited Copy (PRD §5.2):
  - Any copy, banner, tooltip, or label containing the following words must fail
    build validation: "guaranteed", "safe", "liquid", "always", "protected", "insured".

--------------------------------------------------------------------------------
2. GLOBAL APP SHELL (NAVIGATION & FOOTER)
--------------------------------------------------------------------------------
Top Navigation Bar (Sticky, 56px height, backdrop-blur-md bg-canvas/80):
  - Brand Block: "ASSIZE" (font-mono, font-bold, tracking-widest, text-sm)
  - Navigation Tabs (Separated from brand by 1px vertical border):
    * Overview  -> `/`
    * Markets   -> `/markets`
    * Publish   -> `/publish`
    * Breaches  -> `/breaches`
    * Claims    -> `/claim`
    * Verifier  -> `/verify`
  - Protocol Health Status:
    * Live Pulsing Dot + "Somnia Shannon" (font-mono, text-xs, text-zinc-400)
  - Actions (Right aligned):
    * Link: "Faucet" (Points to Somnia Shannon testnet faucet / Telegram community)
    * Button: "+ Post Commitment" (Primary white button -> routes to `/publish`)
    * Wallet Pill: Displays STT balance + truncated address (0x71...8B2)

Global Footer Bar (Sticky/Pinned bottom, 48px height, border-t border-subtle):
  - Left: "Assize Protocol · Somnia × DreamDEX Event Contracts Hackathon"
  - Center: "Instants only. Non-continuous. Payouts reach witnessed volume only."
  - Right: GitHub repository link · Contract deployment addresses · Docs

--------------------------------------------------------------------------------
3. PAGE SPECIFICATIONS
--------------------------------------------------------------------------------

PAGE 1: LANDING PAGE & OVERVIEW (`/`)
--------------------------------------
Purpose: Comprehensive overview of the protocol, explaining problem, mechanism,
proof mechanics, and live platform telemetry.

Section 1: Hero Section (Midday Minimalist Centered Grid)
  - Badge: "Built for Somnia Shannon × DreamDEX Event Contracts"
  - Headline: "Liquidity is a promise. Assize enforces the bond."
  - Subtext: "Turn unverified prediction market liquidity into an on-chain,
    sampled commitment. When a market maker's spread widens or depth pulls, the
    bond forfeits directly to witnessed traders."
  - Primary CTAs:
    * [Explore Monitored Markets] (White button -> `/markets`)
    * [Post a Commitment] (Outlined zinc button -> `/publish`)
    * [Verify a Breach] (Ghost button -> `/verify`)

Section 2: Live Protocol Telemetry Bento (4-Column Midday Bento Layout)
  - Box 1: Total Value Bonded (Live STT locked across all active commitments)
  - Box 2: Monitored Order Books (Count of active DreamDEX event contract markets)
  - Box 3: Total Samples Evaluated (Breakdown: XX% Reactivity, YY% Keeper)
  - Box 4: Total Breaches Executed (Total STT forfeited and distributed)

Section 3: The Problem vs. The Mechanism (Side-by-Side Bento Cards)
  - Card A ("The Residual Price Fallacy"):
    Explains how prediction markets display stale last-traded prices on empty
    books. Traders size up, find no counterparty, and leave with zero record.
  - Card B ("Reactivity-Driven Enforcement"):
    Details how Somnia's reactivity precompile invokes Assize validators on
    market events, evaluates the book deterministically, and executes on-chain
    forfeitures.

Section 4: The 5-Step Deterministic Protocol Lifecycle (Interactive Flow)
  - Step 1: Maker posts an envelope (Max Spread, Min Depth, Window, Bond).
  - Step 2: Somnia reactivity precompile detects live book changes.
  - Step 3: Registry executes deterministic verdict = f(commitment, sample).
  - Step 4: Breach triggers immediate forfeiture of the maker's bond.
  - Step 5: Witnessed traders claim forfeited capital pro-rata.

Section 5: Live Breach Proof Teaser
  - Monospace mini-terminal showing the latest recorded breach.
  - Offending block hash, sample spread vs. envelope, and one-click copyable
    CLI verification command: `assize verify <breachId>`.

Section 6: Hard Protocol Boundaries & Disclosures (Auditor Transparency Box)
  - Explicit statement: "Assize does not guarantee continuous liquidity.
    Evaluations occur at sampled instants. Payouts reach witnessed traders only."


PAGE 2: MARKETS DIRECTORY & DETAILS (`/markets` & `/markets/[id]`)
------------------------------------------------------------------
Route 2A: `/markets` (Directory View)
  - Filter Bar: [All Books] [Covered Now] [Breached] [Uncovered] [Search Market ID]
  - Market List Grid / Table:
    * Columns: Market Name/Question, Maker Address, Committed Max Spread,
      Committed Min Depth, Bond Amount, Latest Sample Verdict, Source Badge,
      Window Countdown, Details Action.
    * Verdict Badges: COVERED_AT_SAMPLE, SPREAD_BREACH, DEPTH_BREACH, ABSENT,
      NOT_SAMPLED, WINDOW_CLOSED.
    * Empty State: "No active quoting commitments found on current DreamDEX books."

Route 2B: `/markets/[id]` (Live Market Coverage Terminal)
  - Header: Full market title, DreamDEX contract ID, and live price ticker.
  - Envelope Status Card:
    * Maker address, Active Bond (STT), Max Spread (bps), Min Size (contracts).
    * Handler Gas Gauge: Visual meter showing prefunded gas remaining + projected
      samples left before exhaustion.
  - Live Sample Inspection Ledger:
    * Real-time stream of order book samples.
    * Columns: Sample ID, Timestamp, Block #, Block Hash, Observed Bid/Ask,
      Observed Spread, Observed Size, Source ([REACTIVITY] or [KEEPER]), Verdict.
    * Clicking any row opens a slide-out inspect drawer displaying raw JSON
      struct matching `packages/protocol-types`.
  - Mandatory "NOT_SAMPLED" Note:
    * If a gap occurs in the ledger, render a full-width subtle banner:
      "Sampling occurs at discrete instants. An unrecorded block tick is logged
      as NOT_SAMPLED rather than smoothed over."


PAGE 3: COMMITMENT STUDIO (`/publish`)
--------------------------------------
Purpose: Maker interface to configure, prefund, and post a quoting commitment.

Form Layout (Centered, 640px Max Width Form Container):
  - Field 1: Market Selector (Live drop-down queried via DreamDEX SDK probe).
  - Field 2: Maximum Allowable Spread (Basis points input with real-time tick validator).
  - Field 3: Minimum Book Depth (Contract units required on both bid and ask).
  - Field 4: Commitment Window Duration (Preset blocks or slider: 1h, 4h, 12h, 24h).
  - Field 5: Bond Collateral (STT amount deposited into escrow).
  - Field 6: Handler Gas Prefund (Dynamic calculator estimating required gas
    for Somnia precompile invocations based on market frequency).
  - Economic Summary Card:
    * Collateral Escrow: X.XX STT
    * Handler Prefund: Y.YY STT
    * Total Required: (X.XX + Y.YY) STT
  - Validation & Edge States:
    * If Wallet STT < Total Required: Button switches to disabled state reading
      "Insufficient STT Balance". Render banner with direct links:
      [Open Shannon Faucet] and [Join Somnia Telegram Community].
    * If Spread < Market Minimum Tick: Inline alert: "Spread cannot be tighter
      than DreamDEX minimum tick size."


PAGE 4: BREACH AUDIT TERMINAL (`/breaches` & `/breaches/[id]`)
--------------------------------------------------------------
Route 4A: `/breaches` (Historical Incident Log)
  - Search / Filter by Market ID or Maker Address.
  - Table of historical violations: Breach ID, Market, Breach Type (Spread,
    Depth, Absent), Offending Sample Block, Forfeited Bond, Claim Status.

Route 4B: `/breaches/[id]` (Single Breach Proof Dossier)
  - Audit Receipt View (Monospace Midday style receipt card):
    * Breach Incident ID: #BR-00948
    * Contract Address: `0x...`
    * Violated Parameter: "Observed spread 145 bps exceeded committed max 80 bps."
    * Offending Sample Block: #2,910,481 (Block Hash: `0x4e8a...110b`)
    * Sample Source: `[REACTIVITY]` (Precompile Callback Tx: `0x91c...`)
    * Forfeited Collateral: 500 STT (Transferred to claimant pool)
  - Clean-Room Reproduction Block:
    * Terminal container with one-click copy button:
      `npx assize verify [breachId] --rpc https://dream-rpc.somnia.network`
    * Explanatory caption: "Any stranger can run this command to re-read the
      chain at the pinned block and re-derive the identical verdict."


PAGE 5: TRADER SETTLEMENT PORTAL (`/claim`)
-------------------------------------------
Purpose: Payout distribution interface for traders present during breaches.

Connected Wallet Audit Section:
  - Connected Address: `0x...`
  - Witnessed Orders & Fills during breached windows:
    * Market ID / Question
    * Fill Volume Attributed: X.XX STT
    * Calculated Share Percentage: Y.YY%
  - Claim Eligibility Statuses:
    * State 1: `[ELIGIBLE]` -> Shows exact claimable STT.
      Action: [Claim Payout] primary white button (calls `claim(breachId)`).
    * State 2: `[NOT_WITNESSED]` -> Explains: "This wallet did not execute
      trades witnessed by the registry during this breached window."
    * State 3: `[ALREADY_CLAIMED]` -> Shows historical payout transaction hash.
  - Anti-Wash Trading Disclosure:
    * "Payouts strictly enforce self-match rejection and per-address distribution caps."


PAGE 6: VERIFICATION PLAYGROUND & CLI DOCS (`/verify`)
------------------------------------------------------
Purpose: Interactive clean-room verification for judges, auditors, and traders.

Interface Components:
  - Interactive In-Browser Verifier:
    * Input: Breach ID or Sample ID
    * Button: [Re-Derive Verdict from Chain]
    * Real-Time Log Output: Fetches block pin from public RPC, extracts order book
      ticks, runs differential evaluator, prints PASS/FAIL verdict match.
  - CLI Installation Guide:
    * Code Snippet: `npm install -g @assize/sdk`
    * Verification command reference with optional RPC flag.
    * Link to `packages/verifier` on GitHub.

--------------------------------------------------------------------------------
4. GLOBAL EDGE STATES, EMPTY STATES & TOOLTIPS
--------------------------------------------------------------------------------
Insufficient Funds State (Every form):
  - Renders amber/zinc notice: "Insufficient STT. Testnet tokens must be obtained
    from the Somnia Shannon Faucet or the official Discord/Telegram."

Network Mismatch State:
  - If wallet is not on Somnia Shannon Testnet: Global modal blocks actions:
    "Please switch network to Somnia Shannon (Chain ID: 50312)."

NOT_SAMPLED State Footnote:
  - Always attached whenever `NOT_SAMPLED` appears:
    "Assize samples at discrete instants. An unrecorded block tick is logged
    transparently as NOT_SAMPLED rather than smoothed over."

Disconnected State:
  - Forms disable submission buttons and show: [Connect Wallet to Proceed].
================================================================================