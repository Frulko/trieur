---
layout: ../../layouts/Doc.astro
title: Several zones at once
description: Filing one card into several zones — keyboard, thumb, and what the host receives.
---

Some zones are mutually exclusive: keep or discard. Folders and tags are not — a link about
Rust tooling belongs in *dev* and in *to read*. Turn `multi` on and one card can be **stacked**
into several zones before it leaves.

```js
new Deck(el, { items, zones, multi: true, onSortMany });
```

It is **off by default**, on purpose: stacking only makes sense when zones are not exclusive,
and the host is the only one who knows that. Off, the bar button is hidden and `⇧` changes
nothing.

## Two ways in

**With a keyboard.** Hold <kbd>⇧</kbd> and press several zone letters. Releasing <kbd>⇧</kbd>
files the card into all of them, in the order they were picked. The hold *is* the mode:
nothing to turn on, nothing to turn off.

**With a thumb.** Tap **Multiple zones** in the bar and the mode latches. Then tap the tiles —
they become tappable — or flick the card at them, it comes back to the centre each time. The
same button becomes the confirmation, labelled with the count.

Both paths converge on the same state, so the two never disagree. A stray <kbd>⇧</kbd> release
does not file a latched stack: only the mode that <kbd>⇧</kbd> opened is closed by
<kbd>⇧</kbd>.

## Escape hatches

- <kbd>Esc</kbd> drops the stack without filing anything.
- Pressing the same zone twice removes it from the stack.
- <kbd>↵</kbd> files the stack, exactly like the bar button.
- The **first** zone stacked stays the primary one — badge `1` — which is what most hosts
  treat as the main folder. The card's genie animation lands in it; the others just bounce.

## How it reads

The card gets a dashed amber outline whose halo breathes, and each stacked zone gets a
numbered badge plus a lit region.

Amber rather than red, deliberately: red reads as error or destruction, and stacking a card
into several folders is neither. Dashed rather than marching ants: dashes that travel cannot
follow a border radius without artefacts.

Everything is a CSS variable (`--tr-multi`) and a class (`.tr-multi` on the root,
`.tr-picked` on zones and regions), so a host can restyle the mode entirely. The breathing is
disabled under `prefers-reduced-motion`.

## What the host receives

```js
new Deck(el, {
  items, zones,
  multi: true,
  onSort:     (item, zone)  => api.file(item.id, [zone.id]),
  onSortMany: (item, zones) => api.file(item.id, zones.map((z) => z.id)),
  onUndoMany: (item, zones) => api.unfile(item.id, zones.map((z) => z.id)),
});
```

One zone still goes through `onSort(item, zone)`. Several go through
`onSortMany(item, zones)`. Without `onSortMany`, the library falls back to calling `onSort`
once per zone — fine for a local update, not fine when the filing has to be atomic: if the
third call fails, the first two already happened.

Events carry both shapes, so a listener never has to branch:

```js
deck.root.addEventListener('trieur:sort', (e) => {
  const { zone, zones, predicted, correct } = e.detail;
  // zone === zones[0], the primary one
});
deck.root.addEventListener('trieur:pick', (e) => {
  // the stack changed: e.detail.zones, e.detail.multi
});
```

`deck.picking` reads the current stack, `deck.multi` whether the mode is on, and
`deck.commitMany(zones)` files programmatically.

## What the model learns

**One example per zone.** A card filed in three places teaches three times, and undoing
unlearns all three.

That is the right behaviour for folders — "this kind of link goes in dev" and "this kind of
link goes in to-read" are two independent habits — and it is an approximation worth knowing
about: a genuine multi-label model would learn the *combination* as such. The suggestion stays
single-zone, since suggesting a set would need a confidence per subset.
