# @trieur/server

Le mode complet : stockage des rangements, rejeu, et les modèles qu'un navigateur ne peut pas
faire tourner. Bun + SQLite, rien d'autre.

```bash
TRIEUR_TOKEN=secret bun src/serve.ts
# trieur → http://localhost:4747
```

Il garde **les événements**, pas seulement le modèle : changer d'extracteur de traits ou de
modèle, supprimer la ligne `models`, redémarrer — l'historique repasse dans le nouveau
modèle. Un modèle en ligne sans ses événements est un cul-de-sac.

| Route | Rôle |
|---|---|
| `POST /v1/decks/:deck/events` | pousse un lot de rangements (dédupliqués par `id`) |
| `GET /v1/decks/:deck/model?since=` | instantané, ou `null` si le client est à jour |
| `POST /v1/decks/:deck/predict` | classement serveur (modèles creux + embeddings) |
| `GET /v1/decks/:deck/stats` | justesse mesurée, vocabulaire, poids des experts |
| `GET /health` | ouvert même quand un token est exigé |

| Variable | Défaut | Rôle |
|---|---|---|
| `PORT` | `4747` | port HTTP |
| `TRIEUR_DB` | `trieur.sqlite` | fichier SQLite |
| `TRIEUR_TOKEN` | — | si défini, `Bearer` exigé |
| `TRIEUR_ORIGIN` | `*` | `Access-Control-Allow-Origin` |
| `EMBED_URL` + `EMBED_MODEL` (+ `EMBED_KEY`) | — | embeddings via une API compatible OpenAI |

`createApi()` rend une fonction `Request → Response` : elle se teste sans ouvrir de port et
se monte dans n'importe quel serveur.

```ts
import { createApi, Embedder, openDb, VectorIndex } from '@trieur/server';

const db = openDb('trieur.sqlite');
const api = createApi({ db, token, vectors: new VectorIndex(db, new Embedder({ url, model, key })) });
Bun.serve({ fetch: (req) => api.handle(req) });
```

Documentation : [trieur.dev/docs/serveur](https://trieur.dev/docs/serveur).

MIT.
