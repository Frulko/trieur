---
layout: ../../layouts/Doc.astro
title: Zones et geste
description: Pourquoi une zone est un emplacement et pas une étiquette, et comment la scène est découpée.
---

## Une zone est un emplacement, pas une étiquette

La touche d'une zone vient de sa **position**, pas de son libellé. Changer ce qu'il y a dans
une zone ne change donc pas le geste, et le geste reste mémorisable. C'est la différence
entre « appuyer sur <kbd>d</kbd> » et « chercher où est passé *dev* ».

```js
zones: [
  { id: 'a-lire', label: 'À lire' },  // touche a
  null,                                // touche s — zone libre
  { id: 'jeter', label: 'Jeter' },     // touche d
]
```

Une entrée `null` est une **zone libre** : y déposer une carte n'exécute rien, ça appelle
`onAssign(index, item)`. À l'hôte de demander quoi y mettre, puis de reposer ses zones.

## La scène est découpée, pas seulement décorée

Chaque zone possède une **région** de la scène, tracée en bordure fine : le diagramme de
Voronoï des positions. Pour un cercle ça donne les secteurs attendus, pour une grille des
cases, pour une disposition maison le pavage correspondant — c'est la même formule.

Cette région n'est pas qu'un dessin : **le dépôt vise la région sous le doigt**, pas un
angle approximatif. Ce qu'on voit est ce qu'on touche. (`segments: false` n'affiche que les
tuiles ; on retombe alors sur un ciblage angulaire.)

Le calcul tient en quarante lignes — on part du rectangle de la scène et on le coupe par la
médiatrice de chaque paire de germes. Pas de dépendance géométrique, et `voronoi(points, w, h)`
est exporté si tu veux les polygones.

## Dispositions

`layout` accepte `'circle'` (défaut), `'voronoi'`, `'grid'`, ou ta propre fonction :

```js
layout: (n, { w, h, clear }) => Array.from({ length: n }, (_, i) => ({ x: …, y: … }))
```

`clear` est le rayon à dégager au centre pour que les zones ne passent pas sous la carte.
Les marges valent une demi-tuile : une zone qui déborde de la scène est inatteignable au
doigt.

La disposition `'voronoi'` place les germes selon une spirale phyllotaxique — angle d'or,
donc jamais alignés. Les cellules qui en découlent forment une mosaïque irrégulière plutôt
qu'une part de tarte. C'est déterministe : même nombre de zones, même dessin.

## Une tuile, pas une étiquette

Le rendu par défaut est un dossier façon Finder : pastille de 46 px remplie de la couleur de
la zone (`color`), ou son emoji (`icon`), ou son image (`image`) ; libellé sur deux lignes ;
touche en pied. `renderZone(zone, el)` reprend la main si tu veux autre chose.

## Une carte se glisse d'un bloc

Image, texte, marges : tout attrape la carte. Le navigateur ne peut plus démarrer son propre
glisser d'image, le texte ne se sélectionne pas, l'appui long n'ouvre pas le menu contextuel.

**Les liens et les boutons restent cliquables** : un appui sans mouvement passe le clic, un
mouvement de plus de six pixels prend la main pour le glisser et annule le clic qui aurait
suivi. Les champs de saisie gardent la priorité tout de suite. Sans ça, une carte dont le
lien couvre la moitié de la surface deviendrait impossible à trier.

## Les animations disent quelque chose

- **Effet « génie »** : la carte rangée est aspirée dans sa tuile, au clavier comme au doigt.
  Une carte lancée hors écran ne dit pas où elle a atterri ; celle-ci si.
- **Rétrécissement progressif** pendant le glisser : la carte « rentre » dans la zone visée
  avant d'être lâchée.
- **Dépilement** après un rangement, **rempilement par le dessus** après une annulation :
  l'entrée dit d'où vient la carte.
- **La tuile accuse réception** d'un petit rebond, à l'aller comme au retour.

Tout est désactivé sous `prefers-reduced-motion`.

## Plein écran

Le bouton *Agrandir* passe la zone de tri en modale plein écran ; `Échap` ou la croix en
reviennent. Ce n'est volontairement pas l'API Fullscreen : elle rendrait la page inerte,
couperait les liens des cartes et se comporte mal en iframe.

```js
deck.expand(true);
deck.expanded; // état courant
```

## Style

Tout passe par des variables CSS sur `.tr` : `--tr-accent`, `--tr-card-bg`, `--tr-card-w`,
`--tr-card-h`, `--tr-radius`, `--tr-line`. Les classes sont stables si tu préfères réécrire
la feuille : `.tr`, `.tr-stage`, `.tr-zones`, `.tr-zone` (`.tr-near`, `.tr-armed`,
`.tr-suggest`), `.tr-cards`, `.tr-card` (`.tr-behind`, `.tr-dragging`, `.tr-genie`),
`.tr-bar`.
