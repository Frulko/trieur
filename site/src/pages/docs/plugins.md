---
layout: ../../layouts/Doc.astro
title: Plugins, and what this weighs
description: The two hooks that keep special behaviour out of the core — and the measured cost of everything that stayed in.
---

The deck's job is small and universal: deal a card, place the zones, follow a pointer, file what
the gesture chose. Everything past that — throwing, telemetry, a pad under the thumb, a menu
that follows the cursor — is somebody's *particular* idea about sorting, and none of them belong
in the bundle of a page that does not want them.

## Two hooks

```ts
interface DeckPlugin<T> {
  name?: string;
  setup?(deck): (() => void) | void;                 // once, may touch the DOM, returns a teardown
  aim?(ctx, deck): PlacedZone | null | undefined;    // where is this gesture pointing?
}

new Deck(el, { plugins: [flick(), myPlugin()] });
```

`setup` is for everything a plugin wants to *observe or add*: the `trieur:*` events, `zones`,
`current`, `zoneAt()`, `highlight()`, `commit()` are all public, so a plugin sees what a host
sees. Return a function and the deck calls it on `destroy()`.

`aim` is the one thing events cannot do: decide **before** the deck acts. It runs on every move
and again on release, with the gesture in stage coordinates:

```ts
interface AimContext<T> {
  phase: 'move' | 'end';
  from: Point;   // the card's resting centre
  at: Point;     // where the pointer is
  v: Point;      // velocity, px/ms, fitted over the last 100ms
  dist: number;
  cancelled: boolean;
  fallback: PlacedZone | null;   // what the deck would decide on its own
  item: T | undefined;
}
```

Return a zone to file into, `null` for nowhere, or **`undefined` to keep no opinion** — the
deck's own answer then stands, or the next plugin's. First opinion wins.

There is no registry, no lifecycle beyond setup and teardown, and no way for a plugin to reach
inside. If a plugin needs something the public surface does not have, that is a gap in the
public surface rather than a reason to open the deck up.

## The worked example

[The throw](../throw/) used to be five options on `DeckOptions` and eighty lines inside the
deck. It is now an import:

```ts
import { Deck } from '@trieur/core';
import { flick } from '@trieur/core/flick';

new Deck(el, { plugins: [flick({ ms: 170, min: 0.6, bias: 0.4, debug: false })] });
```

It uses both hooks and nothing else: `setup` adds an SVG layer when `debug` is on and removes it
on teardown; `aim` runs the projection and answers with a zone — or `undefined` when the release
was too slow to be a throw, which leaves an ordinary drop alone. A page that never imports it
carries none of it.

## Special zones

Two kinds are built in, because they are about the *zone* rather than about a behaviour:

```js
{ id: 'inbox' }                  // ordinary
null                             // free: dropping calls onAssign(index) instead
{ id: 'open', disabled: true }   // present, in its place, and not available
```

A disabled zone keeps its position and its key, refuses the card, and is skipped by the model,
by the keyboard, by a tap and by the aim. That matters more than removing it: a menu whose items
move is a menu you have to read again.

Anything more particular than that is a plugin. A zone that only accepts items matching a
predicate, for instance, is six lines:

```ts
const onlyImages: DeckPlugin<File> = {
  aim: (ctx) => {
    const zone = ctx.fallback;
    if (!zone || zone.id !== 'photos') return undefined;   // not our business
    return ctx.item?.type.startsWith('image/') ? undefined : null;
  },
};
```

## What it weighs

Measured with `bun build --minify`, gzipped, on the version this page ships with:

| | min | gzip |
|---|---|---|
| `@trieur/core` — the deck and everything still in it | 33.2 kB | **12.5 kB** |
| …of which the six layouts | 6.4 kB | 3.1 kB |
| `@trieur/core/flick` — the throw, as a plugin | 1.8 kB | 1.0 kB |
| `trieur.css` | 27.4 kB | **8.2 kB** |

No dependencies, in any of it. A page that uses the deck pays about **21 kB gzipped**, which is
roughly one photograph.

Where that goes, if you are counting:

| Inside the deck | share of the source |
|---|---|
| multi-zone: the stack, the pad, the shift latch | 118 lines (9%) |
| two piles | 31 lines |
| fullscreen | 22 lines |
| touch preview (play / stop) | 13 lines |
| keyboard without focus | 13 lines |
| the page freeze under a drag | 8 lines |
| the plugin seam itself | 7 lines |
| tap-to-file | 2 lines |

| Inside the stylesheet | gzip |
|---|---|
| zone tiles | 1.9 kB |
| the card pile and its animations | 2.0 kB |
| base and variables | 1.1 kB |
| narrow-stage rules | 1.1 kB |
| the play button and its scrim | 1.0 kB |
| fullscreen | 0.9 kB |
| the held pad | 0.7 kB |
| the radial menu | 0.6 kB |
| everything else | 0.9 kB |

Two honest conclusions from those tables. First, the **stylesheet is the heavier half of the
optional weight** — if you ship one layout and no multi-zone, a CSS pass over the class names
you actually use saves more than any JavaScript refactor would. Second, inside the JavaScript
there is exactly one block worth extracting next — multi-zone — and it would need two more
hooks: one for keys, one for drawing the badges. Those hooks do not exist because nothing has
asked for them yet, and a seam added on speculation is a seam in the wrong place.
