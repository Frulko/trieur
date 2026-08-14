# @trieur/learn

Apprentissage **en ligne** du rangement : aucune phase d'entraînement, le modèle apprend de
la carte qu'on vient de ranger et se sérialise en JSON. Zéro dépendance.

```bash
npm i @trieur/learn
```

```js
import { createRecommender } from '@trieur/learn';

const brain = createRecommender({ key: 'liens' });                        // léger
const brain = createRecommender({ key: 'liens', server: { url, token } }); // complet

deck.setOptions({ advisor: brain });
```

## L'échelle

| Barreau | Ce que ça apporte | Ce que ça coûte |
|---|---|---|
| `Bayes` | apprend dès le 3ᵉ exemple, s'explique | suppose les traits indépendants |
| `crosses()` | `domaine×tag` rend la combinaison visible, sans changer de modèle | le vocabulaire explose |
| `Linear` | des poids appris ; encaisse les traits corrélés | un pas — réglé par AdaGrad |
| `Knn` | le meilleur démarrage à froid | il faut garder le corpus |
| `Ensemble` | les fait voter, pondérés par leur justesse **mesurée** | trois modèles à nourrir |

Tous partagent la même interface et le même jeu de traits, donc ils se comparent :

```bash
bun tools/bench.ts mon-corpus.jsonl   # évaluation prequential, top-1 / top-3
```

## Aussi dans le paquet

- `tokens`, `crosses`, `only`, `pipe` — des métadonnées aux traits creux.
- `memoryStore`, `localStore`, `idbStore`, `autoStore` — où vit le modèle.
- `@trieur/learn/protocol` — les types du dialogue avec [`@trieur/server`](../server).
- `@trieur/learn/bench` — `evaluate()` et `synth()`, pour mesurer depuis ton app.

Documentation complète : [trieur.dev/docs/modele](https://trieur.dev/docs/modele).

MIT.
