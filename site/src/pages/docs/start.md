---
layout: ../../layouts/Doc.astro
title: Getting started
description: Install trieur and run a first sorting session, with or without the model.
---

## Install

```bash
npm i @trieur/core                 # the gesture alone
npm i @trieur/core @trieur/learn   # the gesture plus the model
```

## Sorting, without a model

```html
<link rel="stylesheet" href="node_modules/@trieur/core/trieur.css" />
<div id="sorter"></div>

<script type="module">
  import { Deck } from '@trieur/core';

  new Deck(document.querySelector('#sorter'), {
    items: [
      { id: 1, title: 'One thing' },
      { id: 2, title: 'Another' },
    ],
    zones: [
      { id: 'keep', label: 'Keep' },
      { id: 'toss', label: 'Toss' },
    ],
    renderCard: (item, el) => (el.innerHTML = `<h3>${item.title}</h3>`),
    onSort: (item, zone) => fetch('/file', { method: 'POST', body: JSON.stringify({ item, zone }) }),
  });
</script>
```

That is everything needed to sort. `renderCard` is required in practice: without it cards come
out empty — the library does not know what is inside them, and that is the point.

The `.tr-stage` container is focusable: give it focus (`deck.focus()`) for the keyboard to
respond.

## Adding the model

```js
import { createRecommender } from '@trieur/learn';

const brain = createRecommender({ key: 'links' }); // local model, IndexedDB

new Deck(el, {
  items,
  zones,
  advisor: brain,
  // what the model is allowed to look at — your call
  meta: (link) => ({ domain: link.host, tag: link.tags, title: link.title }),
  renderCard,
  onSort,
});
```

Nothing else to wire: the deck tells the recommender about every filing and every undo, marks
the suggested zone with an outline, and `↵` accepts it.

## The gesture

| Key | Effect |
|---|---|
| a zone letter | files the card there |
| `↵` | accepts the zone the model suggests |
| `space` | skip — the card returns to the back of the pile |
| `⌫` | undo the last filing, and unlearn it |
| `⇧` + several letters | files into several zones at once ([details](../multi/)) |

With a mouse and with a thumb it is the same code (Pointer Events): drag the card towards a
zone, let go. The card shrinks as it approaches — it "enters" the zone it is aimed at before
being released.

## In markup

Zones and the card template can be declared in HTML, without writing any JS:

```html
<script type="module">import '@trieur/core/element';</script>

<trieur-deck id="sorter" layout="voronoi" multi>
  <trieur-zone value="to-read" key="a">To read</trieur-zone>
  <trieur-zone value="toss">Toss</trieur-zone>
  <trieur-zone></trieur-zone><!-- free zone -->

  <template data-card>
    <h3 data-field="title"></h3>
    <img data-field="image" data-attr="src" alt="" />
  </template>
</trieur-deck>
```

JS always wins over markup: a host building zones from data keeps control. See the
[markup demo](../../demos/markup/).
