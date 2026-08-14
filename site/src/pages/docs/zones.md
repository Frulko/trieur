---
layout: ../../layouts/Doc.astro
title: Zones and gesture
description: Why a zone is a spot rather than a label, and how the stage is carved.
---

## A zone is a spot, not a label

A zone's key comes from its **position**, not from its label. Changing what sits in a zone
therefore does not change the gesture, and the gesture stays memorable. That is the difference
between "press <kbd>d</kbd>" and "find where *dev* went".

```js
zones: [
  { id: 'to-read', label: 'To read' },  // key a
  null,                                  // key s — free zone
  { id: 'toss', label: 'Toss' },         // key d
]
```

A `null` entry is a **free zone**: dropping a card there performs nothing, it calls
`onAssign(index, item)`. Up to the host to ask what should go there, then set its zones again.

## The stage is carved, not just decorated

Each zone owns a **region** of the stage, outlined thinly: the Voronoi diagram of the
positions. For a circle that gives the expected sectors, for a grid it gives cells, for a
custom layout the matching tiling — one formula for all three.

That region is not only a drawing: **the drop aims at the region under the finger**, not at an
approximate angle. What you see is what you touch. (`segments: false` shows only the tiles;
aiming then falls back to angles.)

The computation fits in forty lines — start from the stage rectangle and cut along the
perpendicular bisector of each pair of seeds. No geometry dependency, and `voronoi(points, w, h)`
is exported if you want the polygons.

## Layouts

`layout` accepts `'auto'` (default), `'circle'`, `'radial'`, `'voronoi'`, `'grid'`, `'dock'`, or your own function:

```js
layout: (n, { w, h, clearX, clearY, tile }) => Array.from({ length: n }, (_, i) => ({ x: …, y: … }))

// or hand back the regions too, and the drop targets become exactly those shapes
layout: (n, box) => ({ points: [...], cells: [[[x, y], …], …] })
```

`clearX` and `clearY` are the half-extents to keep free at the centre — the card, plus half a
tile — and `tile` is the measured size of a zone tile. Margins are worth half a tile: a zone
spilling off the stage is unreachable by thumb.

**The clearance is enforced, not merely requested.** Whatever a layout returns — including
yours — is put through two passes: the set is scaled down until every tile fits the stage, then
any seed still inside the card is pushed out to its edge. A tile under the card cannot be seen,
cannot be tapped, and owns a region nobody can reach; a grid with an odd number of cells
produces one every single time.

The clearance is a **rectangle**, not an ellipse: cards are rectangles and so are tiles, and an
ellipse cuts the corners. When the two rules cannot both hold — a tall card on a short stage —
the clearance wins, because a tile poking past the edge is untidy while a tile under the card
is unusable. Give the stage room for the card plus a tile on each side and neither shows.

`'radial'` is a true pie menu: equal wedges around a hole, with the card in the hole. It is the
one layout that hands back its own **regions** rather than letting the Voronoi derive them —
a wedge is not something a set of points can describe. Equal wedges are the point: every choice
is one flick, and every flick is the same length. The price is the four corners of a wide
stage, which is why it is a circle and not an ellipse.

Past eight zones, `'radial'` **grows a second ring**, then a third. A wedge much narrower than
that stops being aimable — a pie menu is a Fitts's-law device, and the target you cannot miss is
one with a wide angle. Each ring is longer than the last, so it holds proportionally more: the
capacity of ring *k* is the capacity of ring 0 scaled by its radius. The geometry decides, not
a magic number.

`'dock'` is the phone layout: the zones line the bottom edge and each owns a full-height
column. A ring of tiles around a card spends most of a tall screen on empty corners; a dock
spends all of it on the card, and turns the gesture into a horizontal flick — the one a thumb
makes best. `'auto'`, the default, picks the dock on a narrow stage that can hold one and the
circle everywhere else.

`'voronoi'` places seeds along a phyllotactic spiral — golden angle, so never collinear — and
then **relaxes them with Lloyd's algorithm**: compute the cells, move each seed to its cell's
centroid, repeat four times. Without that pass the spiral crowds the middle and the mosaic is
pretty and unusable, with the first zones getting postage stamps and the last ones half the
stage. It stays deterministic: same number of zones, same drawing.

