// Barreau 2 : modèle linéaire en ligne (perceptron à marge / logistique).
//
// Des poids **appris** au lieu de comptes. Là où Bayes additionne des fréquences en
// supposant les traits indépendants, celui-ci corrige ses poids quand il se trompe : deux
// traits corrélés cessent de voter deux fois, et un trait croisé (`domain:github×tag:rust`)
// peut prendre un poids que ni `domain:github` ni `tag:rust` n'ont.
//
// Trois choix qui comptent :
//
// 1. **Mise à jour contrastive**, pas dense. La logistique multinomiale classique met à
//    jour *toutes* les zones à chaque exemple : la matrice de poids devient |vocab| ×
//    |zones|, soit des centaines de milliers d'entrées à sérialiser dans un navigateur. On
//    ne touche donc que deux zones : la bonne, et la meilleure des fautives. C'est la mise
//    à jour du perceptron multiclasse, et elle reste creuse.
// 2. **AdaGrad** plutôt qu'un pas fixe. Le reproche fait à un modèle en ligne, c'est « un
//    taux d'apprentissage à régler ». AdaGrad le règle par trait : un trait rare garde un
//    grand pas, un trait vu partout se calme tout seul. Six lignes, un hyperparamètre en
//    moins.
// 3. **Élagage.** Les traits croisés font exploser le vocabulaire. Au-delà de `maxVocab`,
//    on jette les traits dont le poids maximum est le plus faible — ceux qui n'ont jamais
//    fait pencher une décision.

import type { Feature, Model, ModelJSON, Ranked } from './types.js';
import { softmax } from './types.js';

export interface LinearOptions {
  /** pas d'apprentissage de base (AdaGrad le module par trait) */
  lr?: number;
  /** marge exigée entre la bonne zone et la meilleure fautive */
  margin?: number;
  minExamples?: number;
  /** au-delà, on élague les traits les moins utiles */
  maxVocab?: number;
}

export class Linear implements Model {
  readonly kind = 'linear';
  lr: number;
  margin: number;
  minExamples: number;
  maxVocab: number;
  examples = 0;

  /** zone → trait → poids */
  #w = new Map<string, Map<Feature, number>>();
  /** zone → trait → somme des carrés des gradients (AdaGrad) */
  #g2 = new Map<string, Map<Feature, number>>();
  #bias = new Map<string, number>();
  #vocab = new Set<Feature>();

  constructor(opts: LinearOptions = {}) {
    this.lr = opts.lr ?? 0.5;
    this.margin = opts.margin ?? 1;
    this.minExamples = opts.minExamples ?? 3;
    this.maxVocab = opts.maxVocab ?? 40_000;
  }

  get vocabSize(): number {
    return this.#vocab.size;
  }
  get targets(): string[] {
    return [...this.#w.keys()];
  }

  /** Score brut d'une zone : biais + somme des poids des traits présents. */
  #score(features: Feature[], target: string): number {
    const w = this.#w.get(target);
    if (!w) return 0;
    let s = this.#bias.get(target) ?? 0;
    for (const f of features) s += w.get(f) ?? 0;
    return s;
  }

