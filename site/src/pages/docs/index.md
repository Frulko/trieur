---
layout: ../../layouts/Doc.astro
title: Overview
description: What trieur does, and how the three packages split the work.
---

trieur is two things that belong together but install separately:

1. **a gesture** — a pile of cards, zones around it, one movement per card;
2. **a model** — which learns, on every filing, where the next card will probably go.

The gesture without the model is pleasant manual sorting. The model without the gesture is a
classifier with no interface. Together the loop closes: filing trains, and training shortens
the next filing — until `↵` is enough.

## Three packages

| Package | Role | Dependencies |
|---|---|---|
| `@trieur/core` | the stage, the zones, the gesture, the animations | none |
| `@trieur/learn` | features, models, local storage, the protocol | none |
| `@trieur/server` | events, replay, embeddings | Bun + SQLite (from the runtime) |

No bundler is required: these are ES modules, published as JavaScript with their type
declarations. A `<script type="module">` is enough.

## The principles that explain the rest

**The library knows nothing about your domain.** No "bookmark", no "folder", nothing of the
sort in the code or in the CSS class names. It sorts opaque objects into opaque zones. What
knows the subject lives in the host: `renderCard` draws, `onSort` performs, `meta` decides
what the model is allowed to look at.

**The host decides, and may refuse.** `onSort` is asynchronous and may fail — a rejection puts
the card back. The library never mutates anything outside its own pile.

**The prediction never blocks the gesture.** The card is already under the finger when a zone
has to be suggested. The local model answers in microseconds; the server is only consulted
when the local one stays silent, with a short deadline, and its silence prevents nothing.

**Say nothing rather than guess.** Too few examples, or no recognised feature, and `predict()`
returns an empty list. A bad suggestion costs more than a missing one: it erodes trust in
every suggestion that follows.

**The weights are measured, not decreed.** When several models vote, their weight comes from
their observed accuracy, measured before learning. No magic coefficient anywhere in the code.

## Where to start

- [Getting started](./start/) — install and run a first sorting session.
- [Zones and gesture](./zones/) — why a zone is not a label.
- [Several zones at once](./multi/) — one card, several folders.
- [Keyboard and gestures](./keyboard/) — every key, every gesture, and the phone bargain.
- [The throw](./throw/) — flick a card and let the physics land it.
- [Two hands, two piles](./piles/) — one stage, one set of zones, two thumbs.
- [Recipes](./recipes/) — verbs as zones, a pile that writes itself, a game loop.
- [Plugins & weight](./plugins/) — the two hooks, and what every kilobyte is doing.
- [The model ladder](./model/) — from Bayes to embeddings, and when to climb a rung.
- [In an app](./integration/) — light mode, full mode, offline.
