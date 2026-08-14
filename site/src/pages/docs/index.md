---
layout: ../../layouts/Doc.astro
title: Vue d'ensemble
description: Ce que fait trieur, comment les trois paquets se répartissent le travail.
---

trieur, c'est deux choses qui vont ensemble mais qui s'installent séparément :

1. **un geste** — une pile de cartes, des zones autour, un mouvement par carte ;
2. **un modèle** — qui apprend, à chaque rangement, où la carte suivante ira probablement.

Le geste sans le modèle, c'est un tri manuel agréable. Le modèle sans le geste, c'est un
classifieur sans interface. Ensemble, la boucle se referme : ranger entraîne, et
l'entraînement raccourcit le rangement suivant — jusqu'à ce que `↵` suffise.

## Trois paquets

| Paquet | Rôle | Dépendances |
|---|---|---|
| `@trieur/core` | la scène, les zones, le geste, les animations | aucune |
| `@trieur/learn` | les traits, les modèles, le stockage local, le protocole | aucune |
| `@trieur/server` | événements, rejeu, embeddings | Bun + SQLite (fournis par le runtime) |

Aucun bundler n'est nécessaire : ce sont des modules ES, publiés en JavaScript avec leurs
déclarations de types. Un `<script type="module">` suffit.

## Les principes qui expliquent le reste

**La lib ne sait rien du domaine.** Pas de « favori », pas de « dossier », rien de tel dans
le code ni dans les noms de classes CSS. Elle trie des objets opaques dans des zones
opaques. Ce qui connaît le sujet vit chez l'appelant : `renderCard` dessine, `onSort`
exécute, `meta` décide de ce que le modèle a le droit de regarder.

**L'appelant décide, et peut refuser.** `onSort` est asynchrone et peut échouer — un rejet
remet la carte en place. La lib ne mute jamais rien en dehors de sa propre pile.

**La prédiction ne bloque jamais le geste.** La carte est déjà sous le doigt quand il faut
proposer une zone. Le modèle local répond en microsecondes ; le serveur n'est consulté que
lorsque le local se tait, avec un délai maximum court, et son silence n'empêche rien.

**Ne rien proposer plutôt que proposer au hasard.** Trop peu d'exemples, ou aucun trait
reconnu, et `predict()` rend une liste vide. Une mauvaise proposition coûte plus cher qu'une
absence de proposition : elle fait perdre confiance dans toutes les suivantes.

**Les poids sont mesurés, pas décrétés.** Quand plusieurs modèles votent, leur poids vient
de leur justesse observée, mesurée avant apprentissage. Aucun coefficient magique dans le
code.

## Par où commencer

- [Démarrer](/docs/demarrer) — installer et faire tourner un premier tri.
- [Zones et geste](/docs/zones) — pourquoi une zone n'est pas une étiquette.
- [L'échelle du modèle](/docs/modele) — de Bayes aux embeddings, et quand monter d'un barreau.
- [Dans une app](/docs/integration) — mode léger, mode complet, hors ligne.
