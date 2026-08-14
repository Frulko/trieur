# trieur

Trier une pile de cartes dans des zones — au doigt, à la souris ou au clavier — et un modèle
qui apprend, à chaque rangement, où la carte suivante ira probablement.

Le geste sans le modèle, c'est un tri manuel agréable. Le modèle sans le geste, c'est un
classifieur sans interface. Ensemble, la boucle se referme : ranger entraîne, et
l'entraînement raccourcit le rangement suivant — jusqu'à ce que `↵` suffise.

```bash
bun i
bun run dev      # le site et ses démos
bun test         # les trois paquets
bun run bench    # le banc d'essai des modèles
```

## Structure

```
packages/
  core/     la scène, les zones, le geste, les animations   → @trieur/core   (0 dépendance)
  learn/    traits, modèles, stockage local, protocole      → @trieur/learn  (0 dépendance)
  server/   événements, rejeu, embeddings                   → @trieur/server (Bun + SQLite)
site/       Astro : documentation et démos
```

Modules ES publiés en JavaScript avec leurs déclarations de types. Pas de bundler
nécessaire, pas de dépendance d'exécution.

## En trente secondes

```js
import { Deck } from '@trieur/core';
import { createRecommender } from '@trieur/learn';
import '@trieur/core/trieur.css';

const brain = createRecommender({ key: 'liens' }); // modèle local, IndexedDB

new Deck(document.querySelector('#tri'), {
  items: liens,
  zones: [{ id: 'dev' }, { id: 'ia' }, null, { id: 'maison' }], // null = zone libre
  advisor: brain,
  meta: (l) => ({ domain: l.host, tag: l.tags, title: l.title }), // ce que le modèle regarde
  renderCard: (l, el) => (el.innerHTML = gabarit(l)),
  onSort: (l, zone) => api.ranger(l.id, zone.id), // async ; un rejet remet la carte
});
```

| Touche | Effet |
|---|---|
| lettre d'une zone | y range la carte |
| `↵` | accepte la zone proposée par le modèle |
| `espace` | passer |
| `⌫` | annuler — et **désapprendre** l'exemple |

## Les principes qui expliquent le reste

**La lib ne sait rien du domaine.** Pas de « favori », pas de « dossier », ni dans le code ni
dans les noms de classes CSS. Elle trie des objets opaques dans des zones opaques. Ce qui
connaît le sujet vit chez l'appelant : `renderCard` dessine, `onSort` exécute, `meta` décide
de ce que le modèle a le droit de regarder.

**L'appelant décide, et peut refuser.** `onSort` est asynchrone et peut échouer — un rejet
remet la carte en place. La lib ne mute jamais rien en dehors de sa propre pile.

**La prédiction ne bloque jamais le geste.** La carte est déjà sous le doigt quand il faut
proposer une zone. Le modèle local répond en microsecondes ; le serveur n'est consulté que
lorsque le local se tait, avec un délai maximum court, et son silence n'empêche rien.

**Ne rien proposer plutôt que proposer au hasard.** Trop peu d'exemples, ou aucun trait
reconnu, et `predict()` rend une liste vide. Une mauvaise proposition coûte plus cher qu'une
absence de proposition : elle fait perdre confiance dans toutes les suivantes.

**Les poids sont mesurés, pas décrétés.** Quand plusieurs modèles votent, leur poids vient de
leur justesse observée. Aucun coefficient magique dans le code.

## Une zone est un emplacement, pas une étiquette

La touche vient de la **position**, pas du libellé : changer ce qu'il y a dans une zone ne
change pas le geste, et le geste reste mémorisable. Une entrée `null` est une zone libre — y
déposer une carte appelle `onAssign(index)` au lieu de ranger.

Chaque zone possède une **région** de la scène, le diagramme de Voronoï des positions : des
secteurs pour un cercle, des cases pour une grille, le pavage correspondant pour une
disposition maison — même formule. Et ce n'est pas qu'un dessin : **le dépôt vise la région
sous le doigt**. Ce qu'on voit est ce qu'on touche.

## L'échelle du modèle

Bayes naïf plafonne quand les traits interagissent : « github *et* rust » n'est pas la somme
de « github » et de « rust ». Tous les barreaux tiennent sur le même jeu de traits et la même
interface `Model`, donc on peut les monter un par un — et les comparer.

