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
and the host is the only one who knows that. Off, the bar button and the pad are hidden, and
`⇧` changes nothing.

## Four ways in, one state

| | How | How it ends |
|---|---|---|
| **Hold Shift** | hold <kbd>⇧</kbd>, press several zone letters | releasing <kbd>⇧</kbd> files |
| **Tap Shift** | tap <kbd>⇧</kbd> on its own — the shortcut | the mode latches; tap again to leave, or to file a stack |
| **Hold the pad** | press and hold the round pad with a thumb | letting go of the pad files |
| **Hold the card** | rest a finger on the card for `holdDelay` ms | letting go of that finger files |

They all end up in the same state, so they can never disagree — and the mode remembers *how*
it was opened, which is what stops a stray <kbd>⇧</kbd> release from firing a stack you
latched from the bar.

The tap-Shift shortcut is unambiguous by construction: any key pressed while <kbd>⇧</kbd> is
down marks the press as "used", so only a genuinely bare tap latches.

## On a touch screen

**The pad** is a translucent round button at the bottom corner of the stage, like a virtual
gamepad button — the thumb that has no Shift key. `multiPad` decides: `'auto'` (default) shows
it only on coarse pointers, `'left'` / `'right'` force a side, `false` removes it.

**Sweeping.** Once the mode is on, keep the finger down and drag the card across the stage:
every region it reaches joins the stack. Sweeping back over a zone does not remove it —
letting go is the confirmation, and an accidental second pass must not undo a deliberate first
one. Between zones the card returns to the centre instead of flying away, because it is
pointing, not leaving.

So the whole gesture on a tablet is: rest the finger, feel the card outline light up, sweep
across two or three zones, let go.

## Escape hatches

- <kbd>Esc</kbd> drops the stack without filing anything.
- Tapping a stacked zone again removes it (tiles are tappable while the mode is on).
- <kbd>↵</kbd> files the stack, exactly like the bar button.
- The **first** zone stacked stays the primary one — badge `1` — which is what most hosts treat
  as the main folder. The card's genie animation lands in it; the others just bounce.

## How it reads

The card takes a dashed amber outline with a ring that breathes, each stacked zone gets a
numbered badge, and its region stays lit.

Amber rather than red, deliberately: red reads as error or destruction, and stacking a card
into several folders is neither. Dashed rather than marching ants: dashes that travel cannot
follow a border radius without artefacts. The ring animates **opacity only** — a breathing
box-shadow repaints the card sixty times a second for nothing, which is exactly what an older
tablet cannot afford.

Everything is a CSS variable (`--tr-multi`) and a class (`.tr-multi` on the root, `.tr-picked`
on zones and regions, `.tr-on` on the pad), so a host can restyle the mode entirely. The
breathing stops under `prefers-reduced-motion`.

## What the host receives

```js
new Deck(el, {
  items, zones,
  multi: true,
  multiPad: 'auto',   // 'left' | 'right' | false
  holdDelay: 420,     // 0 disables hold-to-open
  onSort:     (item, zone)  => api.file(item.id, [zone.id]),
  onSortMany: (item, zones) => api.file(item.id, zones.map((z) => z.id)),
  onUndoMany: (item, zones) => api.unfile(item.id, zones.map((z) => z.id)),
});
```

One zone still goes through `onSort(item, zone)` — including a stack that ended up with a
single zone in it. Several go through `onSortMany(item, zones)`. Without `onSortMany`, the
library falls back to calling `onSort` once per zone: fine for a local update, not fine when
the filing has to be atomic, since a failure on the third call leaves the first two done.

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
