---
layout: ../../layouts/Doc.astro
title: Mesurer
description: Le banc d'essai prequential — sur le corpus synthétique, ou sur le tien.
---

Un tableau de blog ne dit pas quel modèle marche sur **tes** données. Le banc est donc
livré avec la lib, et exporté pour pouvoir tourner dans ton app.

## Le protocole

**Prequential** : tester-puis-apprendre. Chaque carte est d'abord soumise au modèle, qui ne
l'a jamais vue ; on note s'il avait raison ; ensuite seulement il l'apprend.

Aucune séparation train/test à bricoler, aucune fuite possible, et le chiffre obtenu est
exactement ce que vit l'utilisateur : la justesse d'un modèle qui découvre le corpus au fil
de l'eau. Les zones proposées sont celles **déjà rencontrées** — on ne demande pas au modèle
de deviner un dossier qui n'existe pas encore.

## En ligne de commande

```bash
bun tools/bench.ts                  # corpus synthétique, 2000 cartes
bun tools/bench.ts corpus.jsonl     # le tien
bun tools/bench.ts corpus.jsonl 500 # les 500 premières
```

Une ligne de JSONL par carte, dans l'ordre chronologique :

```json
{"meta": {"domain": "github.com", "tag": ["rust","cli"], "title": "…"}, "target": "dev"}
```

Sortie :

```
3412 cartes, 72 zones — corpus.jsonl

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

Ce corpus-là est réel : 3 412 liens rangés à la main dans 72 dossiers. Deux enseignements
qu'on n'aurait pas devinés :

- **Le croisement ne rapporte presque rien ici** (+0,5 point), alors qu'il vaut sept points
  sur le corpus synthétique. Les signaux marginaux — le domaine, l'auteur — dominent dans ce
  corpus-là. Le croisement paie quand les interactions existent, pas par principe.
- **L'ensemble bat chacun de ses membres**, ce qui n'a rien d'automatique : il ne le fait que
  parce que ses poids suivent les erreurs mesurées.

Avec 72 zones, un tirage au hasard ferait 1,4 % : 35,8 % top-1 et 61 % top-3, c'est un
dossier proposé juste une fois sur trois et présent dans la courte liste six fois sur dix.

## Dans une app

```ts
import { evaluate, crossed, synth } from '@trieur/learn/bench';
import { Bayes, Ensemble, Knn, Linear, tokens } from '@trieur/learn';

const cards = mesRangementsPasses(); // [{ meta, target }, …] dans l'ordre
const a = evaluate('bayes', new Bayes(), tokens, cards);
const b = evaluate('ensemble + croisés', new Ensemble([new Bayes(), new Linear(), new Knn()]), crossed, cards);

console.log(a.top1, b.top1);
```

La [démo du modèle](/demos/modele) fait exactement ça, dans l'onglet.

## Le corpus synthétique

`synth(n, seed)` fabrique un flux qui ressemble à un vrai tri, avec les trois régimes qu'on
rencontre :

- **signal marginal** — certains domaines partent toujours au même endroit ;
- **signal d'interaction** — pour les autres, c'est la combinaison domaine × tag qui décide,
  et rien ne le laisse deviner trait par trait ;
- **bruit** — un tirage sur dix part ailleurs.

Sans le régime d'interaction, tous les modèles se valent et le banc ne prouve rien. Le titre
des cartes parle du sujet mais **jamais de la zone** : y glisser la réponse rendrait le banc
flatteur et inutile.
