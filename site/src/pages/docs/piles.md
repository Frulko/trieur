---
layout: ../../layouts/Doc.astro
title: Two hands, two piles
description: Deal more than one pile onto the same stage, sharing the zones and the model.
---

**Experimental.** `piles: 2` deals two cards side by side on one stage, sharing one set of
zones — a big tablet held in two hands, one pile per thumb. See it in
[Two piles, two hands](/demos/two-hands/), which puts it beside the other way of building the
same idea.

```js
const deck = new Deck(el, { items, zones, piles: 2 });

deck.active;      // which pile the keyboard and the suggestion are talking about
deck.active = 0;  // …or say so yourself
```

## A pile keeps its card

The rule that makes it usable: **a pile holds on to its card until that card actually leaves.**
Filing on the left never shuffles what the right hand was already moving towards.

That sounds obvious until you build it the other way. Deal from one array by position and the
moment the left pile files, every card shifts down one — including the one under the right
thumb, mid-gesture. The deck keeps a *lane* per pile instead: the lane holds an item, the queue
is whatever no lane holds, and only an empty lane draws from it.

`setItems()` clears the lanes, because a host handing over a different pile means the top of the
new list, not the cards that happened to be in hand.

## What follows the hand

Touching a card makes its pile **active**, and the active pile is the one that:

- the keyboard files (`a`, `s`, `d`… act on it);
- the model advises — the suggestion outline moves with it;
- `undo` puts a card back into.

The active pile also wears a ring, because a suggestion pointing at a zone is meaningless if you
cannot tell which card it is about.

## Two piles or two decks

The demo offers both, and they are genuinely different bargains:

| | One board, `piles: 2` | Two decks, one queue |
|---|---|---|
| Zones | one set, shared | one set each, duplicated |
| Screen | half the furniture | two of everything |
| Aim | both hands throw at the same targets | each hand aims at its own *dev* |
| Layouts | one | independent |
| Code | an option | a dozen lines of host code |

Two decks need nothing from the library — one queue, one recommender, two `Deck` instances, and
a `trieur:sort` listener that tops each one back up. If that is what you want, build it; the
library's job there is to stay out of the way.

## Where it stops

Two piles need two thumbs and a tablet's width. Below that the demo deals one, and you should
too: `piles: window.innerWidth < 820 ? 1 : 2`. The library will happily run four — whether a
person can is the open question, and the answer is probably two.
