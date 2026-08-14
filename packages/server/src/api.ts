// The routes, kept apart from the server that serves them.
//
// `createApi()` returns a `Request → Response` function: it can be tested without opening a
// port, and mounted in any server instead of imposing its own.

import {
  blend,
  defaultModel,
  hedge,
  modelFromJSON,
  routes,
  type ModelResponse,
  type PredictRequest,
  type PredictResponse,
  type PushRequest,
  type PushResponse,
  type Ranked,
  type SortEvent,
  type Stats,
  type Tally,
} from '@trieur/learn';
import type { Database } from 'bun:sqlite';
import { insertEvent, readEvents, readModel, writeModel } from './db.js';
import { VectorIndex } from './embed.js';

export interface ApiOptions {
  db: Database;
  /** when set, `Authorization: Bearer <token>` is required */
  token?: string | undefined;
  vectors?: VectorIndex | undefined;
  /** how many events before the model is rewritten to disk */
  saveEvery?: number;
}

interface DeckState {
  model: ReturnType<typeof defaultModel> | ReturnType<typeof modelFromJSON>;
  version: number;
  /** accuracy of the sparse models, measured before learning */
  sparse: Tally;
  /** accuracy of the embeddings, measured while ingesting vectors */
  dense: Tally;
  unsaved: number;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export function createApi(opts: ApiOptions) {
  const { db, token, vectors } = opts;
  const saveEvery = opts.saveEvery ?? 25;
  const decks = new Map<string, DeckState>();

  /**
   * Loads a deck: its snapshot when there is one, otherwise a **full replay of the events**.
   *
   * That replay is what keeps the ladder climbable after the fact: change the feature
   * extractor or the model, delete the `models` row, restart — the history goes through the
   * new model. An online model without its events is a dead end.
   */
  function load(deck: string): DeckState {
    let state = decks.get(deck);
    if (state) return state;
    const saved = readModel(db, deck) as { version: number; json: any } | null;
    if (saved?.json?.model) {
      state = {
        model: modelFromJSON(saved.json.model),
        version: saved.version,
        sparse: saved.json.sparse ?? { hits: 0, seen: 0 },
        dense: saved.json.dense ?? { hits: 0, seen: 0 },
        unsaved: 0,
      };
    } else {
      state = { model: defaultModel(), version: 0, sparse: { hits: 0, seen: 0 }, dense: { hits: 0, seen: 0 }, unsaved: 0 };
      for (const e of readEvents(db, deck)) {
        apply(state, e);
        state.version++;
      }
    }
    decks.set(deck, state);
    return state;
  }

  /** Measure first, learn second: the accuracy stays honest. */
  function apply(state: DeckState, e: SortEvent): void {
    if (e.weight > 0) {
      const [top] = state.model.predict(e.features, []);
      if (top) {
        state.sparse.seen++;
        if (top.id === e.target) state.sparse.hits++;
      }
    }
    state.model.learn(e.features, e.target, e.weight);
  }

  function save(state: DeckState, deck: string, force = false): void {
    if (!force && state.unsaved < saveEvery) return;
    state.unsaved = 0;
    writeModel(db, deck, state.version, { model: state.model.toJSON(), sparse: state.sparse, dense: state.dense });
  }

  function statsOf(deck: string): Stats {
    const state = load(deck);
    const m = state.model as { stats?: () => Stats; examples: number; vocabSize?: number; targets?: string[] };
    const base: Stats = m.stats?.() ?? {
      examples: m.examples,
      targets: m.targets?.length ?? 0,
      vocab: m.vocabSize ?? 0,
      accuracy: 0,
    };
    const w = hedge([state.sparse, state.dense]);
    return {
      ...base,
      members: {
        ...base.members,
        sparse: state.sparse.seen ? state.sparse.hits / state.sparse.seen : 0,
        ...(vectors?.enabled
          ? { embeddings: state.dense.seen ? state.dense.hits / state.dense.seen : 0, 'weight:embeddings': w[1]! }
          : {}),
      },
    };
  }

  async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/health') return json({ ok: true });

    if (token && req.headers.get('Authorization') !== `Bearer ${token}`) return json({ error: 'unauthorized' }, 401);

    // /v1/decks/<deck>/<action>
    const parts = url.pathname.split('/').filter(Boolean);
    const deck = parts[2] ? decodeURIComponent(parts[2]) : '';
    const action = parts[3];
    if (parts[0] !== 'v1' || parts[1] !== 'decks' || !deck) return json({ error: 'not found' }, 404);

    if (req.method === 'POST' && url.pathname === routes.events(deck)) {
      const body = (await req.json().catch(() => null)) as PushRequest | null;
      if (!Array.isArray(body?.events)) return json({ error: 'events[] expected' }, 400);
      const state = load(deck);
      let accepted = 0;
      let duplicates = 0;
      const fresh: SortEvent[] = [];
      db.transaction(() => {
        for (const e of body.events) {
          if (!e?.id || !Array.isArray(e.features) || typeof e.target !== 'string') continue;
          if (!insertEvent(db, deck, e)) {
            duplicates++;
            continue;
          }
          accepted++;
          fresh.push(e);
        }
      })();
      for (const e of fresh) {
        apply(state, e);
        state.version++;
        state.unsaved++;
      }
      save(state, deck);
      // embeddings leave after the response: the client never waits on a call to a third-party
      // provider for its filing to be accepted
      const texts = fresh.filter((e) => e.weight > 0 && e.text).map((e) => ({ text: e.text!, target: e.target }));
      if (vectors?.enabled && texts.length) {
        void vectors.ingest(deck, texts).then((r) => {
          state.dense.hits += r.hits;
          state.dense.seen += r.seen;
          save(state, deck, true);
        });
      }
      return json({ accepted, duplicates, version: state.version } satisfies PushResponse);
    }

    if (req.method === 'GET' && url.pathname === routes.model(deck)) {
      const state = load(deck);
      const since = Number(url.searchParams.get('since') ?? 0);
      return json({
        version: state.version,
        model: state.version > since ? state.model.toJSON() : null,
        stats: statsOf(deck),
      } satisfies ModelResponse);
    }

    if (req.method === 'POST' && url.pathname === routes.predict(deck)) {
      const body = (await req.json().catch(() => null)) as PredictRequest | null;
      if (!body || !Array.isArray(body.features) || !Array.isArray(body.targets)) {
        return json({ error: 'features[] and targets[] expected' }, 400);
      }
      const state = load(deck);
      const sparse = state.model.predict(body.features, body.targets);
      const dense: Ranked[] = (await vectors?.predict(deck, body.text, body.targets)) ?? [];
      // same rule as everywhere else: the weights come from measured accuracy
      const ranked = blend([sparse, dense], hedge([state.sparse, state.dense]));
      const source = [sparse.length && 'sparse', dense.length && 'embeddings'].filter(Boolean).join('+') || 'none';
      return json({ ranked, source } satisfies PredictResponse);
    }

    if (req.method === 'GET' && url.pathname === routes.stats(deck)) return json(statsOf(deck));

    return json({ error: `unknown route: ${req.method} /${parts.join('/')} (${action ?? '—'})` }, 404);
  }

  return {
    handle,
    /** Writes every in-memory model (server shutdown). */
    flush() {
      for (const [deck, state] of decks) save(state, deck, true);
    },
    stats: statsOf,
  };
}
