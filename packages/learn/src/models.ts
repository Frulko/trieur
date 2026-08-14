// Le registre : d'un JSON au modèle correspondant, et le modèle conseillé par défaut.

import { Bayes } from './bayes.js';
import { Ensemble } from './ensemble.js';
import { Knn } from './knn.js';
import { Linear } from './linear.js';
import type { Model, ModelJSON } from './types.js';

/**
 * Le modèle par défaut : les trois barreaux ensemble, pondérés par leur justesse mesurée.
 *
 * Pris séparément aucun ne domine partout — c'est ce que montre `tools/bench.ts`. Le kNN
 * répond seul sur les premières cartes, Bayes est solide au milieu, le linéaire gagne
 * quand les traits interagissent.
 */
export const defaultModel = (): Ensemble => new Ensemble([new Bayes(), new Linear(), new Knn()]);

/** Reconstruit un modèle sérialisé. Un JSON inconnu ou absent rend le modèle par défaut. */
export function modelFromJSON(json: ModelJSON | null | undefined): Model {
  switch (json?.kind) {
    case 'bayes':
      return Bayes.fromJSON(json);
    case 'linear':
      return Linear.fromJSON(json);
    case 'knn':
      return Knn.fromJSON(json);
    case 'ensemble':
      return Ensemble.fromJSON(json, modelFromJSON);
    default:
      return defaultModel();
  }
}
