# trieur — notes pour l'agent

Monorepo Bun. Trois paquets publiables sans dépendance d'exécution, plus un site Astro qui
sert de documentation **et** de banc d'essai visuel.

```bash
bun test                 # les trois paquets
bunx tsc -b packages/core packages/learn packages/server
bun run bench            # banc d'essai des modèles (corpus synthétique)
bun run dev              # site + démos
```

## Règles

- **Aucune dépendance d'exécution.** Si une dépendance semble nécessaire, c'est probablement
  que la fonctionnalité n'a pas sa place ici. `typescript` et `astro` sont des outils de
  développement, pas des dépendances.
- **Rien du domaine dans `core` ni `learn`.** Pas de « favori », « bookmark », « dossier »
  dans le code ni dans les classes CSS. On trie des objets opaques dans des zones opaques.
- **Pas de bundler.** `tsc -b` uniquement. Les imports portent l'extension `.js` en source :
  c'est ce qui rend la sortie exécutable telle quelle par Node et les navigateurs.
- **Un chiffre annoncé est un chiffre mesuré.** Toute affirmation de performance dans une doc
  doit être reproductible par `tools/bench.ts`. Si le banc contredit la doc, la doc a tort.
- **Le site pointe sur les *sources* des paquets** (alias Vite dans `astro.config.mjs`), pas
  sur `dist/` : une démo casse tout de suite, pas après un build oublié.

## Fichiers

| Fichier | Rôle |
|---|---|
| `packages/core/src/deck.ts` | la classe `Deck` : pile, zones, rendu, actions |
| `packages/core/src/drag.ts` | le geste, isolé du tri (engagement, clics annulés) |
| `packages/core/src/voronoi.ts` | découpage de la scène, `inPolygon` |
| `packages/core/src/layouts.ts` | `circle`, `voronoi` (spirale d'or), `grid` |
| `packages/core/src/anim.ts` | entrées, sortie « génie », rebond des tuiles |
| `packages/core/src/element.ts` | `<trieur-deck>` / `<trieur-zone>` |
| `packages/learn/src/features.ts` | traits creux, croisements, `pipe` |
| `packages/learn/src/{bayes,linear,knn}.ts` | les trois modèles creux |
| `packages/learn/src/hedge.ts` | poids des experts + mélange — **une seule formule pour tout le dépôt** |
| `packages/learn/src/recommender.ts` | mode léger, mode complet, file hors ligne |
| `packages/learn/src/protocol.ts` | types du dialogue, importés des deux côtés |
| `packages/learn/src/bench.ts` | `evaluate()` prequential + corpus synthétique |
| `packages/server/src/api.ts` | routes, `Request → Response`, testable sans port |
| `packages/server/src/db.ts` | schéma SQLite, `INSERT OR IGNORE` sur l'id d'événement |
| `packages/server/src/embed.ts` | embeddings + index vectoriel |
| `packages/server/src/serve.ts` | l'exécutable (`index.ts` n'exporte que la lib) |

## Pièges déjà payés — ne pas les réintroduire

### Sur le modèle

- **Ignorer les traits jamais vus à la prédiction.** Sinon chaque mot inconnu d'un titre
  pénalise la zone qui a beaucoup appris (gros dénominateur) et fait gagner une zone vierge.
- **Se taire plutôt qu'inventer** : pas assez d'exemples, ou aucun trait reconnu → `[]`.
- **La mise à jour du linéaire est contrastive, pas dense.** Une logistique multinomiale
  classique touche toutes les zones à chaque exemple : `|vocab| × |zones|` entrées à
  sérialiser dans un navigateur. On ne touche que la bonne zone et la meilleure fautive.
- **Les poids d'ensemble se mesurent avant d'apprendre** (prequential). Mesurer après, c'est
  mesurer sur des exemples déjà vus.
- **Le corpus synthétique ne doit jamais contenir la réponse dans le titre.** C'est arrivé :
  le banc affichait 95 % et ne mesurait rien.

### Sur le serveur

- **`INSERT OR IGNORE` sur l'id d'événement.** Un événement appris deux fois fausse le modèle
  durablement et silencieusement. Vérifier l'ordre des liaisons SQL : un décalage transforme
  une contrainte `NOT NULL` en insertion ignorée sans erreur — c'est arrivé aussi.
- **Les embeddings partent après la réponse.** Personne n'attend un fournisseur tiers pour
  qu'un rangement soit accepté.
- **`api.flush()` sur SIGINT/SIGTERM**, sinon c'est du travail de tri perdu.

### Sur le deck

- **Une carte en vol survit au rendu suivant.** `render()` conserve les `.tr-genie` et ne les
  *touche pas* : les réinsérer annule la transition et fait sauter la carte à l'arrivée.
- **Les entrées passent par `animateFrom()`** : état de départ inline, reflow forcé, relâche.
  Sans le `void el.offsetWidth`, le navigateur ne voit qu'un état et n'anime rien.
- **Le découpage est la vérité du dépôt.** `zoneAt()` teste l'appartenance à la cellule ; le
  ciblage angulaire n'est qu'un repli quand `segments: false`. Ne pas les désynchroniser.
- **Changer de zones ne remonte pas la lib** (`setZones`), sinon les cartes déjà rangées
  réapparaissent et l'historique d'annulation est vidé.
- **Le JS l'emporte sur le markup**, jamais l'inverse.
- **Un lien dans une carte ne bloque pas le glisser** : six pixels de mouvement décident, et
  le clic qui suivrait est annulé en capture.
- **`best()` peut être asynchrone.** Le jeton `#ask` jette une réponse tardive : un serveur
  lent ne doit pas faire apparaître une proposition sur la carte suivante.
- **Le plein écran n'est pas l'API Fullscreen** : elle rend la page inerte et casse les liens
  des cartes. Après bascule, rappeler `layout()`.

## Choses volontairement absentes

- Pas de virtualisation : on affiche deux cartes, la pile peut en faire dix mille.
- Pas de multi-sélection ni de sous-zones — un tri, un coup par carte.
- Pas de fusion de deux modèles divergents : le serveur *remplace* le local au démarrage à
  chaud, et rien d'autre. Le jour où deux appareils trient vraiment en parallèle, la réponse
  est de faire rejouer le serveur.
- Pas d'index vectoriel approché : comparaison exhaustive tant que le corpus tient en
  mémoire.