  #row(target: string): Map<Feature, number> {
    let w = this.#w.get(target);
    if (!w) {
      w = new Map();
      this.#w.set(target, w);
      this.#g2.set(target, new Map());
      this.#bias.set(target, 0);
    }
    return w;
  }

  /** Un pas AdaGrad sur une zone. */
  #step(target: string, features: Feature[], g: number): void {
    const w = this.#row(target);
    const g2 = this.#g2.get(target)!;
    for (const f of features) {
      const acc = (g2.get(f) ?? 0) + g * g;
      g2.set(f, acc);
      w.set(f, (w.get(f) ?? 0) + (this.lr * g) / (Math.sqrt(acc) + 1e-8));
      this.#vocab.add(f);
    }
    this.#bias.set(target, (this.#bias.get(target) ?? 0) + this.lr * g * 0.1);
  }

  /**
   * `weight` négatif défait approximativement l'exemple : on rejoue le pas dans l'autre
   * sens. Ce n'est pas l'inverse exact (AdaGrad a déjà bougé ses accumulateurs), mais sur
   * une annulation isolée l'écart est invisible — et un modèle en ligne n'a de toute façon
   * pas de mémoire exacte de son passé.
   */
  learn(features: Feature[], target: string, weight = 1): void {
    this.#row(target);
    const rivals = this.targets.filter((t) => t !== target);
    // meilleure zone fautive : c'est contre elle qu'on se corrige
    let worst: string | null = null;
    let worstScore = -Infinity;
    for (const t of rivals) {
      const s = this.#score(features, t);
      if (s > worstScore) {
        worstScore = s;
        worst = t;
      }
    }
    this.examples += weight;

    if (!worst) {
      // une seule zone connue : rien à contraster, on la renforce doucement
      this.#step(target, features, 0.1 * weight);
      return;
    }
    const good = this.#score(features, target);
    const gap = good - worstScore;
    if (weight > 0 && gap >= this.margin) return; // déjà bien classé avec la marge : on ne touche à rien

    // gradient logistique sur la paire {bonne, fautive} — 1 quand on se trompe à fond,
    // proche de 0 quand on avait presque raison
    const g = weight * (1 / (1 + Math.exp(gap)));
    this.#step(target, features, g);
    this.#step(worst, features, -g);
    if (this.#vocab.size > this.maxVocab) this.#prune();
  }

  predict(features: Feature[], targets: string[]): Ranked[] {
    const ids = targets.length ? targets : this.targets;
    if (this.examples < this.minExamples || !ids.length) return [];
    // même règle que Bayes : un trait jamais vu ne dit rien, il ne doit pas voter
    const feats = features.filter((f) => this.#vocab.has(f));
    if (!feats.length) return [];

    const scores = ids.map((id) => this.#score(feats, id));
    const why = ids.map((id) => {
      const w = this.#w.get(id);
      if (!w) return [];
      return feats
        .map((f) => ({ f, v: w.get(f) ?? 0 }))
        .filter((x) => x.v > 0)
        .sort((a, b) => b.v - a.v)
        .slice(0, 3)
        .map((x) => x.f);
    });
    return softmax(scores)
      .map((score, i) => ({ id: ids[i]!, score, why: why[i]! }))
      .sort((a, b) => b.score - a.score);
  }

  /** Jette les traits qui n'ont jamais fait pencher une décision. */
  #prune(): void {
    const peak = new Map<Feature, number>();
    for (const w of this.#w.values()) {
      for (const [f, v] of w) peak.set(f, Math.max(peak.get(f) ?? 0, Math.abs(v)));
    }
    const keep = new Set(
      [...peak.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, Math.floor(this.maxVocab * 0.8))
        .map(([f]) => f),
    );
    for (const [t, w] of this.#w) {
      const g2 = this.#g2.get(t)!;
      for (const f of [...w.keys()]) {
        if (!keep.has(f)) {
          w.delete(f);
          g2.delete(f);
        }
      }
    }
    this.#vocab = keep;
  }

  toJSON(): ModelJSON {
    return {
      kind: this.kind,
      v: 1,
      lr: this.lr,
      margin: this.margin,
      minExamples: this.minExamples,
      maxVocab: this.maxVocab,
      examples: this.examples,
      w: Object.fromEntries([...this.#w].map(([k, m]) => [k, Object.fromEntries(m)])),
      g2: Object.fromEntries([...this.#g2].map(([k, m]) => [k, Object.fromEntries(m)])),
      bias: Object.fromEntries(this.#bias),
    };
  }

  static fromJSON(data: any, opts: LinearOptions = {}): Linear {
    const l = new Linear({
      lr: data?.lr,
      margin: data?.margin,
      minExamples: data?.minExamples,
      maxVocab: data?.maxVocab,
      ...opts,
    });
    for (const [id, feats] of Object.entries((data?.w ?? {}) as Record<string, Record<string, number>>)) {
      const m = new Map(Object.entries(feats));
      l.#w.set(id, m);
      l.#g2.set(id, new Map(Object.entries((data?.g2?.[id] ?? {}) as Record<string, number>)));
      l.#bias.set(id, data?.bias?.[id] ?? 0);
      for (const f of m.keys()) l.#vocab.add(f);
    }
    l.examples = data?.examples ?? 0;
    return l;
  }
}
