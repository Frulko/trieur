---
layout: ../../layouts/Doc.astro
title: The model ladder
description: From naive Bayes to embeddings — what each rung buys, what it costs, when to climb.
---

Every rung runs on the **same features** and the same interface. So they can be swapped without
touching the app, and — more importantly — compared honestly.

```ts
interface Model {
  learn(features: string[], target: string, weight?: number): void;
  predict(features: string[], targets: string[]): Ranked[];
  toJSON(): ModelJSON;
}
```

A model never sees a domain object: it sees **sparse features**, `key:value` strings. `meta()`
and then the extractor decide what becomes a feature.

## Features first

The choice of features matters more than the choice of model. `tokens()` turns metadata into
features:

- array → one feature per element (`tag:react`)
- short text (≤ 3 words) → one feature as-is (`domain:github.com`)
- long text → one feature per word (`title:hooks`)

Numbers and booleans are ignored: they do not discriminate a filing, and a sparse model would
not know what to do with them.

## Rung 1 — naive Bayes

It learns from the third example, fits in a hundred lines, serialises, and above all it
**explains itself**: `predict()` returns a `why`, the features that carried the decision. You
can display "suggested because `tag:react` and `domain:github.com`".

Two traps already paid for, not to be reintroduced:

- **Ignore features never seen, at prediction time.** Otherwise every unknown word of a title
  penalises the zone that has learned a lot — its denominator is large — and hands the win to
  an untouched zone.
- **Stay silent rather than invent.** Not enough examples, or no recognised feature → empty
  list.

Its ceiling is known and accepted: it assumes features are independent. "github" and "rust"
vote separately, never together.

## Rung 2 — cross the features

The best value for money on the whole ladder, and it does not change model:

```js
import { crosses, pipe, tokens } from '@trieur/learn';

const features = pipe(tokens, crosses([['domain', 'tag']]));
// domain:github.com + tag:rust  →  domain:github.com×tag:rust
```

The combination becomes a feature in its own right, hence visible to any linear or Bayesian
model. The price is vocabulary explosion, hence two guard rails: only an explicit list of key
pairs is crossed, and at most four values per key.

Measured on the bench's synthetic corpus, where the zone depends on the combination: Bayes goes
from **61.3%** to **68.4%** top-1, the linear model from 57.5% to 68.8%. On a real corpus of
3,412 links where marginal signals dominate, the same crossing buys half a point. Hence the
rule: [measure on your corpus](../measure/).

## Rung 3 — the linear model

Weights that are **learned** instead of counted. Two correlated features stop voting twice, and
a crossed feature can carry a weight neither of its parts has.

Three choices that matter:

1. **Contrastive update.** Textbook multinomial logistic regression updates *every* class on
   every example: the weight matrix becomes `|vocab| × |zones|`, hundreds of thousands of
   entries to serialise in a browser. Only two zones are touched — the right one and the best
   of the wrong ones. That is the multiclass perceptron update, and it stays sparse.
2. **AdaGrad rather than a fixed step.** The usual complaint about an online model is "a
   learning rate to tune". AdaGrad tunes it per feature: a rare feature keeps a large step, a
   feature seen everywhere calms down on its own. Six lines, one hyperparameter fewer.
3. **Pruning.** Past `maxVocab`, the features whose peak weight is lowest are dropped — the
   ones that never tipped a decision.

Undoing (`weight: -1`) replays the step the other way. It is not the exact inverse — AdaGrad
has already moved its accumulators — but on an isolated undo the difference is invisible, and
an online model has no exact memory of its past anyway.

## Rung 4 — k nearest neighbours

"This link looks like those, and they are in *dev*." It is the only model useful **from the
very first card** — the best cold start — and the only one that justifies its answer by
pointing at neighbours rather than at features.

What it costs: the corpus has to be kept. Hence the ring buffer — past `capacity` cards (1500
by default), the oldest leaves. Cosine similarity weighted by IDF (a feature present everywhere
brings nobody closer) and an inverted index so only neighbours sharing a rare feature are
compared.

## Rung 5 — embeddings

The one rung that cannot live in the browser: it needs either an embedded model of several tens
of megabytes, or a network call. That is the reason [full mode](../server/) exists.

What it brings that sparse features do not: "hooks" and "components" are two unrelated features
to Bayes, to sparse kNN and to the linear model — they never meet in the same document. In
embedding space they are neighbours. **It is the only rung that brings two cards sharing no
word closer together.**

## Not choosing: the ensemble

None of the rungs wins everywhere. kNN answers alone over the first cards, Bayes holds the
middle game, the linear model takes over when features interact. So `defaultModel()` has them
vote.

**The weights are measured.** Before an example is learned, every member is asked and its
answer compared to the real filing — *prequential* evaluation, never on examples already seen.
The accumulated mistakes give the weights through the experts algorithm (Hedge):
`exp(-η × mistakes)` with `η = √(2 ln N / T)`. The classic guarantee of that algorithm is that
in the long run the ensemble does as well as its best member — without anyone naming it in
advance.

On the real corpus of 3,412 links across 72 folders: **35.8% top-1** and **60.9% top-3**,
against 33.1 / 57.1 for the best member alone.

## Choosing for yourself

```js
import { Bayes, Ensemble, Knn, Linear, createRecommender, crosses, pipe, tokens } from '@trieur/learn';

const brain = createRecommender({
  key: 'links',
  model: new Ensemble([new Bayes({ alpha: 0.3 }), new Linear({ maxVocab: 20_000 })]),
  features: pipe(tokens, crosses([['domain', 'tag'], ['author', 'tag']])),
  minConfidence: 0.5,
});
```