## On a small screen

Everything shrinks rather than scrolling: the card is capped at `78vw` and `46dvh`, tiles drop
to 78px, keycaps disappear (a phone has no keyboard, so the row of pixels was spent on
nothing), and the stage takes `62dvh`. That is enough for `'auto'` to fall back to the dock and
still leave the card the room it needs.

The whole sorter also opts out of the browser's own touch behaviour — no text selection, no
double-tap zoom, no long-press callout, no tap highlight — because every one of them fights a
gesture the deck already uses.

## A tile, not a label

The default rendering is a Finder-style folder: a 46px chip filled with the zone's colour
(`color`), or its emoji (`icon`), or its image (`image`); a two-line label; the key at the
foot. `renderZone(zone, el)` takes over if you want something else.

## A card drags as one block

Image, text, padding: everything grabs the card. The browser can no longer start its own image
drag, text does not get selected, a long press does not open the context menu.

**Links and buttons stay clickable**: a press without movement passes the click through, a
movement beyond six pixels takes over for the drag and cancels the click that would have
followed. Form fields keep priority immediately. Without this, a card whose link covers half
its surface would become impossible to sort.

**A release always resolves.** Either the card flies into the zone it was aimed at, all the way
through the genie animation, or it comes back to the centre. There is no third outcome, and
three things make sure of it:

- a `pointercancel` — the system taking the touch back — returns the card rather than filing
  it, because the user never let go;
- `pointerup` is also watched on `window`, since iOS Safari sometimes never delivers it to the
  element that captured the pointer, which used to leave the card frozen mid-air;
- `lostpointercapture` closes the same gap from the other side.

## What keeps it smooth

The gesture loop was written against a 2015 iPad, which is a better judge than a desktop:

- **One callback per frame.** `pointermove` fires faster than the display refreshes and
  arrives in coalesced bursts; the handler is throttled to `requestAnimationFrame`, so a
  frame costs one style write, not five.
- **No measuring during a drag.** The stage rectangle is read once at `pointerdown` and reused.
  Hit-testing against a fresh `getBoundingClientRect()` on every move is a forced layout per
  frame — the single most expensive thing a drag can do.
- **A move that lights nothing new touches no DOM.** Highlighting is compared against what is
  already lit before anything is written.
- **The stage is not rebuilt when nothing changed.** `render()` runs while a card is in flight;
  recomputing the region SVG at that exact moment is the hitch you feel. The layout is skipped
  unless the stage size, the card clearance or the zone count actually moved.
- **Transform and opacity only.** The flying card animates nothing that repaints — no filter,
  no box-shadow — and gets `will-change` only while it is moving, so no layer is kept alive
  for a card sitting still.

## The animations say something

- **Genie effect**: the filed card is sucked into its tile, from the keyboard as from the
  thumb. A card flung off-screen does not say where it landed; this one does.
- **Progressive shrink** while dragging: the card "enters" the zone it is aimed at before
  being released.
- **Dealing down** after a filing, **stacking back from above** after an undo: the entrance
  says where the card comes from.
- **The tile acknowledges receipt** with a small bounce, on the way out and on the way back.

All of it is disabled under `prefers-reduced-motion`.

## Fullscreen

The *Expand* button turns the sorting area into a fullscreen modal; `Esc` or the cross come
back. Deliberately not the Fullscreen API: it would make the page inert, break the links
inside cards, and behaves badly in an iframe.

```js
deck.expand(true);
deck.expanded; // current state
```

## Styling

Everything goes through CSS variables on `.tr`: `--tr-accent`, `--tr-multi`, `--tr-card-bg`,
`--tr-card-w`, `--tr-card-h`, `--tr-radius`, `--tr-line`. The class names are stable if you
would rather rewrite the stylesheet: `.tr`, `.tr-stage`, `.tr-zones`, `.tr-zone`
(`.tr-near`, `.tr-armed`, `.tr-suggest`, `.tr-picked`), `.tr-cards`, `.tr-card`
(`.tr-behind`, `.tr-dragging`, `.tr-genie`), `.tr-bar`.
