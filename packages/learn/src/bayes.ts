// Barreau 1 : Bayes naïf multinomial.
//
// Pourquoi celui-là en premier : il apprend dès le 3ᵉ exemple (aucune phase
// d'entraînement), tient en cent lignes, se sérialise en JSON, et surtout il **s'explique**
// — « proposé parce que tag:react et domain:github.com ».
//
// Son plafond est connu et assumé : il suppose les traits indépendants. « github » et
// « rust » votent séparément, jamais ensemble. Deux réponses à ça, dans cet ordre de
// rentabilité : lui donner des traits croisés (`crosses()`, aucun changement de modèle),
// puis passer à un modèle linéaire qui apprend des poids au lieu de compter (`Linear`).

import type { Feature, Model, ModelJSON, Ranked } from './types.js';
import { softmax } from './types.js';

export interface BayesOptions {
  /** lissage de Laplace : plus haut = plus prudent */
  alpha?: number;
  /** en dessous, on ne propose rien */
  minExamples?: number;
}

export class Bayes implements Model {
  readonly kind = 'bayes';
  alpha: number;
  minExamples: number;
  examples = 0;

  /** zone → trait → compte */
  #counts = new Map<string, Map<Feature, number>>();
  /** zone → nombre total de traits vus */
  #totals = new Map<string, number>();
  /** zone → nombre de cartes rangées */
  #docs = new Map<string, number>();
  #vocab = new Set<Feature>();

  constructor(opts: BayesOptions = {}) {
    this.alpha = opts.alpha ?? 0.4;
    this.minExamples = opts.minExamples ?? 3;
  }

  get vocabSize(): number {
    return this.#vocab.size;
  }
  get targets(): string[] {
    return [...this.#counts.keys()];
  }

  learn(features: Feature[], target: string, weight = 1): void {
    if (!this.#counts.has(target)) {
      this.#counts.set(target, new Map());
      this.#totals.set(target, 0);
      this.#docs.set(target, 0);
    }
    const c = this.#counts.get(target)!;
    for (const f of features) {
      c.set(f, (c.get(f) ?? 0) + weight);
      this.#vocab.add(f);
    }
    this.#totals.set(target, this.#totals.get(target)! + features.length * weight);
    this.#docs.set(target, this.#docs.get(target)! + weight);
    this.examples += weight;
  }

  predict(features: Feature[], targets: string[]): Ranked[] {
    const ids = targets.length ? targets : this.targets;
    if (this.examples < this.minExamples || !ids.length) return [];
    // On ignore les traits jamais vus. Sans ça, chaque mot inconnu d'un titre pénalise la
    // zone qui a beaucoup appris (son dénominateur est gros) et fait gagner une zone
    // vierge : le modèle proposerait systématiquement les dossiers où l'on n'a rien rangé.
    const feats = features.filter((f) => this.#vocab.has(f));
    if (!feats.length) return [];

    const V = Math.max(this.#vocab.size, 1);
    const why: Feature[][] = [];
    const logp = ids.map((id) => {
      const c = this.#counts.get(id) ?? new Map<Feature, number>();
      const total = this.#totals.get(id) ?? 0;
      // log P(zone) + Σ log P(trait | zone), lissé — les logs évitent le sous-dépassement
      let lp = Math.log(((this.#docs.get(id) ?? 0) + this.alpha) / (this.examples + this.alpha * ids.length));
      const hits: Array<{ f: Feature; n: number }> = [];
      for (const f of feats) {
        const n = c.get(f) ?? 0;
        lp += Math.log((n + this.alpha) / (total + this.alpha * V));
        if (n > 0) hits.push({ f, n });
      }
      why.push(
        hits
          .sort((a, b) => b.n - a.n)
          .slice(0, 3)
          .map((h) => h.f),
      );
      return lp;
    });

    return softmax(logp)
      .map((score, i) => ({ id: ids[i]!, score, why: why[i]! }))
      .sort((a, b) => b.score - a.score);
  }

  toJSON(): ModelJSON {
    return {
      kind: this.kind,
      v: 1,
      alpha: this.alpha,
      minExamples: this.minExamples,
      examples: this.examples,
      counts: Object.fromEntries([...this.#counts].map(([k, m]) => [k, Object.fromEntries(m)])),
      docs: Object.fromEntries(this.#docs),
    };
  }

  static fromJSON(data: any, opts: BayesOptions = {}): Bayes {
    const b = new Bayes({ alpha: data?.alpha, minExamples: data?.minExamples, ...opts });
    for (const [id, feats] of Object.entries((data?.counts ?? {}) as Record<string, Record<string, number>>)) {
      const m = new Map(Object.entries(feats));
      b.#counts.set(id, m);
      b.#totals.set(
        id,
        [...m.values()].reduce((a, x) => a + x, 0),
      );
      for (const f of m.keys()) b.#vocab.add(f);
    }
    for (const [id, n] of Object.entries((data?.docs ?? {}) as Record<string, number>)) b.#docs.set(id, n);
    b.examples = data?.examples ?? [...b.#docs.values()].reduce((a, x) => a + x, 0);
    return b;
  }
}
