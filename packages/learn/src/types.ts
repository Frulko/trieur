// Le contrat commun à tous les modèles.
//
// Un modèle ne voit jamais un objet du domaine : il voit une liste de **traits creux**,
// des chaînes `clé:valeur`. C'est ce qui permet de changer de modèle sans toucher au reste,
// et de comparer deux modèles sur le même jeu de traits (cf. `tools/bench.ts`).

/** Un trait : une chaîne `clé:valeur`, par exemple `domain:github.com`. */
export type Feature = string;

/** Une zone classée, avec les traits qui ont pesé. */
export interface Ranked {
  id: string;
  /** dans [0,1], somme 1 sur les zones demandées */
  score: number;
  why: Feature[];
}

/** Même forme que `Prediction` de `@trieur/core` : les deux paquets restent indépendants. */
export type Prediction = Ranked;

export interface ModelJSON {
  kind: string;
  v: number;
  [k: string]: unknown;
}

export interface Model {
  /** identifiant du type de modèle, utilisé à la désérialisation */
  readonly kind: string;
  /** nombre d'exemples appris (les annulations le font redescendre) */
  readonly examples: number;

  /**
   * Apprend un rangement. `weight` négatif défait un exemple (annulation).
   */
  learn(features: Feature[], target: string, weight?: number): void;

  /**
   * Classe `targets` pour ces traits.
   *
   * Renvoie `[]` pour dire « je ne sais pas » — trop peu d'exemples, ou aucun trait connu.
   * **Ne rien proposer coûte moins cher que proposer au hasard** : une mauvaise
   * proposition fait perdre confiance dans toutes les suivantes.
   */
  predict(features: Feature[], targets: string[]): Ranked[];

  toJSON(): ModelJSON;
}

export interface Stats {
  examples: number;
  targets: number;
  vocab: number;
  /** justesse top-1 mesurée en prédiction-puis-apprentissage (prequential) */
  accuracy: number;
  /** justesse par membre, pour un ensemble */
  members?: Record<string, number>;
}

/** Un rangement tel que le deck le transmet (même forme que `SortRecord` de `@trieur/core`). */
export interface SortRecord<T = unknown> {
  item?: T;
  meta: unknown;
  zoneId: string;
  predicted?: string | null;
  at?: number;
  /** texte brut de l'item, si on veut que le serveur en calcule un embedding */
  text?: string;
}

/** Softmax d'un tableau de scores → distribution sommant à 1. Passe par le max pour éviter
 *  le débordement de `exp`. */
export function softmax(scores: number[]): number[] {
  if (!scores.length) return [];
  const max = Math.max(...scores);
  const exps = scores.map((s) => Math.exp(s - max));
  const sum = exps.reduce((a, b) => a + b, 0) || 1;
  return exps.map((e) => e / sum);
}
