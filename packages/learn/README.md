# @trieur/learn

**Online** learning of where things get filed: no training phase, the model learns from the card
you just filed and serialises to JSON. No dependencies.

```bash
npm i @trieur/learn
```

```js
import { createRecommender } from '@trieur/learn';

const brain = createRecommender({ key: 'links' });                        // light
const brain = createRecommender({ key: 'links', server: { url, token } }); // full

deck.setOptions({ advisor: brain });
```

## The ladder

| Rung | What it buys | What it costs |
|---|---|---|
| `Bayes` | learns from the 3rd example, explains itself | assumes features are independent |
| `crosses()` | `domain×tag` exposes the combination, without changing model | the vocabulary explodes |
| `Linear` | learned weights; copes with correlated features | a step size — tuned by AdaGrad |
| `Knn` | the best cold start | the corpus has to be kept |
| `Ensemble` | makes them vote, weighted by **measured** accuracy | three models to feed |

They all share the same interface and the same features, so they can be compared:

```bash
bun tools/bench.ts my-corpus.jsonl   # prequential evaluation, top-1 / top-3
```

## Also in the package

- `tokens`, `crosses`, `only`, `pipe` — from metadata to sparse features.
- `memoryStore`, `localStore`, `idbStore`, `autoStore` — where the model lives.
- `@trieur/learn/protocol` — the wire types shared with
  [`@trieur/server`](https://github.com/Frulko/trieur/tree/main/packages/server).
- `@trieur/learn/bench` — `evaluate()` and `synth()`, to measure from inside your app.

Full documentation: [frulko.github.io/trieur/docs/model](https://frulko.github.io/trieur/docs/model/).

MIT.
