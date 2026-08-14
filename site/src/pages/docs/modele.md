---
layout: ../../layouts/Doc.astro
title: L'échelle du modèle
description: De Bayes naïf aux embeddings — ce que chaque barreau apporte, ce qu'il coûte, et quand le monter.
---

Tous les barreaux tiennent sur le **même jeu de traits** et la même interface. On peut donc
en changer sans toucher au reste de l'app, et surtout les comparer honnêtement.

```ts
interface Model {
  learn(features: string[], target: string, weight?: number): void;
  predict(features: string[], targets: string[]): Ranked[];
  toJSON(): ModelJSON;
}
```

Un modèle ne voit jamais un objet du domaine : il voit des **traits creux**, des chaînes
`clé:valeur`. C'est `meta()` puis l'extracteur qui décident de ce qui devient un trait.

## Les traits d'abord

Le choix des traits pèse plus que le choix du modèle. `tokens()` transforme des
métadonnées en traits :

- tableau → un trait par élément (`tag:react`)
- texte court (≤ 3 mots) → un trait tel quel (`domain:github.com`)
- texte long → un trait par mot (`title:hooks`)

Les nombres et les booléens sont ignorés : ils ne discriminent pas un rangement, et un
modèle sur traits creux ne saurait qu'en faire.

## Barreau 1 — Bayes naïf

Il apprend dès le troisième exemple, tient en cent lignes, se sérialise, et surtout il
**s'explique** : `predict()` rend un `why`, les traits qui ont pesé. On peut afficher
« proposé parce que `tag:react` et `domain:github.com` ».

Deux pièges déjà payés, à ne pas réintroduire :

- **Ignorer les traits jamais vus à la prédiction.** Sinon chaque mot inconnu d'un titre
  pénalise la zone qui a beaucoup appris — son dénominateur est gros — et fait gagner une
  zone vierge.
- **Se taire plutôt qu'inventer.** Pas assez d'exemples, ou aucun trait reconnu → liste vide.

Son plafond est connu et assumé : il suppose les traits indépendants. « github » et « rust »
votent séparément, jamais ensemble.

## Barreau 2 — croiser les traits

Le coup le plus rentable de toute l'échelle, et il ne change pas de modèle :

```js
import { crosses, pipe, tokens } from '@trieur/learn';

const features = pipe(tokens, crosses([['domain', 'tag']]));
// domain:github.com + tag:rust  →  domain:github.com×tag:rust
```

La combinaison devient un trait à part entière, donc visible par n'importe quel modèle
linéaire ou bayésien. Le prix, c'est l'explosion du vocabulaire : deux garde-fous, on ne
croise qu'une liste explicite de paires de clés, et au plus quatre valeurs par clé.

Mesuré sur le corpus synthétique du banc (où la zone dépend de la combinaison) : Bayes passe
de **61,3 %** à **68,4 %** top-1, le linéaire de 57,5 % à 68,8 %. Sur un corpus réel de
3 412 liens où les signaux marginaux dominent, le même croisement ne rapporte qu'un demi-point.
D'où la règle : [mesure sur ton corpus](/docs/mesurer).

## Barreau 3 — le modèle linéaire

Des poids **appris** au lieu de comptes. Deux traits corrélés cessent de voter deux fois, et
un trait croisé peut prendre un poids que ni l'un ni l'autre de ses composants n'a.

Trois choix qui comptent :

1. **Mise à jour contrastive.** La logistique multinomiale classique met à jour *toutes* les
   zones à chaque exemple : la matrice de poids devient `|vocab| × |zones|`, des centaines de
   milliers d'entrées à sérialiser dans un navigateur. On ne touche que deux zones — la
   bonne, et la meilleure des fautives. C'est la mise à jour du perceptron multiclasse, et
   elle reste creuse.
2. **AdaGrad plutôt qu'un pas fixe.** Le reproche fait à un modèle en ligne, c'est « un taux
   d'apprentissage à régler ». AdaGrad le règle par trait : un trait rare garde un grand pas,
   un trait vu partout se calme tout seul. Six lignes, un hyperparamètre en moins.
3. **Élagage.** Au-delà de `maxVocab`, les traits dont le poids maximum est le plus faible
   sont jetés — ceux qui n'ont jamais fait pencher une décision.

L'annulation (`weight: -1`) rejoue le pas dans l'autre sens. Ce n'est pas l'inverse exact —
AdaGrad a déjà bougé ses accumulateurs — mais sur une annulation isolée l'écart est
invisible, et un modèle en ligne n'a de toute façon pas de mémoire exacte de son passé.

## Barreau 4 — les k plus proches voisins

« Ce lien ressemble à ceux-là, et ils sont dans *dev*. » C'est le seul modèle utile **dès la
première carte** — le meilleur démarrage à froid — et le seul qui justifie sa réponse en
montrant des voisins plutôt que des traits.

Ce qu'il coûte : il faut garder le corpus. D'où le tampon circulaire — au-delà de `capacity`
cartes (1500 par défaut), la plus ancienne sort. Similarité cosinus pondérée par l'IDF (un
trait présent partout ne rapproche personne) et index inversé pour ne comparer qu'aux
voisins partageant au moins un trait rare.

## Barreau 5 — les embeddings

Le seul barreau qui ne peut pas vivre dans le navigateur : il demande soit un modèle embarqué
de plusieurs dizaines de mégaoctets, soit un appel réseau. C'est la raison d'être du
[mode complet](/docs/serveur).

Ce qu'il apporte que les traits creux n'apportent pas : « hooks » et « composants » sont deux
traits sans rapport pour Bayes, le kNN creux ou le linéaire — ils ne se rencontrent jamais
dans le même document. Dans l'espace des embeddings, ils sont voisins. **C'est le seul
barreau qui rapproche deux cartes ne partageant aucun mot.**

## Ne pas choisir : l'ensemble

Aucun des barreaux ne domine partout. Le kNN répond seul sur les premières cartes, Bayes
tient le milieu de terrain, le linéaire prend l'avantage quand les traits interagissent.
`defaultModel()` les fait donc voter.

**Les poids sont mesurés.** Avant d'apprendre un exemple, chaque membre est interrogé et sa
réponse comparée au rangement réel — évaluation *prequential*, jamais sur des exemples déjà
vus. Les erreurs accumulées donnent les poids par l'algorithme des experts (Hedge) :
`exp(-η × erreurs)` avec `η = √(2 ln N / T)`. La garantie classique de cet algorithme, c'est
qu'à long terme l'ensemble fait aussi bien que son meilleur membre — sans qu'on ait eu à le
désigner.

Sur le corpus réel de 3 412 liens dans 72 dossiers : **35,8 % top-1** et **60,9 % top-3**,
contre 33,1 / 57,1 pour le meilleur membre pris seul.

## Choisir soi-même

```js
import { Bayes, Ensemble, Knn, Linear, createRecommender, crosses, pipe, tokens } from '@trieur/learn';

const brain = createRecommender({
  key: 'liens',
  model: new Ensemble([new Bayes({ alpha: 0.3 }), new Linear({ maxVocab: 20_000 })]),
  features: pipe(tokens, crosses([['domain', 'tag'], ['author', 'tag']])),
  minConfidence: 0.5,
});
```
