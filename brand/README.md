# Assize brand

## The mark

```
 ┌──────────┐
 │          │      two rules with returns — the committed bound
 │   ────   │      the short rule between them — the sample
 │          │
 └──────────┘
```

Three strokes: an upper bound, a lower bound, and a reading held between them.

It is drawn the way a fixed span is drawn in a technical drawing, because that is what a commitment
is. PRD §1: *an assize was a fixed public standard with a penalty attached, like the Assize of Bread,
which set the loaf and punished the baker who broke it.* The mark is the standard, not the penalty —
the bound exists before any verdict does, and the reading either sits inside it or does not.

It is also the product's own diagram. The two rules are the maximum spread; the short rule is one
block-pinned sample. Nothing in it is decorative.

## What it replaced, and why

A Lucide scales-of-justice glyph. Generic legal iconography, borrowed rather than drawn, and at 16px
it collapsed into an indistinct shape. It said "law" in the abstract when the product measures a
specific thing.

Two earlier candidates were drawn and discarded for a reason worth recording: a bare cross between
two rules renders as **工**, and adding a centre rule renders as **王**. Both are CJK characters in
common use. A mark that reads as an unrelated word to a large part of the world is not a mark. The
returns on the ends of each rule are what break that reading, and they are also more accurate — a
bound has ends.

## Files

| File | Use |
|---|---|
| `assize-mark.svg` | The mark alone, on dark. Default. |
| `assize-mark-light.svg` | The mark on light backgrounds. |
| `assize-avatar.svg` | The mark on its canvas square, 64×64. For avatars and anything that crops. |
| `assize-lockup.svg` | Mark and wordmark, horizontal, on dark. |
| `assize-lockup-light.svg` | The same on light. |

The favicon is the mark, inlined in `apps/web/src/index.html` as a data URI. It is not a separate
file because the app ships as one self-contained page.

## Rules

**Clear space.** One third of the mark's width on every side. In the lockup that is the gap between
the mark and the wordmark, so the spacing is checkable by eye against itself.

**Minimum size.** 16px for the mark. Below that the channel closes and it reads as a filled block.
The wordmark has no minimum of its own but should not be set below 11px, where the tracking collapses.

**Colour.** `--text-primary` `#f4f4f5` on `--bg-canvas` `#08080a`, or the inverse. Nothing else.

**Never use a verdict colour.** The palette's greens, ambers, oranges and reds carry meaning in this
product — they are the seven verdict states — and using one decoratively would make a badge mean
less. DECISIONS.md D-034 sets this rule for the wordmark reveal and it applies here.

**No effects.** No gradient, no shadow, no blur, no outline. `frontend.md` specifies hairline borders
and zero elevation throughout, and the mark is drawn in the same stroke weight as the interface it
sits in.

**Do not** rotate it, stretch it, fill the channel, round the corners, place it on a busy background,
or recolour the tick independently of the rules.

## Typography

The wordmark is **mono, bold, wide tracking**, per `frontend.md`'s brand block spec:
`"ASSIZE" (font-mono, font-bold, tracking-widest, text-sm)`.

> **Known discrepancy.** The app's header currently renders `.brand` in `--font-sans`, not
> `--font-mono` as `frontend.md` specifies. The lockup follows the document. The header has not been
> changed, because `frontend.md` is the design authority and a silent correction in one place while
> the other stays wrong is worse than a recorded difference. Owner's call.

The lockup's `<text>` element carries the mono stack with fallbacks rather than outlined paths, so it
renders with whatever mono the viewer has. For print or a context where the exact face matters,
outline the text first.
