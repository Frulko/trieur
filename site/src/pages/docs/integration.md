---
layout: ../../layouts/Doc.astro
title: In an app
description: Light and full mode, storage, offline, and how an app talks to the model.
---

An app handles exactly one object: the **recommender**. It exposes what the deck expects, plus
what it takes to display a state and to lose nothing on close.

```ts
interface Recommender {
  best(meta, zones, minScore?): Promise<Prediction | null>;  // the zone, if it stands out
  suggest(meta, zones): Promise<Ranked[]>;                   // the full ranking
  record(r: SortRecord): Promise<void>;                      // a filing happened
  forget(r: SortRecord): Promise<void>;                      // it is being undone
  stats(): Promise<Stats>;
  flush(): Promise<void>;                                    // write what is pending
  destroy(): Promise<void>;                                  // write, then drop listeners
}
```

The deck calls `best`, `record` and `forget` on its own. The rest is for your interface.

## Light mode

```js
const brain = createRecommender({ key: 'links' });
deck.setOptions({ advisor: brain });
```

Everything stays in the browser. No data leaves, no network latency, it works on a plane. For
many apps this is the only mode ever needed.

**Where the model lives.** `autoStore()` picks IndexedDB when available, otherwise
`localStorage`, otherwise memory. IndexedDB by default for two reasons: `localStorage` caps out
around 5 MB, and above all it is *synchronous* — every write blocks the main thread, mid-sort.
A kNN corpus of fifteen hundred cards plus a crossed vocabulary goes well past the limit.

```js
import { idbStore, localStore, memoryStore } from '@trieur/learn';
createRecommender({ key: 'links', store: localStore('my-app:') });
```

Writes are batched (`saveDelay`, 800 ms), and `pagehide` triggers a `flush()`: closing the tab
does not cost the last few filings.

## Full mode

```js
const brain = createRecommender({
  key: 'links',
  server: { url: 'https://trieur.example.com', token: '…' },
});
```

That is the only difference in the app. What changes underneath:

- **The local model keeps answering.** It is instant and works offline. The server is only
  asked when the local model stays silent — typically the first few cards, or a card with no
  recognised feature. That is exactly where embeddings help, and the only moment when waiting
  on the network is justified (400 ms at most, tunable).
- **Events leave in batches**, each with an id. The queue is **persisted**: a session done
  offline leaves when the network returns, and resending learns nothing twice.
- **Warm start.** On a brand-new device, the server's model is pulled if it knows more than the
  local one.

```js
brain.pending;             // events not yet accepted by the server
await brain.flush();       // force a push
await brain.serverStats(); // what the server sees, across all devices
```

See the [light vs full demo](../../demos/server/), which really does cut the network.

## What the model is allowed to look at

`meta(item)` is the only place where you decide what information enters the model. It is a
useful boundary: what is not in `meta` is never learned, never serialised, never sent to the
server.

```js
meta: (link) => ({
  domain: link.host,      // one feature, as-is
  author: link.author,    // same
  tag: link.tags,         // one feature per element
  title: link.title,      // one feature per word
})
```

Full mode adds the card's **text** to the event — and only that — when `meta` contains `title`,
`text`, `description` or `excerpt`, because embeddings need it. An explicit `text` in `record()`
wins.

## Plugging something else in

`advisor` does not require `@trieur/learn`: any object with `best(meta, zones)` will do,
including a network call to your own classifier.

```js
deck.setOptions({
  advisor: {
    async best(meta, zones) {
      const r = await fetch('/api/classify', { method: 'POST', body: JSON.stringify({ meta, zones }) });
      return r.ok ? await r.json() : null; // { id, score, why: [] }
    },
    record: (r) => navigator.sendBeacon('/api/filings', JSON.stringify(r)),
  },
});
```

The deck accepts a promise and **drops the answer if the card changed in the meantime**: a slow
server never makes a suggestion appear on the wrong card.

## Events

Every action also emits a `CustomEvent` on the container, for hosts that prefer events to
callbacks:

`trieur:sort`, `trieur:undo`, `trieur:skip`, `trieur:assign`, `trieur:suggest`, `trieur:pick`,
`trieur:expand`, `trieur:empty`, `trieur:error`.

```js
deck.root.addEventListener('trieur:sort', (e) => {
  const { item, zone, zones, predicted, correct } = e.detail;
  if (predicted && !correct) console.log('the model suggested', predicted);
});
```
