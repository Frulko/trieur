---
layout: ../../layouts/Doc.astro
title: Le serveur
description: Événements, rejeu, embeddings — ce que @trieur/server ajoute et comment le déployer.
---

`@trieur/server`, c'est Bun + SQLite et rien d'autre. Il tient dans quatre fichiers.

```bash
TRIEUR_TOKEN=secret bun packages/server/src/index.ts
# trieur → http://localhost:4747
```

## Ce qu'il garde, et pourquoi

**Les événements, pas seulement le modèle.** Un modèle en ligne ne se ré-entraîne pas à
l'envers : si tu changes d'extracteur de traits, de modèle ou d'hyperparamètre, la seule
façon d'en faire profiter l'historique est de **rejouer** les événements. Supprime la ligne
`models`, redémarre, l'historique repasse dans le nouveau modèle. Un modèle en ligne sans ses
événements est un cul-de-sac.

**Le modèle sérialisé**, pour ne pas rejouer à chaque démarrage.

**Les vecteurs**, pour ne pas repayer un appel d'embedding déjà fait.

## Le protocole

Un seul fichier de types (`@trieur/learn/protocol`), importé des deux côtés : client et
serveur ne peuvent pas diverger sans que TypeScript le dise.

| Route | Rôle |
|---|---|
| `POST /v1/decks/:deck/events` | pousse un lot de rangements |
| `GET /v1/decks/:deck/model?since=` | instantané du modèle, ou `null` si le client est à jour |
| `POST /v1/decks/:deck/predict` | classement côté serveur (modèles creux + embeddings) |
| `GET /v1/decks/:deck/stats` | justesse mesurée, taille du vocabulaire, poids des experts |
| `GET /health` | ouvert même quand un token est exigé |

Deux décisions structurantes :

- **Un événement porte un `id`.** Le client peut rejouer sa file après une coupure réseau
  sans risquer d'apprendre deux fois le même rangement : le serveur ignore un id déjà vu
  (`INSERT OR IGNORE`). Sans ça, une seule reconnexion malheureuse fausse durablement le
  modèle — et silencieusement.
- **Un événement porte les traits *et* le texte.** Les traits suffisent aux modèles creux ;
  le texte ne sert qu'aux embeddings. Le transporter dès maintenant évite d'avoir à changer
  le protocole le jour où on branche un modèle vectoriel, et il reste facultatif.

## Les embeddings

```bash
EMBED_URL=https://api.openai.com/v1 EMBED_MODEL=text-embedding-3-small EMBED_KEY=sk-… \
  bun packages/server/src/index.ts
```

N'importe quelle API compatible OpenAI fait l'affaire — y compris une instance locale
(Text Embeddings Inference, llama.cpp, Ollama). Sans `EMBED_URL` et `EMBED_MODEL`, le barreau
est simplement désactivé et le serveur fonctionne sans.

Le calcul part **après** la réponse au client : personne n'attend un appel vers un
fournisseur tiers pour qu'un rangement soit accepté. Chaque carte est d'abord classée par
l'index tel qu'il est, puis ajoutée — la justesse des embeddings est donc mesurée sur des
cartes jamais vues, exactement comme pour les modèles creux. C'est elle qui leur donne leur
poids dans le mélange, gratuitement, puisque le vecteur vient d'être calculé de toute façon.

## Variables d'environnement

| Variable | Défaut | Rôle |
|---|---|---|
| `PORT` | `4747` | port HTTP |
| `TRIEUR_DB` | `trieur.sqlite` | fichier SQLite |
| `TRIEUR_TOKEN` | — | si défini, `Bearer` exigé sur toutes les routes de données |
| `TRIEUR_ORIGIN` | `*` | valeur de `Access-Control-Allow-Origin` |
| `EMBED_URL` | — | API compatible OpenAI, ex. `https://…/v1` |
| `EMBED_MODEL` | — | modèle d'embeddings ; absent = barreau désactivé |
| `EMBED_KEY` | — | clé d'API |

## Le monter ailleurs

`createApi()` rend une fonction `Request → Response` : elle se teste sans ouvrir de port et
se monte dans n'importe quel serveur au lieu d'imposer le sien.

```ts
import { createApi, openDb, Embedder, VectorIndex } from '@trieur/server';

const db = openDb('trieur.sqlite');
const api = createApi({ db, token, vectors: new VectorIndex(db, new Embedder({ url, model, key })) });

Bun.serve({ fetch: (req) => api.handle(req) });
```

`api.flush()` écrit les modèles en mémoire — à appeler sur `SIGINT`/`SIGTERM`, sinon c'est du
travail de tri perdu. Le serveur fourni le fait déjà.

## Un modèle par deck

Le `deck` de l'URL isole les modèles : deux jeux de cartes sans rapport (des liens, des
photos) ne se mélangent pas. Les événements, les vecteurs et l'instantané sont tous rangés
par deck.
