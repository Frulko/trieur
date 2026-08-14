// Barreau 4 : les embeddings.
//
// C'est le seul barreau qui ne peut pas vivre dans le navigateur — il demande soit un
// modèle embarqué de plusieurs dizaines de mégaoctets, soit un appel réseau. C'est aussi
// pour ça que le mode complet existe : le serveur fait ce que la page ne peut pas faire.
//
// Ce qu'il apporte que les traits creux n'apportent pas : « hooks » et « composants » sont
// deux traits sans rapport pour Bayes, le kNN creux ou le linéaire — ils ne se rencontrent
// jamais dans le même document. Dans l'espace des embeddings ils sont voisins. C'est le
// seul barreau qui rapproche deux cartes qui ne partagent **aucun mot**.
//
// Ce qu'il coûte : un appel par carte (mis en cache), une latence réseau, et une
// dépendance à un fournisseur. D'où la place qu'on lui donne — un expert de plus, pondéré
// par sa justesse mesurée comme les autres, jamais un remplaçant.

import type { Ranked, Tally } from '@trieur/learn';
import type { Database } from 'bun:sqlite';

export interface EmbedConfig {
  /** racine d'une API compatible OpenAI, ex. `https://api.openai.com/v1` */
  url?: string | undefined;
  model?: string | undefined;
  key?: string | undefined;
  /** nombre de voisins retenus */
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

  /** Vecteurs normalisés (norme 1) : la similarité cosinus devient un simple produit scalaire. */
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
 * kNN dans l'espace des embeddings, adossé à la table `vectors`.
 *
 * ponytail: comparaison exhaustive en mémoire. À quelques dizaines de milliers de cartes
 * c'est quelques millisecondes ; au-delà, la marche suivante est un index approché (HNSW)
 * ou une extension vectorielle SQLite — sans rien changer à l'interface d'ici.
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
   * Ajoute des cartes à l'index. Un texte déjà vu n'est pas ré-embarqué.
   *
   * Chaque carte est d'abord **classée par l'index tel qu'il est**, puis ajoutée : la
   * justesse renvoyée est donc mesurée sur des cartes jamais vues, exactement comme pour
   * les modèles creux. C'est elle qui donne son poids aux embeddings dans le mélange —
   * gratuitement, puisque le vecteur de la carte vient d'être calculé de toute façon.
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
        rows.push({ vec, target: c.target }); // l'index grandit au fil des cartes
      });
    })();
    return { added: entries.length, hits, seen };
  }

  /** Zone du plus proche voisin, ou null si l'index est vide. */
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
      .map((id) => ({ id, score: (score.get(id) ?? 0) / sum, why: score.has(id) ? ['≈ voisins sémantiques'] : [] }))
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
