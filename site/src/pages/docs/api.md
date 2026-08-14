---
layout: ../../layouts/Doc.astro
title: Reference
description: Options, methods and types of @trieur/core and @trieur/learn.
---

## `new Deck(root, options)`

| Option | Default | Role |
|---|---|---|
| `items` | `[]` | the pile to sort; the first element is the top card |
| `zones` | `[]` | zones: `{ id, label?, key?, color?, icon?, image? }`, or `null` for a free zone |
| `renderCard(item, el)` | — | draws the card (required in practice) |
| `renderZone(zone, el)` | folder tile | draws a zone |
| `meta(item)` | the item | what the model is allowed to look at |
| `advisor` | — | a `Recommender`, or anything with `best()` |
| `minConfidence` | `0.45` | minimum score for a zone to be suggested |
| `layout` | `'auto'` | `'auto'`, `'circle'`, `'radial'`, `'voronoi'`, `'grid'`, `'dock'`, or `(n, box) => …` |
| `segments` | `true` | carve the stage into regions and aim at the region |
| `keys` | `'asdfghjkl…'` | keys handed to zones, in order |
| `threshold` | `90` | drag distance past which the drop is armed, in px |
| `multi` | `false` | allow a card to be filed into several zones ([details](../multi/)) |
| `multiPad` | `'auto'` | the held pad: `'auto'` (dynamic on touch), `'dynamic'`, `'left'`, `'right'`, `false` |
| `holdDelay` | `420` | ms a finger must rest on a card to open the stack; `0` disables it |
| `touchFullscreen` | `true` | on touch, a tap opens the deck fullscreen instead of dragging ([why](../keyboard/#on-a-phone)) |
| `piles` | `1` | **experimental** — deal several piles side by side, sharing the zones |
| `flick` | `false` | **experimental** — throw instead of drop: the release's velocity picks the zone |
| `flickMs` | `170` | how far ahead a throw is projected, in ms of travel |
| `flickMin` | `0.25` | px/ms below which a release is an ordinary drop |
| `flickDebug` | `false` | draw the throw vector and where it lands |
| `text` | `en` | labels (`fr` provided, or your own) |
| `onSort(item, zone)` | — | performs the filing; may be `async`, a rejection cancels |
| `onSortMany(item, zones)` | — | files into several zones at once |
| `onUndo(item, zone)` | — | undoes the last filing |
| `onUndoMany(item, zones)` | — | undoes a multi-zone filing |
| `onSkip(item)` | — | card pushed to the back of the pile |
| `onAssign(index, item)` | — | drop on a free zone |
| `onEmpty()` | — | the pile is empty |

### Methods

```js
deck.setItems(items)        // replaces the pile
deck.setZones(zones)        // replaces the zones (reassigns the keys)
deck.setOptions(patch)      // changes part of the configuration
deck.commit(zone, fling?)   // files the top card (what a key press does)
deck.commitMany(zones?)     // files into several zones (defaults to the current stack)
deck.skip()                 // pushes the card to the back of the pile
deck.undo()                 // undoes the last filing
deck.suggest()              // recomputes the suggestion
deck.expand(on)             // fullscreen
deck.layout(force?)         // re-places the zones (skipped when nothing moved; force to insist)
deck.zoneAt(x, y)           // zone under a screen point
deck.destroy()              // removes everything from the DOM, and the listeners

deck.current                // top card (of the active pile)
deck.active                 // which pile the keyboard talks to; assignable
deck.zones                  // placed zones (index, key, angle, pos, cell)
deck.prediction             // { id, score, why } or null
deck.picking                // the multi-zone stack, in pick order
deck.multi                  // whether multi-zone mode is on
deck.expanded               // fullscreen state
```

## `<trieur-deck>` and `<trieur-zone>`

Attributes of `<trieur-deck>`: `layout`, `keys`, `threshold`, `min-confidence`, `segments`,
`multi`.

Attributes of `<trieur-zone>`: `value` (the id; absent means a free zone), `key`, `label`
(falling back to the tag's text), `color`, `icon`, `image`.

JS properties: `.options`, `.items`, `.zones`, `.deck`, `.current`, `.prediction`, `.picking`.
Methods: `.skip()`, `.undo()`, `.focus()`.

Added, changed or removed on the fly, a zone follows — **without interrupting the session**.

## Models

```ts
interface Model {
  readonly kind: string;
  readonly examples: number;
  learn(features: string[], target: string, weight?: number): void;
  predict(features: string[], targets: string[]): Ranked[];
  toJSON(): ModelJSON;
}
```

| Class | Options |
|---|---|
| `Bayes` | `alpha` (0.4), `minExamples` (3) |
| `Linear` | `lr` (0.5), `margin` (1), `minExamples` (3), `maxVocab` (40,000) |
| `Knn` | `k` (12), `capacity` (1500), `probe` (24), `minExamples` (1) |
| `Ensemble` | `new Ensemble([…models])` |

`modelFromJSON(json)` rebuilds any of them; unknown JSON yields `defaultModel()`.

## Features

```js
tokens(meta)                              // metadata → features
crosses([['domain', 'tag']], max = 4)     // adds the crosses
only('domain', 'tag')                     // keeps only those keys
pipe(tokens, crosses([…]), only(…))       // chains them
defaultFeatures                            // tokens + domain/author/host × tag crosses
```

## Recommenders

```js
createRecommender({ key, model?, features?, store?, minConfidence?, saveDelay?, server? })
```

No `server` → `LocalRecommender`. With `server` → `HybridRecommender`, which additionally
exposes `pending`, `warm()` and `serverStats()`.

## Storage

`memoryStore()`, `localStore(prefix)`, `idbStore(db, store)`, `autoStore()`.

```ts
interface Store {
  load<T>(key: string): Promise<T | null>;
  save(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
}
```

## Bench

```js
import { crossed, evaluate, synth } from '@trieur/learn/bench';
evaluate(name, model, extractor, cards); // → { top1, top3, silent, vocab, ms, asked }
```

## Geometry

`voronoi(points, w, h)` returns the polygons, `inPolygon(poly, x, y)` tests membership, and
`layouts.auto | circle | radial | voronoi | grid | dock` are the built-in layouts.

Two of them are parameterised, and the factories are exported:

```js
import { radialLayout, dockLayout } from '@trieur/core';

radialLayout({ sweep: Math.PI, start: -Math.PI / 2 })  // a half menu, opening right
radialLayout({ sweep: Math.PI / 2, start: Math.PI })   // a quarter, top-left
radialLayout({ ringGap: 14 })                          // air between the rings
dockLayout({ split: true })                            // top *and* bottom edge
dockLayout({ rows: 2 })                                // two rows; by default, as many as fit
```

An arc rather than a full circle is what lets a radial menu live against an edge, or beside a
thumb, without wedges pointing off the screen — the capacity of each ring scales with the arc
it actually covers. A dock wraps on its own when the tiles no longer fit across the stage: six
tiles on a phone become two rows of three rather than six tiles spilling off both sides.

A layout returns points, or `{ points, cells }` when it wants to describe its own regions —
that is how `'radial'` draws wedges instead of letting the Voronoi decide.

`clearCentre(points, box)` pushes any seed inside the card out to its edge, and
`fitToStage(points, box)` scales the set down until the tiles fit. `resolveLayout()` applies
both to every layout, including yours. `clearanceAt(angle, box)` is the rule they use: the ray
hitting the card's box inflated by half a tile — a rectangle, not an ellipse, because a tile at
45° sat outside an ellipse and still overlapped the card.

The box a layout receives is `{ w, h, cardW, cardH, clearX, clearY, tile }`: the stage, the
card, the half-extents to keep clear (the card plus half a tile) and the measured size of a
tile. `clampToStage(points, box)` pulls points back inside one axis at a time — that is what
runs on a layout that draws its own regions, since scaling would slide the labels out of their
own wedges.

## Keyboard

| Key | Effect |
|---|---|
| a zone letter | files the card there |
| `⇧` + letters | stacks zones; releasing `⇧` files them |
| `⇧` tapped alone | latches multi-zone mode, or files a pending stack |
| `↵` | files a pending stack, otherwise accepts the suggestion |
| `space` | skip |
| `⌫` | undo, and unlearn |
| `Esc` | drops the stack, then leaves fullscreen |

The full reference, gestures included, is [Keyboard and gestures](../keyboard/).

On a touch screen, **double-tapping a card accepts the suggestion** — the equivalent of `↵`,
which a thumb cannot press. The browser's own double-tap zoom is turned off across the sorter,
so the two never fight.
