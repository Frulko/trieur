# @trieur/server

Full mode: filing storage, replay, and the models a browser cannot run. Bun plus SQLite, nothing
else.

```bash
TRIEUR_TOKEN=secret bun src/serve.ts
# trieur → http://localhost:4747
```

It keeps **the events**, not just the model: change the feature extractor or the model, delete
the `models` row, restart — history goes through the new model. An online model without its
events is a dead end.

| Route | Role |
|---|---|
| `POST /v1/decks/:deck/events` | pushes a batch of filings (deduplicated by `id`) |
| `GET /v1/decks/:deck/model?since=` | snapshot, or `null` when the client is up to date |
| `POST /v1/decks/:deck/predict` | server-side ranking (sparse models + embeddings) |
| `GET /v1/decks/:deck/stats` | measured accuracy, vocabulary, expert weights |
| `GET /health` | open even when a token is required |

| Variable | Default | Role |
|---|---|---|
| `PORT` | `4747` | HTTP port |
| `TRIEUR_DB` | `trieur.sqlite` | SQLite file |
| `TRIEUR_TOKEN` | — | when set, `Bearer` is required |
| `TRIEUR_ORIGIN` | `*` | `Access-Control-Allow-Origin` |
| `EMBED_URL` + `EMBED_MODEL` (+ `EMBED_KEY`) | — | embeddings through an OpenAI-compatible API |

`createApi()` returns a `Request → Response` function: testable without opening a port, and
mountable in any server.

```ts
import { Embedder, VectorIndex, createApi, openDb } from '@trieur/server';

const db = openDb('trieur.sqlite');
const api = createApi({ db, token, vectors: new VectorIndex(db, new Embedder({ url, model, key })) });
Bun.serve({ fetch: (req) => api.handle(req) });
```

Documentation: [frulko.github.io/trieur/docs/server](https://frulko.github.io/trieur/docs/server/).

MIT.
