# trieur

Sort a pile of cards into zones — by thumb, by mouse or by keyboard — and a model that learns,
on every filing, where the next card will probably go.

The gesture without the model is pleasant manual sorting. The model without the gesture is a
classifier with no interface. Together the loop closes: filing trains, and training shortens
the next filing — until `↵` is enough.

*(**trieur** is French for the machine that sorts mail into pigeonholes.)*

**[Docs and live demos →](https://frulko.github.io/trieur/)**

```bash
bun i
bun run dev      # the site and its demos
bun test         # the three packages
bun run bench    # the model bench
```

## Layout

```
packages/
  core/     the stage, zones, gesture, animations   → @trieur/core   (0 dependencies)
  learn/    features, models, local storage, wire   → @trieur/learn  (0 dependencies)
  server/   events, replay, embeddings              → @trieur/server (Bun + SQLite)
site/       Astro: documentation and demos
```

ES modules published as JavaScript with their type declarations. No bundler required, no
runtime dependency.

## Thirty seconds

```js
import { Deck } from '@trieur/core';
import '@trieur/core/trieur.css';
import { createRecommender } from '@trieur/learn';

const brain = createRecommender({ key: 'links' }); // local model, IndexedDB

new Deck(document.querySelector('#sorter'), {
  items: links,
  zones: [{ id: 'dev' }, { id: 'ai' }, null, { id: 'home' }], // null = free zone
  advisor: brain,
  multi: true,                                                 // several zones per card
  meta: (l) => ({ domain: l.host, tag: l.tags, title: l.title }), // what the model may see
  renderCard: (l, el) => (el.innerHTML = template(l)),
  onSort: (l, zone) => api.file(l.id, zone.id),   // async; a rejection puts the card back
  onSortMany: (l, zones) => api.file(l.id, zones.map((z) => z.id)),
});
```

| Key | Effect |
|---|---|
| a zone letter | files the card there |
| `⇧` + several letters | files into several zones at once |
| `↵` | accepts the zone the model suggests |
| `space` | skip |
| `⌫` | undo — and **unlearn** the example |

## The principles that explain the rest

**The library knows nothing about your domain.** No "bookmark", no "folder", neither in the code
nor in the CSS class names. It sorts opaque objects into opaque zones. What knows the subject
lives in the host: `renderCard` draws, `onSort` performs, `meta` decides what the model may look
at.

**The host decides, and may refuse.** `onSort` is asynchronous and may fail — a rejection puts
the card back. The library never mutates anything outside its own pile.

**The prediction never blocks the gesture.** The card is already under the finger when a zone
must be suggested. The local model answers in microseconds; the server is only consulted when
the local one stays silent, with a short deadline, and its silence prevents nothing.

**Say nothing rather than guess.** Too few examples, or no recognised feature, and `predict()`
returns an empty list. A bad suggestion costs more than a missing one: it erodes trust in every
suggestion that follows.

**The weights are measured, not decreed.** When several models vote, their weight comes from
their observed accuracy. No magic coefficient anywhere in the code.

## A zone is a spot, not a label

The key comes from the **position**, not from the label: changing what a zone holds does not
change the gesture, and the gesture stays memorable. A `null` entry is a free zone — dropping a
card there calls `onAssign(index)` instead of filing.

Each zone owns a **region** of the stage, the Voronoi diagram of the positions: sectors for a
circle, cells for a grid, the matching tiling for a custom layout — one formula. And it is not
just a drawing: **the drop aims at the region under the finger**. What you see is what you touch.

## One card, several zones

Folders are not mutually exclusive. With `multi: true`, a card can be **stacked** into several
zones before it leaves — four ways in, one state:

- **hold `⇧`** and press several zone letters; releasing `⇧` files them all;
- **tap `⇧`** on its own to latch the mode — the shortcut — and tap again to leave or to file;
- **hold the pad**, a translucent gamepad-style button that appears on touch screens;
- **hold the card** itself, then sweep it across the zones and let go.

Sweeping is the tablet gesture: rest a finger, feel the outline light up, drag the card across
two or three regions — each one joins the stack — then let go. Between zones the card returns to
the centre, because it is pointing, not leaving.

The card takes a dashed amber outline with a breathing ring, and each stacked zone gets a
numbered badge — badge `1` is the primary zone. Amber rather than red: red reads as error or
destruction, and this is neither. The model learns one example per zone, and undoing unlearns
all of them.

## What keeps it smooth

The gesture loop was tuned against a 2015 iPad, which is a better judge than a desktop. One
callback per frame instead of one per event; the stage rectangle measured once per drag instead
of once per move; a highlight that writes nothing when nothing changed; no region rebuild while
a card is in flight; transform and opacity only, with `will-change` granted just for the moment
something moves.

And a release always resolves: the card either flies all the way into its zone or comes back to
the centre. A cancelled pointer returns it rather than filing it, and `pointerup` is watched on
`window` too — iOS Safari sometimes never delivers it to the element that captured the pointer,
which used to leave the card frozen mid-air.

## The model ladder

Naive Bayes plateaus as soon as features interact: "github *and* rust" is not the sum of "github"
and "rust". Every rung runs on the same features and the same `Model` interface, so they can be
climbed one at a time — and compared.

| Rung | What it buys | What it costs |
|---|---|---|
| `Bayes` | learns from the 3rd example, explains itself, a hundred lines | assumes features are independent |
| `crosses()` | `domain×tag` exposes the combination, **without changing model** | the vocabulary explodes, it needs pruning |
| `Linear` | learned weights instead of counts; copes with correlated features | a learning rate — tuned on its own by AdaGrad |
| `Knn` | "this link looks like those": the best cold start | the corpus has to be kept |
| embeddings | brings two cards sharing **no word** closer together | a server and a network call |

`defaultModel()` does not choose: the three sparse models vote, weighted by the accuracy measured
before learning (the experts algorithm). Its classic guarantee is that in the long run the
ensemble does as well as its best member — without anyone naming it in advance.

### Measured, not assumed

`bun run bench` evaluates **prequentially**: every card is first shown to a model that has never
seen it, we note whether it was right, and only then does it learn. No train/test split to rig,
no leakage possible, and the number is the one the user experiences.

On a real corpus of 3,412 links filed by hand across 72 folders:

```
model                  top-1     top-3   silent    vocab      ms
────────────────────────────────────────────────────────────────
bayes                 33.1 %    57.1 %     0.7 %   49221     490
bayes + crosses       33.6 %    57.4 %     0.7 %   65385     449
linear                32.5 %    53.2 %     0.7 %   32789     796
linear + crosses      32.8 %    54.7 %     0.7 %   38797     911
knn                   32.1 %    54.4 %     0.7 %   27421    4420
knn + crosses         31.8 %    54.7 %     0.7 %   34798    5253
ensemble              35.8 %    60.9 %     0.7 %   49221   12158 ←
ensemble + crosses    35.3 %    61.3 %     0.7 %   65385   13698
```

Two findings nobody would have guessed:

- **Crossing buys almost nothing here** (+0.5 point), while it is worth seven to eleven points on
  a corpus where interactions dominate. It pays when interactions exist, not on principle.
- **The ensemble beats each of its members**, which is not automatic: it only does so because its
  weights follow measured mistakes.

With 72 zones, chance would score 1.4%. `bun run bench my-corpus.jsonl` measures on yours — one
`{"meta": {…}, "target": "…"}` line per card, in chronological order.

## Light, then full

```js
const brain = createRecommender({ key: 'links' });                        // light
const brain = createRecommender({ key: 'links', server: { url, token } }); // full
```

That is the only difference in the app.

**Light** — everything in the browser (IndexedDB by default: `localStorage` caps at 5 MB and
blocks the main thread on every write). Nothing leaves, nothing waits on the network, it works
on a plane.

**Full** — the local model keeps answering; events leave in batches, each with an id, from a
**persisted** queue: a session done offline leaves when the network returns, and resending
learns nothing twice. The server keeps the **events**, not just the model — so history can be
replayed after a change of extractor or model. It warm-starts a new device, and runs what a tab
cannot: embeddings.

```bash
TRIEUR_TOKEN=secret bun run --cwd packages/server start
# plus EMBED_URL / EMBED_MODEL / EMBED_KEY to switch embeddings on
```

## How this was built

This repository was written by Claude (Anthropic), driven from Claude Code, against a design and
a set of constraints given by a human. Saying so matters, because it should change how you read
it:

- **The numbers are the part you can check, so check them.** Every performance claim above comes
  out of `bun run bench`, on a corpus that ships with the repo or on yours. Two of those numbers
  contradicted the intuition that produced the design — crossing features buys almost nothing on
  the real corpus, and the ensemble only beats its members because of how its weights are
  computed. They are in the README because they were measured, not because they were expected.
- **A model is easy to write and hard to be honest about.** The bench is prequential, the
  synthetic corpus deliberately does not leak its labels into card titles (an earlier version
  did, reported 95%, and measured nothing), and every rung is evaluated on the same features so
  the comparison means something.
- **The tests are where the review effort went.** 41 of them, covering the parts you cannot check
  by eye: the multi-zone state machine, offline queueing and event deduplication, model
  serialisation round-trips, and the two failure modes that bite sparse models (unknown features
  handing the win to an empty zone; suggesting at random rather than staying silent).

Judge it on the bench, the tests and the diff, not on who typed it.

## License

MIT.
