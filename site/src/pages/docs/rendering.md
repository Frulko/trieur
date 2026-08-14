---
layout: ../../layouts/Doc.astro
title: Rendering cards and zones
description: renderCard and renderZone — the two places where the library hands over.
---

The deck draws a stage, some regions and an empty box per card. Everything inside those boxes
is yours. That is not a limitation to work around; it is the point. The library does not know
what a bookmark, a photograph or a suitor is, and it never has to.

## The card

`renderCard(item, el)` receives the item and an **empty `<article class="tr-card">`**. Fill it
however you like — `innerHTML`, DOM calls, a framework's render function, a `<template>` clone.
It is called once per card, on every render.

```js
new Deck(el, {
  items: photos,
  renderCard: (photo, el) => {
    el.innerHTML = `
      <div class="shot">
        <img src="${photo.thumb}" alt="" loading="lazy" />
        <footer><b>${photo.author}</b><span>${photo.exif.camera}</span></footer>
      </div>`;
  },
});
```

A few things the deck does to the element for you, so you do not have to:

- **images stop being draggable** — otherwise the browser starts its own image drag and steals
  the gesture;
- **text does not select**, long press opens no context menu, and the whole surface is grabbable;
- **links and buttons still work**: a press without movement passes the click through, six
  pixels of movement makes it a drag and cancels the click that would have followed;
- **form fields keep priority** immediately, so an `<input>` inside a card is usable.

Size comes from CSS variables rather than options, because it is a style decision:

```css
.my-deck { --tr-card-w: 300px; --tr-card-h: 420px; --tr-radius: 18px; --tr-card-bg: #fff; }
```

The card is a flex column, so a `flex: 1` image and a fixed footer is the shape you usually
want. Nothing stops you from making the card a full-bleed image with an absolutely positioned
overlay instead.

### States you can style

| Class | When |
|---|---|
| `.tr-card` | every card |
| `.tr-behind` | the one showing under the top card |
| `.tr-dragging` | while the finger holds it |
| `.tr-genie` | in flight towards a zone |

Under `.tr-multi` (the root, while the multi-zone stack is open) the card takes a dashed
outline and a breathing ring — both are plain CSS on `.tr-card`, so you can replace them.

## The zone

`renderZone(zone, el)` receives a placed zone and an **empty `<div class="tr-zone">`**. The
default is a Finder-style folder tile; here is roughly what it does, so you can start from it:

```js
renderZone: (zone, el) => {
  // the colour drives the region behind the tile too, not just the chip
  if (zone.color) el.style.setProperty('--tr-seg', zone.color);
  el.innerHTML = `
    <span class="tr-glyph">${zone.icon ?? folderSvg}</span>
    <span class="tr-label">${zone.label ?? zone.id}</span>
    ${zone.key ? `<kbd>${zone.key}</kbd>` : ''}`;
}
```

The zone you get is the **placed** one, so it carries more than you passed in:

```ts
{ id, label, key, color, icon, image,   // yours
  index,      // position, which is what the key is tied to
  empty,      // a free zone: dropping calls onAssign instead
  angle, pos, // where it ended up, in radians and in pixels from the centre
  cell }      // its region, as a polygon — null when `segments: false`
```

### States you can style

| Class | When |
|---|---|
| `.tr-zone` | every zone |
| `.tr-free` | a `null` zone, waiting to be assigned |
| `.tr-near` | the card is heading this way |
| `.tr-armed` | …and far enough that letting go would file it |
| `.tr-suggest` | the model suggests this one |
| `.tr-picked` | in the multi-zone stack (`data-pick` holds its rank) |
| `.tr-catch` | just received a card, or just gave one back |

The regions get the same three: `.tr-seg`, plus `.tr-near`, `.tr-armed`, `.tr-picked`.

## The layout decides the shape

The zone is a tile because the default layout floats tiles over a Voronoi carving. Choose
`layout: 'radial'` and the same zones become wedges of a pie menu — the tile loses its box (via
`.tr-layout-radial`, a class the deck puts on the root) and the wedge behind it becomes the
button. Try the four in the [zones demo](../../demos/zones/).

A custom layout is a function, and it may describe its own regions:

```js
// two zones, left and right — the whole of the Tinder demo's layout
layout: (n, { w, h, clearX, clearY, tile }) => [
  { x: -Math.max(clearX, w / 2 - 90), y: 0 },
  { x:  Math.max(clearX, w / 2 - 90), y: 0 },
]

// or hand back the regions as well, and the drop targets become exactly those shapes
layout: (n, box) => ({ points: [...], cells: [[[x, y], …], …] })
```

Two guarantees are applied to whatever you return, so you cannot accidentally break the deck:
nothing ends up **under the card** (the clearance is an ellipse around it), and nothing ends up
**off the stage** (the whole set is scaled down until the tiles fit).

## Everything else is a variable

```css
.tr {
  --tr-accent: #4a54f2;   /* suggestion, armed state, focus ring */
  --tr-multi: #f59e0b;    /* the multi-zone mode */
  --tr-line: …;           /* every hairline */
  --tr-card-bg: #fff;
  --tr-card-w: 260px;
  --tr-card-h: 300px;
  --tr-radius: 14px;
}
```

Or throw the stylesheet away. The class names above are the contract; the CSS shipped with
`@trieur/core` is one implementation of it.
