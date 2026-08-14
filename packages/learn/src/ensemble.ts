// L'assemblage — et le seul barreau qui n'en est pas un.
//
// Les trois modèles n'ont pas les mêmes forces au même moment : le kNN est le seul à
// répondre sur les dix premières cartes, Bayes tient le milieu de terrain, le linéaire
// prend l'avantage quand le volume monte et que les traits interagissent. Plutôt que de
// choisir une fois pour toutes, on les fait voter.
//
// **Les poids sont mesurés, pas décrétés.** Avant d'apprendre un exemple, chaque membre
// est interrogé : sa réponse est comparée au rangement réel. C'est de l'évaluation
// « prequential » — tester avant d'apprendre — donc jamais mesurée sur des exemples déjà
// vus. Les erreurs accumulées donnent les poids via l'algorithme des experts (`hedge.ts`),
// qui garantit de faire à long terme aussi bien que le meilleur membre.
//
// Mesuré sur un corpus réel de 3412 liens dans 72 dossiers : 35,8 % top-1 et 60,9 % top-3,
// contre 33,1 / 57,1 pour le meilleur membre pris seul (`tools/bench.ts`).

import { blend, hedge } from './hedge.js';
import type { Feature, Model, ModelJSON, Ranked, Stats } from './types.js';

interface Member {
  model: Model;
  hits: number;
  seen: number;
}

export class Ensemble implements Model {
  readonly kind = 'ensemble';
  #members: Member[];
  #hits = 0;
  #seen = 0;

  constructor(models: Model[]) {
    this.#members = models.map((model) => ({ model, hits: 0, seen: 0 }));
  }

  get models(): Model[] {
    return this.#members.map((m) => m.model);
  }

  get examples(): number {
    return Math.max(0, ...this.#members.map((m) => m.model.examples));
  }

  get vocabSize(): number {
    return Math.max(0, ...this.#members.map((m) => (m.model as { vocabSize?: number }).vocabSize ?? 0));
  }

  get targets(): string[] {
    return [...new Set(this.#members.flatMap((m) => (m.model as { targets?: string[] }).targets ?? []))];
  }

  /** Poids de chaque membre, par l'algorithme des experts (cf. `hedge.ts`). */
  get weights(): Record<string, number> {
    const w = hedge(this.#members);
    return Object.fromEntries(this.#members.map((m, i) => [m.model.kind, w[i]!]));
  }

  learn(features: Feature[], target: string, weight = 1): void {
    // tester avant d'apprendre : la justesse mesurée reste honnête. On interroge chaque
    // membre une seule fois et on réutilise ses réponses pour le vote — sinon chaque
    // rangement coûterait deux prédictions complètes.
    if (weight > 0) {
      const votes = this.#members.map((m) => m.model.predict(features, []));
      this.#members.forEach((m, i) => {
        const top = votes[i]![0];
        if (!top) return;
        m.seen++;
        if (top.id === target) m.hits++;
      });
      const mine = this.#blend(votes)[0];
      if (mine) {
        this.#seen++;
        if (mine.id === target) this.#hits++;
      }
    }
    for (const m of this.#members) m.model.learn(features, target, weight);
  }

  predict(features: Feature[], targets: string[]): Ranked[] {
    return this.#blend(this.#members.map((m) => m.model.predict(features, targets)));
  }

  /** Mélange des distributions, pondéré par la justesse mesurée de chaque membre. */
  #blend(votes: Ranked[][]): Ranked[] {
    return blend(votes, hedge(this.#members));
  }

  stats(): Stats {
    return {
      examples: this.examples,
      targets: this.targets.length,
      vocab: this.vocabSize,
      accuracy: this.#seen ? this.#hits / this.#seen : 0,
      members: Object.fromEntries(this.#members.map((m) => [m.model.kind, m.seen ? m.hits / m.seen : 0])),
    };
  }

  toJSON(): ModelJSON {
    return {
      kind: this.kind,
      v: 1,
      hits: this.#hits,
      seen: this.#seen,
      members: this.#members.map((m) => ({ hits: m.hits, seen: m.seen, model: m.model.toJSON() })),
    };
  }

  static fromJSON(data: any, revive: (json: ModelJSON) => Model): Ensemble {
    const members = ((data?.members ?? []) as Array<{ hits: number; seen: number; model: ModelJSON }>).map((m) => ({
      model: revive(m.model),
      hits: m.hits ?? 0,
      seen: m.seen ?? 0,
    }));
    const e = new Ensemble(members.map((m) => m.model));
    e.#members = members;
    e.#hits = data?.hits ?? 0;
    e.#seen = data?.seen ?? 0;
    return e;
  }
}
