// The server package as a library. The executable server itself lives in `serve.ts`.
//
// `createApi()` returns a `Request → Response` function: it can be tested without opening a
// port, and mounted in any server instead of imposing its own.

export { createApi, type ApiOptions } from './api.js';
export { decks, insertEvent, openDb, readEvents, readModel, writeModel, type StoredEvent } from './db.js';
export { Embedder, VectorIndex, type EmbedConfig } from './embed.js';