| Barreau | Ce que ça apporte | Ce que ça coûte |
|---|---|---|
| `Bayes` | apprend dès le 3ᵉ exemple, s'explique, cent lignes | suppose les traits indépendants |
| `crosses()` | `domaine×tag` rend la combinaison visible, **sans changer de modèle** | le vocabulaire explose, il faut élaguer |
| `Linear` | des poids appris au lieu de comptes ; encaisse les traits corrélés | un pas d'apprentissage — réglé tout seul par AdaGrad |
| `Knn` | « ce lien ressemble à ceux-là » : le meilleur démarrage à froid | il faut garder le corpus |
| embeddings | rapproche deux cartes qui ne partagent **aucun mot** | un serveur et un appel réseau |

`defaultModel()` ne choisit pas : les trois modèles creux votent, pondérés par leur justesse
mesurée avant apprentissage (algorithme des experts). La garantie de cet algorithme, c'est
qu'à long terme l'ensemble fait aussi bien que son meilleur membre — sans qu'on ait eu à le
désigner.

### Mesuré, pas supposé

`bun run bench` évalue en **prequential** : chaque carte est d'abord soumise au modèle qui ne
l'a jamais vue, on note s'il avait raison, ensuite seulement il l'apprend. Pas de séparation
train/test à bricoler, pas de fuite possible, et le chiffre obtenu est celui que vit
l'utilisateur.

Sur un corpus réel de 3 412 liens rangés à la main dans 72 dossiers :

```
modèle                 top-1     top-3     muet    vocab      ms
────────────────────────────────────────────────────────────────
bayes                 33.1 %    57.1 %     0.7 %   49221     490
bayes + croisés       33.6 %    57.4 %     0.7 %   65385     449
linéaire              32.5 %    53.2 %     0.7 %   32789     796
linéaire + croisés    32.8 %    54.7 %     0.7 %   38797     911
kNN                   32.1 %    54.4 %     0.7 %   27421    4420
kNN + croisés         31.8 %    54.7 %     0.7 %   34798    5253
ensemble              35.8 %    60.9 %     0.7 %   49221   12158 ←
ensemble + croisés    35.3 %    61.3 %     0.7 %   65385   13698
```

Deux enseignements qu'on n'aurait pas devinés :

- **Le croisement ne rapporte presque rien ici** (+0,5 point), alors qu'il vaut sept à onze
  points sur un corpus où les interactions dominent. Il paie quand les interactions existent,
  pas par principe.
- **L'ensemble bat chacun de ses membres**, ce qui n'a rien d'automatique : il ne le fait que
  parce que ses poids suivent les erreurs mesurées.

Avec 72 zones, le hasard ferait 1,4 %. `bun run bench mon-corpus.jsonl` mesure sur le tien —
une ligne `{"meta": {…}, "target": "…"}` par carte, dans l'ordre chronologique.

## Léger, puis complet

```js
const brain = createRecommender({ key: 'liens' });                          // léger
const brain = createRecommender({ key: 'liens', server: { url, token } });   // complet
```

C'est la seule différence dans l'app.

**Léger** — tout dans le navigateur (IndexedDB par défaut : `localStorage` plafonne à 5 Mo et
bloque le fil principal à chaque écriture). Rien ne sort, rien n'attend le réseau, ça marche
dans l'avion.

**Complet** — le local continue de répondre ; les événements partent en lot, chacun avec un
identifiant, dans une file **persistée** : un tri fait hors ligne repart au retour du réseau,
et un renvoi n'apprend rien deux fois. Le serveur garde les **événements**, pas seulement le
modèle — donc on peut tout rejouer après avoir changé d'extracteur de traits. Il démarre à
chaud un appareil neuf, et fait tourner ce qu'un onglet ne peut pas : les embeddings.

```bash
TRIEUR_TOKEN=secret bun run --cwd packages/server start
# + EMBED_URL / EMBED_MODEL / EMBED_KEY pour brancher les embeddings
```

## Documentation

Le site (`bun run dev`) contient la documentation complète et quatre démos : l'API
JavaScript, l'API en markup, le modèle qui apprend en direct — avec le banc d'essai qui
tourne dans l'onglet — et un mode complet dont on peut couper le réseau pour voir la file
tenir.

## Licence

MIT.
