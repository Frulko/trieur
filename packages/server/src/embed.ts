// Rung 4: embeddings.
//
// This is the one rung that cannot live in the browser — it needs either an embedded model of
// several tens of megabytes, or a network call. It is also why full mode exists: the server
// does what the page cannot.
//
// What it brings that sparse features do not: "hooks" and "components" are two unrelated
// features to Bayes, to sparse kNN and to the linear model — they never meet in the same
// document. In embedding space they are neighbours. **It is the only rung that brings two
// cards sharing no word closer together.**
//
// What it costs: one call per card (cached), network latency, and a dependency on a provider.
// Hence the place we give it — one more expert, weighted by its measured accuracy like the
// others, never a replacement.

import type { Ranked, Tally } from '@trieur/learn';
import type { Database } from 'bun:sqlite';

export interface EmbedConfig {
  /** root of an OpenAI-compatible API, e.g. `https://api.openai.com/v1` */
  url?: string | undefined;
  model?: string | undefined;
  key?: string | undefined;
  /** number of neighbours kept */
  k?: number;
  timeout?: number;
}

const hash = (s: string): string => Bun.hash(s).toString(36);

export class Embedder {
  readonly url: string | undefined;
  readonly model: string | undefined;
  readonly key: string | undefined;
  readonly k: number;
  readonly timeout: number;

  constructor(cfg: EmbedConfig = {}) {
    this.url = cfg.url?.replace(/\/$/, '');
    this.model = cfg.model;
    this.key = cfg.key;
    this.k = cfg.k ?? 12;
    this.timeout = cfg.timeout ?? 15_000;
  }

  get enabled(): boolean {
    return Boolean(this.url && this.model);
  }

  /** Normalised vectors (norm 1): cosine similarity becomes a plain dot product. */
  async embed(texts: string[]): Promise<Float32Array[] | null> {
    if (!this.enabled || !texts.length) return null;
    try {
      const res = await fetch(`${this.url}/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(this.key ? { Authorization: `Bearer ${this.key}` } : {}) },
        body: JSON.stringify({ model: this.model, input: texts.map((t) => t.slice(0, 8000)) }),
        signal: AbortSignal.timeout(this.timeout),
      });
      if (!res.ok) {
        console.error(`[embed] ${res.status} ${(await res.text()).slice(0, 200)}`);
        return null;
      }
      const data = (await res.json()) as { data?: Array<{ embedding: number[]; index?: number }> };
      const rows = (data.data ?? []).slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
      if (rows.length !== texts.length) return null;
      return rows.map((r) => normalize(Float32Array.from(r.embedding)));
    } catch (e) {
      console.error(`[embed] ${e instanceof Error ? e.message : e}`);
      return null;
    }
  }
}

function normalize(v: Float32Array): Float32Array {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < v.length; i++) v[i]! /= n;
  return v;
}

/**
 * kNN in embedding space, backed by the `vectors` table.
 *
 * ponytail: exhaustive in-memory comparison. At a few tens of thousands of cards that is a few
 * milliseconds; beyond that the next step is an approximate index (HNSW) or a SQLite vector
 * extension — without changing this interface.
 */
export class VectorIndex {
  #cache = new Map<string, { vec: Float32Array; target: string }[]>();

  constructor(
    private db: Database,
    private embedder: Embedder,
  ) {}

  get enabled(): boolean {
    return this.embedder.enabled;
  }

  /**
   * Adds cards to the index. A text already seen is not re-embedded.
   *
   * Every card is first classified by the index **as it stands**, then added: the accuracy
   * returned is therefore measured on cards never seen, exactly like the sparse models. That
   * is what gives embeddings their weight in the blend — for free, since the card's vector has
   * just been computed anyway.
   */
  async ingest(deck: string, cards: Array<{ text: string; target: string }>): Promise<{ added: number } & Tally> {
    const none = { added: 0, hits: 0, seen: 0 };
    if (!this.enabled || !cards.length) return none;
    const known = new Set(
      (this.db.query(`SELECT hash FROM vectors WHERE deck = ?`).all(deck) as Array<{ hash: string }>).map((r) => r.hash),
    );
    const todo = new Map<string, { text: string; target: string }>();
    for (const c of cards) {
      const h = hash(c.text);
      if (!known.has(h) && !todo.has(h)) todo.set(h, c);
    }
    if (!todo.size) return none;

    const entries = [...todo.entries()];
    const vecs = await this.embedder.embed(entries.map(([, c]) => c.text));
    if (!vecs) return none;

    const rows = this.#rows(deck);
    const insert = this.db.query(`INSERT OR IGNORE INTO vectors (deck, hash, target, vec, at) VALUES (?, ?, ?, ?, ?)`);
    const now = Date.now();
    let hits = 0;
    let seen = 0;
    this.db.transaction(() => {
      entries.forEach(([h, c], i) => {
        const vec = vecs[i]!;
        const guess = this.#top(rows, vec);
        if (guess) {
          seen++;
          if (guess === c.target) hits++;
        }
        insert.run(deck, h, c.target, Buffer.from(vec.buffer), now);
        rows.push({ vec, target: c.target }); // the index grows card by card
      });
    })();
    return { added: entries.length, hits, seen };
  }

  /** Zone of the nearest neighbour, or null when the index is empty. */
  #top(rows: Array<{ vec: Float32Array; target: string }>, q: Float32Array): string | null {
    let best: string | null = null;
    let bestSim = 0;
    for (const r of rows) {
      const s = dot(q, r.vec);
      if (s > bestSim) {
        bestSim = s;
        best = r.target;
      }
    }
    return best;
  }

  #rows(deck: string): { vec: Float32Array; target: string }[] {
    let rows = this.#cache.get(deck);
    if (!rows) {
      rows = (this.db.query(`SELECT target, vec FROM vectors WHERE deck = ?`).all(deck) as Array<{ target: string; vec: Uint8Array }>).map(
        (r) => ({ target: r.target, vec: new Float32Array(r.vec.buffer, r.vec.byteOffset, r.vec.byteLength / 4) }),
      );
      this.#cache.set(deck, rows);
    }
    return rows;
  }

  async predict(deck: string, text: string | undefined, targets: string[]): Promise<Ranked[]> {
    if (!this.enabled || !text) return [];
    const rows = this.#rows(deck);
    if (!rows.length) return [];
    const [q] = (await this.embedder.embed([text])) ?? [];
    if (!q) return [];

    const sims = rows.map((r) => ({ target: r.target, sim: dot(q, r.vec) }));
    const near = sims.sort((a, b) => b.sim - a.sim).slice(0, this.embedder.k);
    const allowed = new Set(targets);
    const score = new Map<string, number>();
    for (const n of near) {
      if (!allowed.has(n.target) || n.sim <= 0) continue;
      score.set(n.target, (score.get(n.target) ?? 0) + n.sim);
    }
    const sum = [...score.values()].reduce((a, b) => a + b, 0);
    if (!sum) return [];
    return targets
      .map((id) => ({ id, score: (score.get(id) ?? 0) / sum, why: score.has(id) ? ['≈ semantic neighbours'] : [] }))
      .sort((a, b) => b.score - a.score);
  }

  count(deck: string): number {
    return (this.db.query(`SELECT COUNT(*) AS n FROM vectors WHERE deck = ?`).get(deck) as { n: number }).n;
  }
}

function dot(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i++) s += a[i]! * b[i]!;
  return s;
}
