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

A market shows you a price. That price is a claim about an order book you cannot see, and nothing checks it. A market maker can look tight and disappear the moment it matters. You find out by losing money.

So the maker puts money on it first. This is a commitment, published on chain before the window opens. Maximum spread, fifteen thousand. Minimum depth, ten million. One token bonded behind it. It is not a promise you have to trust. It is a statement that can be checked against what the book actually did.

Somnia's validators do the checking. Every time the market emits an event, they wake our handler inside that same block, read the book, and write down what they saw. Six thousand and twenty-eight samples. One thousand three hundred and ninety-six of them recorded a breach. We did not take these readings. We cannot skip them, and we cannot fake them.

Here is one. The book showed eight hundred and seventy-six thousand against eight hundred and ninety-seven thousand. A spread of twenty-one thousand, against a committed maximum of fifteen thousand. Breach.

The bond is forfeited. And then it is paid, to a trader the registry saw filling an order inside that window. One token, on chain, in this transaction.

Two limits, said plainly. This measures instants, not intervals. A sample is one reading at one block, and never proof the book held between two. And a payout only ever reaches traders the chain saw trading. Hold a position, lose money, never trade in that window, and this pays you nothing.

Make a commitment a listing requirement, and a venue can advertise its coverage because it has been measured, not because it says so. The instrument is small. What changes is whether a claim about a market survives contact with evidence.

---

## Part 2 — shot list

Record at 1920×1080. Open **https://assize.vercel.app** cold — no cached tab, no dev tools. §23
requires every beat to survive a cold start.

### Beat 1 · Problem · 0:00–0:17

*"A market shows you a price… You find out by losing money."*

| | |
|---|---|
| **Show** | A DreamDEX market page with a live price. Not our app. |
| **Cursor** | Rest on the quoted price. One slow circle around it, then still. |
| **Do not** | Scroll. Ten seconds of one calm frame is the point. |

### Beat 2 · Solution · 0:17–0:38

*"So the maker puts money on it first… checked against what the book actually did."*

| | |
|---|---|
| **Show** | Our app, **Markets** tab. |
| **Cursor** | Move along the first row left to right as the numbers are spoken: **Max spread 15,000** → **Min depth 10,000,000** → **Bond 1 STT**. |
| **Timing** | Land on each figure as the voice says it. This is the beat where the envelope has to be legible. |

### Beat 3 · Product · 0:38–1:02

*"Somnia's validators do the checking… we cannot fake them."*

| | |
|---|---|
| **Show** | Scroll to the sample stream below the table. |
| **Cursor** | Sweep slowly down the rows while they scroll, then stop on the **6,028 / 1,396** counters on Overview. |
| **Key frame** | Hold on those two numbers for the last sentence. Their difference is the whole argument. |

### Beat 4 · Demonstration · 1:02–1:43

*"Here is one… this pays you nothing."*

| | |
|---|---|
| **Show** | **Breaches** tab. Click the first row. |
| **Cursor** | On the dossier: point to **bid 876000**, then **ask 897000**, then the **committed maximum 15,000** as each is spoken. |
| **Then** | Open the claim transaction in the explorer: `0xec831878e0c0e94c8c7bdec3bb6411a6fe4739cc3402d52dd0d13186ae3a1d25` |
| **Cursor** | Point at the **1 STT value** and at the **recipient address**. |
| **On the two limits** | Come back to the app and rest the cursor on the **Hard protocol boundaries** section. Do not move it while they are said. |

> The limitations are not a caveat track under the pictures. §23 requires them out loud, and this is
> the one place a viewer cannot check them for themselves.

### Beat 5 · Future vision · 1:43–1:58

*"Make a commitment a listing requirement… survives contact with evidence."*

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
