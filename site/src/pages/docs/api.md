---
layout: ../../layouts/Doc.astro
title: Référence
description: Options, méthodes et types de @trieur/core et @trieur/learn.
---

## `new Deck(root, options)`

| Option | Défaut | Rôle |
|---|---|---|
| `items` | `[]` | pile à trier ; le premier élément est la carte du dessus |
| `zones` | `[]` | zones : `{ id, label?, key?, color?, icon?, image? }`, ou `null` pour une zone libre |
| `renderCard(item, el)` | — | dessine la carte (obligatoire en pratique) |
| `renderZone(zone, el)` | tuile façon dossier | dessine une zone |
| `meta(item)` | l'item | ce que le modèle a le droit de regarder |
| `advisor` | — | un `Recommender`, ou tout objet avec `best()` |
| `minConfidence` | `0.45` | score minimum pour qu'une zone soit proposée |
| `layout` | `'circle'` | `'circle'`, `'voronoi'`, `'grid'`, ou `(n, box) => [{x,y}]` |
| `segments` | `true` | découpe la scène en régions et vise à la région |
| `keys` | `'asdfghjkl…'` | touches attribuées aux zones, dans l'ordre |
| `threshold` | `90` | distance de glisser au-delà de laquelle le dépôt est armé, en px |
| `text` | `fr` | libellés (`en` fourni, ou les tiens) |
| `onSort(item, zone)` | — | exécute le rangement ; peut être `async`, un rejet annule |
| `onUndo(item, zone)` | — | défait le dernier rangement |
| `onSkip(item)` | — | carte repoussée en fin de pile |
| `onAssign(index, item)` | — | dépôt sur une zone libre |
| `onEmpty()` | — | pile vide |

### Méthodes

```js
deck.setItems(items)        // remplace la pile
deck.setZones(zones)        // remplace les zones (relance l'attribution des touches)
deck.setOptions(patch)      // change une partie de la configuration
deck.commit(zone, fling?)   // range la carte du dessus (ce que fait une touche)
deck.skip()                 // repousse la carte en fin de pile
deck.undo()                 // défait le dernier rangement
deck.suggest()              // recalcule la proposition
deck.expand(on)             // plein écran
deck.layout()               // replace les zones (après un resize manuel)
deck.zoneAt(x, y)           // zone sous un point de l'écran
deck.destroy()              // retire tout du DOM et les écouteurs

deck.current                // carte du dessus
deck.zones                  // zones placées (avec index, key, angle, pos, cell)
deck.prediction             // { id, score, why } ou null
deck.expanded               // état du plein écran
```

## `<trieur-deck>` et `<trieur-zone>`

Attributs de `<trieur-deck>` : `layout`, `keys`, `threshold`, `min-confidence`, `segments`.

Attributs de `<trieur-zone>` : `value` (l'id ; absent = zone libre), `key`, `label` (à
défaut, le texte de la balise), `color`, `icon`, `image`.

Propriétés JS : `.options`, `.items`, `.zones`, `.deck`, `.current`, `.prediction`.
Méthodes : `.skip()`, `.undo()`, `.focus()`.

Ajoutée, modifiée ou retirée à chaud, une zone suit — **sans interrompre le tri en cours**.

## Modèles

```ts
interface Model {
  readonly kind: string;
  readonly examples: number;
  learn(features: string[], target: string, weight?: number): void;
  predict(features: string[], targets: string[]): Ranked[];
  toJSON(): ModelJSON;
}
```

| Classe | Options |
|---|---|
| `Bayes` | `alpha` (0.4), `minExamples` (3) |
| `Linear` | `lr` (0.5), `margin` (1), `minExamples` (3), `maxVocab` (40 000) |
| `Knn` | `k` (12), `capacity` (1500), `probe` (24), `minExamples` (1) |
| `Ensemble` | `new Ensemble([…modèles])` |

`modelFromJSON(json)` reconstruit n'importe lequel ; un JSON inconnu rend `defaultModel()`.

## Traits

```js
tokens(meta)                              // métadonnées → traits
crosses([['domain', 'tag']], max = 4)     // ajoute les croisements
only('domain', 'tag')                     // ne garde que ces clés
pipe(tokens, crosses([…]), only(…))       // enchaîne
defaultFeatures                            // tokens + croisements domaine/auteur/hôte × tag
```

## Recommandeurs

```js
createRecommender({ key, model?, features?, store?, minConfidence?, saveDelay?, server? })
```

`server` absent → `LocalRecommender`. `server` présent → `HybridRecommender`, qui expose en
plus `pending`, `warm()` et `serverStats()`.

## Stockage

`memoryStore()`, `localStore(prefix)`, `idbStore(db, store)`, `autoStore()`.

```ts
interface Store {
  load<T>(key: string): Promise<T | null>;
  save(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
}
```

## Banc d'essai

```js
import { evaluate, synth, crossed } from '@trieur/learn/bench';
evaluate(nom, modèle, extracteur, cartes); // → { top1, top3, silent, vocab, ms, asked }
```

## Géométrie

`voronoi(points, w, h)` rend les polygones, `inPolygon(poly, x, y)` teste l'appartenance,
`layouts.circle | voronoi | grid` sont les dispositions fournies.
