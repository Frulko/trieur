#!/usr/bin/env bun
//
// The server. Thirty lines around `createApi`: open the database, wire the embeddings up if
// they are configured, listen, and **write the models before dying**.
//
//   TRIEUR_TOKEN=secret bun src/serve.ts
//
// | variable       | default          | role                                              |
// |----------------|------------------|---------------------------------------------------|
// | PORT           | 4747             | HTTP port                                         |
// | TRIEUR_DB      | trieur.sqlite    | SQLite file                                       |
// | TRIEUR_TOKEN   | —                | when set, `Bearer` is required on data routes      |
// | TRIEUR_ORIGIN  | *                | value of `Access-Control-Allow-Origin`            |
// | EMBED_URL      | —                | OpenAI-compatible API, e.g. `https://…/v1`        |
// | EMBED_MODEL    | —                | embedding model; absent = rung disabled            |
// | EMBED_KEY      | —                | API key                                           |

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
    // a trieur app rarely lives on the same origin as its server
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const res = await api.handle(req);
    for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
    return res;
  },
});

console.log(`trieur → http://localhost:${server.port}`);
console.log(`  database   ${process.env.TRIEUR_DB ?? 'trieur.sqlite'}`);
console.log(`  auth       ${process.env.TRIEUR_TOKEN ? 'Bearer' : 'open'}`);
console.log(`  embeddings ${embedder.enabled ? `${embedder.model}` : 'disabled (EMBED_URL + EMBED_MODEL)'}`);

// an unwritten in-memory model is lost sorting work
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    api.flush();
    process.exit(0);
  });
}
