// Combiner plusieurs avis sans décréter lequel a raison.
//
// C'est l'algorithme des experts (Hedge / poids multiplicatifs), et il sert à deux
// endroits : entre les modèles creux d'un `Ensemble`, et côté serveur entre les modèles
// creux et les embeddings. Un seul fichier pour les deux, sinon les deux formules
// divergent le jour où on en retouche une.

import { softmax, type Feature, type Ranked } from './types.js';

export interface Tally {
  hits: number;
  seen: number;
}

/**
 * Poids d'un ensemble d'experts d'après leurs erreurs passées.
 *
 * Chaque expert pèse `exp(-η × ses erreurs)`, avec `η = √(2 ln N / T)`. Ce taux décroît
 * avec le nombre de tours : au début les poids restent proches (on ne sait pas encore qui
 * a raison), puis l'écart se creuse à mesure que les preuves s'accumulent. La garantie
 * classique de l'algorithme, c'est qu'à long terme l'ensemble fait aussi bien que son
 * meilleur expert — sans qu'on ait eu à le désigner à l'avance.
 *
 * Un expert jamais interrogé compte pour une erreur sur deux : neutre, il ne prend pas la
 * main par le seul fait d'être neuf.
 */
export function hedge(tallies: Tally[]): number[] {
  if (!tallies.length) return [];
  const n = Math.max(tallies.length, 2);
  const rounds = Math.max(...tallies.map((t) => t.seen), 1);
  const eta = Math.sqrt((2 * Math.log(n)) / rounds);
  return softmax(tallies.map((t) => -eta * (t.seen ? (t.seen - t.hits) / t.seen : 0.5) * rounds));
}

/** Mélange des classements pondérés. Un expert qui se tait (`[]`) ne pèse pas. */
export function blend(votes: Ranked[][], weights: number[]): Ranked[] {
  const scores = new Map<string, number>();
  const why = new Map<string, Feature[]>();
  let voted = false;
  votes.forEach((ranked, i) => {
    if (!ranked.length) return;
    voted = true;
    const w = weights[i] ?? 0;
    for (const r of ranked) {
      scores.set(r.id, (scores.get(r.id) ?? 0) + w * r.score);
      if (r.why.length && !why.has(r.id)) why.set(r.id, r.why);
    }
  });
  if (!voted) return [];
  const sum = [...scores.values()].reduce((a, b) => a + b, 0) || 1;
  return [...scores.entries()]
    .map(([id, s]) => ({ id, score: s / sum, why: why.get(id) ?? [] }))
    .sort((a, b) => b.score - a.score);
}
