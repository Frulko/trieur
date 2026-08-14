// Des métadonnées aux traits.
//
// Le choix des traits pèse plus que le choix du modèle. C'est pour ça qu'ils sont
// extraits ici, une fois, et que tous les modèles reçoivent exactement la même liste :
// comparer deux modèles n'a de sens que sur le même jeu de traits.

import type { Feature } from './types.js';

const STOP = new Set(
  ('le la les un une des de du et ou en au aux pour par sur avec sans dans ' +
    'the a an of to in on for and or is are with as at by from this that it its you your').split(' '),
);

/** Découpe une valeur texte en jetons utiles (mots de 3 à 24 lettres, sans mots vides). */
export function words(s: string): string[] {
  return String(s)
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3 && w.length <= 24 && !STOP.has(w));
}

/** Un extracteur transforme des métadonnées quelconques en traits. */
export type Extractor = (meta: unknown) => Feature[];

/**
 * Traits par défaut : chaque propriété devient un ou plusieurs jetons `clé:valeur`.
 *
 * - tableau → un trait par élément (`tag:react`)
 * - texte court (≤ 3 mots) → un trait tel quel (`domain:github.com`)
 * - texte long → un trait par mot (`title:hooks`)
 *
 * Les nombres et les booléens sont ignorés : ils ne discriminent pas un rangement, et un
 * modèle sur traits creux ne saurait qu'en faire.
 */
export const tokens: Extractor = (meta) => {
  const out: Feature[] = [];
  for (const [k, v] of Object.entries((meta ?? {}) as Record<string, unknown>)) {
    if (v == null) continue;
    if (Array.isArray(v)) {
      out.push(...v.filter((x): x is string => typeof x === 'string').map((x) => `${k}:${x.toLowerCase()}`));
    } else if (typeof v === 'string') {
      if (v.trim().split(/\s+/).length <= 3) out.push(`${k}:${v.trim().toLowerCase()}`);
      else out.push(...words(v).map((x) => `${k}:${x}`));
    }
  }
  return [...new Set(out)];
};

/** Une transformation de traits : reçoit la liste, en rend une autre. */
export type Transform = (features: Feature[]) => Feature[];

const keyOf = (f: Feature) => f.slice(0, f.indexOf(':'));

/**
 * Traits croisés : `domain:github.com` + `tag:rust` → `domain:github.com×tag:rust`.
 *
 * C'est le coup le plus rentable de toute l'échelle. Bayes naïf suppose les traits
 * indépendants : pour lui « github et rust » vaut exactement la somme de « github » et de
 * « rust ». Or c'est faux — la combinaison range ailleurs que chacun pris à part. Fabriquer
 * le croisement rend la combinaison visible **sans changer de modèle**.
 *
 * Le prix, c'est l'explosion du vocabulaire : n valeurs × m valeurs. D'où deux garde-fous :
 * on ne croise qu'une liste explicite de paires de clés, et au plus `max` valeurs par clé
 * (les tags d'une page sont déjà triés par pertinence par l'appelant). Le modèle linéaire
 * élague ensuite ce qui ne sert pas.
 */
export function crosses(pairs: Array<[string, string]>, max = 4): Transform {
  return (features) => {
    const byKey = new Map<string, Feature[]>();
    for (const f of features) {
      const k = keyOf(f);
      const list = byKey.get(k) ?? [];
      if (list.length < max) list.push(f);
      byKey.set(k, list);
    }
    const out = [...features];
    for (const [a, b] of pairs) {
      for (const fa of byKey.get(a) ?? []) {
        for (const fb of byKey.get(b) ?? []) {
          if (fa !== fb) out.push(fa < fb ? `${fa}×${fb}` : `${fb}×${fa}`); // ordre stable
        }
      }
    }
    return [...new Set(out)];
  };
}

/** Ne garde que les traits dont la clé est listée. */
export function only(...keys: string[]): Transform {
  const set = new Set(keys);
  return (features) => features.filter((f) => set.has(keyOf(f)));
}

/** Enchaîne un extracteur et des transformations. */
export function pipe(base: Extractor, ...steps: Transform[]): Extractor {
  return (meta) => steps.reduce<Feature[]>((f, step) => step(f), base(meta));
}

/** L'extracteur conseillé : jetons + croisements domaine/auteur × tag. */
export const defaultFeatures: Extractor = pipe(
  tokens,
  crosses([
    ['domain', 'tag'],
    ['author', 'tag'],
    ['host', 'tag'],
  ]),
);
