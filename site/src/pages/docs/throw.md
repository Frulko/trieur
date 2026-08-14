---
layout: ../../layouts/Doc.astro
title: The throw
description: Flick a card and it lands where the throw carries it — the physics, the velocity, and the model's thumb on the scale.
---

**Experimental.** `flick: true` turns a release into a throw: the card keeps the speed it had,
travels a little further on its own, and is filed where that carries it. See it in
[Throw, don't drop](/demos/flick/).

A drop asks you to be accurate about a **coordinate** — let go over the right cell. A throw asks
you to be accurate about a **direction**, which the hand is far better at. It is aimed at the two
cases where dropping is a coin toss: zones far from the card, where the drag has to cross the
whole stage, and a mosaic of small adjacent cells, where a few pixels either side of a border
file the card in the wrong folder.

```js
new Deck(el, {
  flick: true,        // throw instead of drop
  flickMs: 170,       // how far ahead the release is projected
  flickDecay: 0.994,  // the same number as a deceleration rate, if you prefer
  flickMin: 0.25,     // px/ms below which a release is an ordinary drop
  flickBias: 0.5,     // how much wider the model's suggestion catches, in tiles
  flickDebug: false,  // draw the vector and the gravity well while tuning
});
```

## Where it comes to rest

The projection is the one a scroll view uses. Velocity decays exponentially — `v(t) = v₀·λᵗ`
with λ per millisecond — and the whole trip integrates to:

```
distance = v₀ · λ / (1 − λ)
```

That fraction has units of milliseconds, which is why the knob is a duration. `flickMs: 170` is
λ ≈ 0.994, between iOS's fast scrolling (0.99) and its normal one (0.998). A card is lighter
than a scroll view and should not sail for half a second.

The projection is capped at the stage diagonal: past the edge every extra pixel aims at the
same zone anyway, and an uncapped throw off a fast trackpad lands in another postcode.

## The speed at lift-off

Not an average of the drag. Velocity is fitted from the last **100 ms** of raw pointer samples
with a weighted quadratic — the strategy Android's `VelocityTracker` uses — because a fling is
usually still *accelerating* when the finger leaves, and a straight average reports the speed of
the gesture's middle rather than its end.

Three details that came from real devices rather than from theory:

- samples are taken on the **raw** `pointermove`, not the frame-throttled one: a flick is over in
  three frames, and averaging across a frame boundary flattens precisely the peak that made it a
  flick;
- the fit is centred on the newest sample, so the slope at zero *is* the lift-off velocity;
- a finger that **rests** before letting go clears the window. A gesture that stopped has thrown
  nothing, however fast it arrived.

## The model's thumb on the scale

The part that feels like magic is borrowed from the iPhone keyboard. After you type `kno`, the
`w` key's *hit area* grows — the key itself does not move a pixel, and you never see it happen.

Here the same trick: the tiles stay where they are, and the zone the model suggests catches
throws that land wide of it, in proportion to how sure it is:

```
cost(zone) = distance(landing, tile) − flickBias × score × tileSize
```

At `flickBias: 0.5`, a suggestion the model is certain of quietly widens by half a tile. At `0`
there is no magic left, only nearest-tile. The debug view draws the well as a dashed circle, so
you can see exactly how much help you are getting.

## Nearest tile, not the region under the point

A drop resolves to the **region** under the pointer, because that is what you are looking at. A
throw resolves to the **nearest tile**, because the landing point is a prediction rather than a
touch: past the edge of the stage there are no regions left to be in, and "the nearest tile in
the direction you threw" always has an answer.

One rule survives both: a zone the gesture was heading **away** from is never a candidate. A
card thrown upwards is not filed into the folder below it, whatever the arithmetic says.

## Tuning it

The right numbers depend on your zones — a dock of six columns wants little reach, a mosaic of
twenty cells wants a lot. Turn `flickDebug` on, put the four values on sliders (the demos do),
and throw thirty cards. What you are looking for:

| Symptom | Knob |
|---|---|
| Careful drags get thrown | raise `flickMin` |
| Throws overshoot into the far zone | lower `flickMs` |
| Distant zones still need a long drag | raise `flickMs` |
| The suggestion catches too much | lower `flickBias` |

Every release, thrown or dropped, is reported so you can measure rather than guess:

```js
el.addEventListener('trieur:release', (e) => {
  const { speed, carried, thrown, zone } = e.detail;
});
```
