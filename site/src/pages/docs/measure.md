---
layout: ../../layouts/Doc.astro
title: Measuring
description: The prequential bench — on the synthetic corpus, or on yours.
---

A table on a blog does not tell you which model works on **your** data. So the bench ships with
the library, and is exported so it can run inside your app.

## The protocol

**Prequential**: test, then learn. Every card is first shown to the model, which has never seen
it; we note whether it was right; only then does it learn.

No train/test split to rig, no leakage possible, and the number you get is exactly what the
user experiences: the accuracy of a model discovering the corpus as it goes. The zones offered
are the ones **already encountered** — we do not ask the model to guess a folder that does not
exist yet.

## From the command line

```bash
bun tools/bench.ts                  # synthetic corpus, 2000 cards
bun tools/bench.ts corpus.jsonl     # yours
bun tools/bench.ts corpus.jsonl 500 # the first 500
```

One JSONL line per card, in chronological order:

```json
{"meta": {"domain": "github.com", "tag": ["rust","cli"], "title": "…"}, "target": "dev"}
```

Output:

```
3412 cards, 72 zones — corpus.jsonl

model                  top-1     top-3   silent    vocab      ms
────────────────────────────────────────────────────────────────
bayes                 33.1 %    57.1 %     0.7 %   49221     490
bayes + crosses       33.6 %    57.4 %     0.7 %   65385     449
linear                32.5 %    53.2 %     0.7 %   32789     796
linear + crosses      32.8 %    54.7 %     0.7 %   38797     911
knn                   32.1 %    54.4 %     0.7 %   27421    4420
knn + crosses         31.8 %    54.7 %     0.7 %   34798    5253
ensemble              35.8 %    60.9 %     0.7 %   49221   12158 ←
ensemble + crosses    35.3 %    61.3 %     0.7 %   65385   13698
```

That corpus is real: 3,412 links filed by hand across 72 folders. Two findings nobody would
have guessed:

- **Crossing buys almost nothing here** (+0.5 point), while it is worth seven points on the
  synthetic corpus. Marginal signals — domain, author — dominate in that corpus. Crossing pays
  when interactions exist, not on principle.
- **The ensemble beats each of its members**, which is not automatic: it only does so because
  its weights follow measured mistakes.

With 72 zones, a random draw would score 1.4%: 35.8% top-1 and 61% top-3 means the right folder
suggested first one time in three, and present in the short list six times in ten.

## Inside an app

```ts
import { Bayes, Ensemble, Knn, Linear, tokens } from '@trieur/learn';
import { crossed, evaluate, synth } from '@trieur/learn/bench';

const cards = myPastFilings(); // [{ meta, target }, …] in order
const a = evaluate('bayes', new Bayes(), tokens, cards);
const b = evaluate('ensemble + crosses', new Ensemble([new Bayes(), new Linear(), new Knn()]), crossed, cards);

console.log(a.top1, b.top1);
```

The [model demo](../../demos/model/) does exactly that, in the tab.

## The synthetic corpus

`synth(n, seed)` builds a stream that looks like real sorting, with the three regimes you meet
in practice:

- **marginal signal** — some domains always go to the same place;
- **interaction signal** — for the others, the domain × tag combination decides, and nothing
  hints at it feature by feature;
- **noise** — one draw in ten goes elsewhere.

Without the interaction regime every model ties and the bench proves nothing. Card titles talk
about the subject but **never about the zone**: slipping the answer in there would make the
bench flattering and useless.
