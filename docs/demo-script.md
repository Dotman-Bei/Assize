# Demo script

PRD §23: two to three minutes, five beats in the official order, showing the working testnet app,
surviving a cold start. This one runs **2:00**. Every figure below was read from chain on 2026-09-11
and is checkable while the camera runs.

**Two parts to this file.** The voiceover is first, clean and unbroken, to paste straight into
ElevenLabs. The shot list follows, timed against it, saying where the cursor goes.

---

## Part 1 — voiceover

Paste everything between the rules. No stage directions, no markup. Roughly 300 words, which lands
at about 1:55 at a normal narration pace.

---

A DreamDEX event contract market shows a price. That price is produced by an order book, and an order book can be empty. On a thin book the displayed number is the residue of whoever quoted last, not a price anyone will trade with you at. Nothing records that this happened, and the venue's liquidity claim survives contact with no evidence at all.

Assize is the instrument that makes it binding. A maker publishes a quoting commitment before the window opens: maximum spread, fifteen thousand raw price units. Minimum depth, ten million on both sides. One token, bonded against it. An assize was a fixed public standard with a penalty attached.

Enforcement is not ours to perform. Somnia's reactivity precompile invokes our handler inside the block that carried the market's event. The handler reads the top of the book at that instant and stores a sample: both prices, both sizes, the block number, and the parent hash that pins it to one block on one chain. The verdict is then computed from stored data alone. The envelope, and the sample. Nothing else. Six thousand and twenty-eight samples. One thousand three hundred and ninety-six breaches.

Breach zero. Bid, eight hundred and ninety-seven thousand. Ask, nine hundred and seventeen thousand. An absolute spread of twenty thousand, against a committed maximum of fifteen thousand. Spread breach. The bond forfeits on the first breach in the window, and settles pro rata to witnessed traders: addresses the registry saw filling inside that window, learned from the pool's own order logs. One token, this transaction.

Two limits. Assize evaluates at sampled instants, not across intervals. And a payout reaches witnessed traders only.

Commitments as a listing requirement for new markets. Coverage becomes something a venue advertises because the chain sampled it, not because the venue asserted it. What changes is whether a liquidity claim survives contact with evidence.

---

## Part 2 — shot list

Record at 1920×1080. Open **https://assize.vercel.app** cold — no cached tab, no dev tools. §23
requires every beat to survive a cold start.

### Beat 1 · Problem · 0:00–0:17

*"A DreamDEX event contract market shows a price… no evidence at all."*

| | |
|---|---|
| **Show** | A DreamDEX market page with a live price. Not our app. |
| **Cursor** | Rest on the quoted price. One slow circle around it, then still. |
| **Do not** | Scroll. Ten seconds of one calm frame is the point. |

### Beat 2 · Solution · 0:17–0:38

*"Assize is the instrument that makes it binding… a penalty attached."*

| | |
|---|---|
| **Show** | Our app, **Markets** tab. |
| **Cursor** | Move along the first row left to right as the numbers are spoken: **Max spread 15,000** → **Min depth 10,000,000** → **Bond 1 STT**. |
| **Timing** | Land on each figure as the voice says it. This is the beat where the envelope has to be legible. |

### Beat 3 · Product, how it works · 0:38–1:07

*"Enforcement is not ours to perform… one thousand three hundred and ninety-six breaches."*

| | |
|---|---|
| **Show** | Overview, the **How it works** section, then scroll to the sample stream. |
| **Cursor** | Walk the lifecycle steps left to right as the mechanism is described — **Book event** → **Reactive sample** → **Deterministic verdict** — then sweep down the sample rows. |
| **Key frame** | Stop on the **6,028 / 1,396** counters and hold for the last sentence. Their difference is the whole argument. |

### Beat 4 · Demonstration · 1:07–1:45

*"Breach zero… a payout reaches witnessed traders only."*

| | |
|---|---|
| **Show** | **Breaches** tab. Click the first row. |
| **Cursor** | On the dossier: point to **bid 897000**, then **ask 917000**, then the **committed maximum 15,000** as each is spoken. |
| **Then** | Open the claim transaction in the explorer: `0xec831878e0c0e94c8c7bdec3bb6411a6fe4739cc3402d52dd0d13186ae3a1d25` |
| **Cursor** | Point at the **1 STT value** and at the **recipient address**. |
| **On the two limits** | Come back to the app and rest the cursor on the **Hard protocol boundaries** section. Do not move it while they are said. |

> The limitations are not a caveat track under the pictures. §23 requires them out loud, and this is
> the one place a viewer cannot check them for themselves.

### Beat 5 · Future vision · 1:45–2:00

*"Commitments as a listing requirement… survives contact with evidence."*

| | |
|---|---|
| **Show** | Back to Overview, top of page. |
| **Cursor** | Still. Let the wordmark reveal follow the pointer once, slowly, and stop. |

---

## Before you upload

- [ ] Runs between 1:50 and 2:10
- [ ] The five beats are in the official order
- [ ] Beat 4 says **instants, not intervals** and **witnessed traders only**, out loud
- [ ] The claim transaction is on screen, not described
- [ ] Recorded from a cold load of the live URL
- [ ] Then fill in `submission.json`: `videoUrl`, and run `pnpm submission:check`

## Two things not to say

**Do not narrate it in the present tense as if sampling is running now.** It is not — the
subscription was closed after the run. The numbers are a completed measurement and the script is
written in that tense throughout.

**Do not call the maker a third party.** It is ours, labelled `PROJECT_BASELINE` in the app. The
script never claims otherwise, and neither should an answer to a judge's question.
