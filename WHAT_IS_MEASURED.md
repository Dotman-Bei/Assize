# What Is Measured

The honesty artifact for this repository. Written against ourselves. If a sentence in the app, the
README, the video, or the submission form contradicts this file, this file is right and that sentence
is a defect.

## What a sample is

The best bid, the best ask, and the size at each, read at one instant, pinned to a block number and
block hash, written on chain with the label of the path that produced it.

## What a sample is not

It is not a window of time. It is not an average. It is not proof that the book held between two
samples. Nothing here observes the book continuously, and no claim in this repository says it does.

## What a breach means

At a sampled instant, inside a live commitment window, the stored sample fell outside the stored
envelope. That is all it means.

## What a breach does not mean

It does not mean the maker was absent for the whole window. It does not mean a trader lost money. It
does not mean the venue failed. One breach at one instant is one fact.

## NOT_SAMPLED

Gaps happen: an unfunded subscription, a keeper that fell behind, a chain that produced no matching
event. Gaps are recorded as `NOT_SAMPLED` and reported on their own line, forever. They are never
folded into coverage and never dropped from a denominator. A window that is 90% unsampled is reported
as a window that is 90% unsampled.

## Who can be paid

Only addresses the registry witnessed trading that market inside the breach window. The trader who
opened the market, saw an empty book, and left without placing an order is the person this product
exists for, and that trader cannot be paid, because nothing on chain records that they looked. This
is the sharpest limitation in the design, and it is said out loud in the demo video.

## The keeper path

If the reactivity subscription is unavailable and we fall back to a keeper, the keeper chooses when
to sample, so it could sample selectively. Its only defence is that every sample pins a block, so
anyone can re-read the chain at that block and check what we wrote. That is a real defence against
lying about values and a weak one against choosing moments. If the keeper path is in use, the README
says so on the first screen, not in a footnote.

## Labels that must appear wherever the data appears

- `PROJECT_BASELINE`: our own maker. Not a third party, not adoption, not demand.
- `LOCAL FIXTURE`: test data. Never on the public proof path.
- `source: REACTIVITY` or `source: KEEPER`: how the sample arrived.
