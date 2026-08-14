// Le paquet serveur en tant que bibliothèque. Le serveur exécutable, lui, est `serve.ts`.
//
// `createApi()` rend une fonction `Request → Response` : elle se teste sans ouvrir de port,
// et se monte dans n'importe quel serveur au lieu d'imposer le sien.

export { createApi, type ApiOptions } from './api.js';
export { decks, insertEvent, openDb, readEvents, readModel, writeModel, type StoredEvent } from './db.js';
export { Embedder, VectorIndex, type EmbedConfig } from './embed.js';
