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

`layout` accepts `'circle'` (default), `'voronoi'`, `'grid'`, or your own function:

```js
layout: (n, { w, h, clear }) => Array.from({ length: n }, (_, i) => ({ x: …, y: … }))
```

`clear` is the radius to keep free at the centre so zones do not sit under the card. Margins
are worth half a tile: a zone spilling off the stage is unreachable by thumb.

The `'voronoi'` layout places seeds along a phyllotactic spiral — golden angle, so never
collinear. The resulting cells form an irregular mosaic rather than a pie chart. It is
deterministic: same number of zones, same drawing.

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
