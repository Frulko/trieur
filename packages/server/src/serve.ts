#!/usr/bin/env bun
//
// Le serveur. Trente lignes autour de `createApi` : ouvrir la base, brancher les
// embeddings s'ils sont configurés, écouter, et **écrire les modèles avant de mourir**.
//
//   TRIEUR_TOKEN=secret bun src/index.ts
//
// | variable       | défaut           | rôle                                             |
// |----------------|------------------|--------------------------------------------------|
// | PORT           | 4747             | port HTTP                                        |
// | TRIEUR_DB      | trieur.sqlite    | fichier SQLite                                   |
// | TRIEUR_TOKEN   | —                | si défini, `Bearer` exigé sur toutes les routes   |
// | TRIEUR_ORIGIN  | *                | valeur de `Access-Control-Allow-Origin`          |
// | EMBED_URL      | —                | API compatible OpenAI, ex. `https://…/v1`        |
// | EMBED_MODEL    | —                | modèle d'embeddings ; absent = barreau désactivé  |
// | EMBED_KEY      | —                | clé d'API                                        |

import { createApi } from './api.js';
import { openDb } from './db.js';
import { Embedder, VectorIndex } from './embed.js';

const db = openDb(process.env.TRIEUR_DB ?? 'trieur.sqlite');
const embedder = new Embedder({ url: process.env.EMBED_URL, model: process.env.EMBED_MODEL, key: process.env.EMBED_KEY });
const vectors = new VectorIndex(db, embedder);
const api = createApi({ db, token: process.env.TRIEUR_TOKEN, vectors });

const origin = process.env.TRIEUR_ORIGIN ?? '*';
const cors = {
  'Access-Control-Allow-Origin': origin,
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const server = Bun.serve({
  port: Number(process.env.PORT ?? 4747),
  async fetch(req) {
    // une app trieur vit rarement sur la même origine que son serveur
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const res = await api.handle(req);
    for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
    return res;
  },
});

console.log(`trieur → http://localhost:${server.port}`);
console.log(`  base       ${process.env.TRIEUR_DB ?? 'trieur.sqlite'}`);
console.log(`  auth       ${process.env.TRIEUR_TOKEN ? 'Bearer' : 'ouverte'}`);
console.log(`  embeddings ${embedder.enabled ? `${embedder.model}` : 'désactivés (EMBED_URL + EMBED_MODEL)'}`);

// un modèle en mémoire non écrit, c'est du travail de tri perdu
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    api.flush();
    process.exit(0);
  });
}
