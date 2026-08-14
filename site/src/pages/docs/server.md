---
layout: ../../layouts/Doc.astro
title: The server
description: Events, replay, embeddings — what @trieur/server adds and how to deploy it.
---

`@trieur/server` is Bun plus SQLite and nothing else. It fits in four files.

```bash
TRIEUR_TOKEN=secret bun packages/server/src/serve.ts
# trieur → http://localhost:4747
```

## What it keeps, and why

**The events, not just the model.** An online model cannot be retrained backwards: if you change
feature extractor, model or hyperparameter, the only way to benefit on past data is to
**replay** the events. Delete the `models` row, restart, and history goes through the new model.
An online model without its events is a dead end.

**The serialised model**, so we do not replay on every boot.

**The vectors**, so we do not pay twice for an embedding call already made.

## The protocol

A single types file (`@trieur/learn/protocol`), imported by both sides: client and server cannot
drift apart without TypeScript saying so.

| Route | Role |
|---|---|
| `POST /v1/decks/:deck/events` | pushes a batch of filings |
| `GET /v1/decks/:deck/model?since=` | model snapshot, or `null` when the client is up to date |
| `POST /v1/decks/:deck/predict` | server-side ranking (sparse models + embeddings) |
| `GET /v1/decks/:deck/stats` | measured accuracy, vocabulary size, expert weights |
| `GET /health` | open even when a token is required |

Two structural decisions:

- **An event carries an `id`.** The client can replay its queue after a network outage without
  risking learning the same filing twice: the server ignores an id it has already seen
  (`INSERT OR IGNORE`). Without that, a single unlucky reconnection permanently — and silently —
  skews the model.
- **An event carries the features *and* the text.** Features are enough for the sparse models;
  the text only serves the embeddings. Carrying it now avoids changing the protocol the day a
  vector model is plugged in, and it stays optional.

## Embeddings

```bash
EMBED_URL=https://api.openai.com/v1 EMBED_MODEL=text-embedding-3-small EMBED_KEY=sk-… \
  bun packages/server/src/serve.ts
```

Any OpenAI-compatible API will do — including a local one (Text Embeddings Inference,
llama.cpp, Ollama). Without `EMBED_URL` and `EMBED_MODEL` the rung is simply disabled and the
server runs without it.

The computation starts **after** the response to the client: nobody waits on a third-party
provider for a filing to be accepted. Every card is first classified by the index as it stands,
then added — so the accuracy of embeddings is measured on cards never seen, exactly like the
sparse models. That is what gives them their weight in the blend, for free, since the vector
has just been computed anyway.

## Environment variables

| Variable | Default | Role |
|---|---|---|
| `PORT` | `4747` | HTTP port |
| `TRIEUR_DB` | `trieur.sqlite` | SQLite file |
| `TRIEUR_TOKEN` | — | when set, `Bearer` is required on data routes |
| `TRIEUR_ORIGIN` | `*` | `Access-Control-Allow-Origin` |
| `EMBED_URL` | — | OpenAI-compatible API, e.g. `https://…/v1` |
| `EMBED_MODEL` | — | embedding model; absent = rung disabled |
| `EMBED_KEY` | — | API key |

## Mounting it elsewhere

`createApi()` returns a `Request → Response` function: it can be tested without opening a port
and mounted in any server instead of imposing its own.

```ts
import { Embedder, VectorIndex, createApi, openDb } from '@trieur/server';

const db = openDb('trieur.sqlite');
const api = createApi({ db, token, vectors: new VectorIndex(db, new Embedder({ url, model, key })) });

Bun.serve({ fetch: (req) => api.handle(req) });
```

`api.flush()` writes the in-memory models — call it on `SIGINT`/`SIGTERM`, otherwise it is lost
sorting work. The bundled server already does.

## One model per deck

The `deck` in the URL isolates models: two unrelated card sets (links, photos) do not mix.
Events, vectors and the snapshot are all stored per deck.
