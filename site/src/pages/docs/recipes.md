---
layout: ../../layouts/Doc.astro
title: Recipes
description: The patterns behind the demos — verbs as zones, a pile that writes itself, a game loop, a refused filing.
---

Every demo on this site is a pattern rather than a decoration. These are the four that come up
again the moment you build something real.

## Zones that are verbs

Half a mailbox's zones are folders — *clients*, *finance*, *team* — and the other half are
verbs: *reply*, *spam*, *delete*. The gesture is identical; what happens afterwards is not, and
that difference lives entirely in the host.

```js
onSort: async (mail, zone) => {
  if (zone.id === 'reply') {
    const sent = await compose(mail);          // opens a panel, resolves when sent
    if (!sent) throw new Error('cancelled');   // …and the card comes home
    return;
  }
  if (zone.id === 'trash') return api.trash(mail.id);
  if (zone.id === 'spam') return api.spam(mail.id);
  return api.move(mail.id, zone.id);
}
```

Two things worth stealing from [the mailbox demo](/demos/mail/): a **rejected `onSort` returns
the card**, which is exactly what a cancelled compose box should do; and action zones are drawn
with a dashed border, because a hole in the wall should not look like a folder.

## A pile that writes itself

In [the flashcards demo](/demos/study/) nothing is ever "filed": grading a card schedules it,
and the schedule decides whether it comes back in this session or in nine days.

```js
onSort: (card, zone) => {
  const graded = schedule(card, GRADE[zone.id]);            // SM-2
  if (graded.interval === 0) {
    const rest = deck.items.filter((c) => c.id !== card.id);
    deck.setItems([...rest.slice(0, 3), graded, ...rest.slice(3)]);  // back, three cards later
  } else {
    scheduled.push(graded);                                  // out of today's pile
  }
}
```

The zone labels are rewritten for every card with `setZones()` — *Easy* on a card you have seen
four times is not the same promise as *Easy* on a new one. Same keys, same positions, only the
numbers move.

That demo also passes **no `advisor` at all**, and says why: a flashcard's grade does not live
in the card, it lives in your head. Knowing when not to predict is part of the design.

## A card that changes what it says

`render()` deliberately keeps a card it already has — that is what stops the pile blinking every
time one leaves. So when a card's *content* changes (an answer revealed, a message expanded, a
row marked read), tell the deck:

```js
shown.add(card.id);
deck.refresh();   // same elements, renderCard called again
```

And when the change is a state the host owns, remember the card is ordinary DOM: the mailbox's
*Read the rest* is a `<button>` inside the card that expands the body without ending the drag.
That works because the gesture only takes the pointer once it has actually moved.

## A game loop

[Reigns](/demos/reigns/) is two zones and a pile that never ends. The card is a decision, the
zones are the two answers, and `onSort` applies the consequences — including refusing the move:

```js
onSort: (decree, zone) => {
  apply(decree[zone.id].effects);
  if (dead()) throw new Error('the reign ends');   // the card stays; the host shows the ending
  deck.setItems([...deck.items, nextDecree()]);    // the pile refills itself
}
```

[Tinder](/demos/tinder/) is the same shape with a different budget: two zones, a threshold low
enough that a flick is enough, and a card that is mostly photograph. Neither needed a library
feature — they needed a library that gets out of the way.

## A menu at the cursor

A marking menu is a sorting gesture with a pile one item deep. [The cursor menu](/demos/menu/)
puts a 260px deck at the pointer, gives it a card the size of a full stop, and lets the wedges
be actions:

```js
const menu = new Deck(el, {
  zones: ACTIONS,
  layout: radialLayout({ maxPerRing: 6 }),
  tapZones: true,            // click the wedge…
  threshold: 40,             // …or flick towards it
  renderCard: () => {},      // the card is a dot: the pointer is the card
  onSort: (file, zone) => run(zone.id, file),
});

el.style.left = (e.clientX - 130) + 'px';
menu.setItems([file]);
```

Nothing there is a special mode. What changes is the pile (one item) and where the aim starts
(the pointer, not the middle of a stage).

## Choosing the shape

| You have | Start with |
|---|---|
| A phone, and a handful of zones | `layout: 'dock'` — a tray at the thumb end |
| Eight or more zones, a wide screen | `layout: 'radial'` — one flick per choice |
| Zones that are not mutually exclusive | `multi: true`, and read [Several zones at once](../multi/) |
| Targets small enough to miss | `flick: true`, and read [The throw](../throw/) |
| A tablet held in two hands | `piles: 2`, and read [Two hands](../piles/) |
| Zones on screen and a mouse in hand | `tapZones: true` — point at the answer |
