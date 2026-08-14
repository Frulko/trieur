---
layout: ../../layouts/Doc.astro
title: Démarrer
description: Installer trieur et faire tourner un premier tri, avec ou sans modèle.
---

## Installer

```bash
npm i @trieur/core          # le geste seul
npm i @trieur/core @trieur/learn   # le geste + le modèle
```

## Un tri, sans modèle

```html
<link rel="stylesheet" href="node_modules/@trieur/core/trieur.css" />
<div id="tri"></div>

<script type="module">
  import { Deck } from '@trieur/core';

  new Deck(document.querySelector('#tri'), {
    items: [
      { id: 1, titre: 'Une chose' },
      { id: 2, titre: 'Une autre' },
    ],
    zones: [
      { id: 'garder', label: 'Garder' },
      { id: 'jeter', label: 'Jeter' },
    ],
    renderCard: (item, el) => (el.innerHTML = `<h3>${item.titre}</h3>`),
    onSort: (item, zone) => fetch('/ranger', { method: 'POST', body: JSON.stringify({ item, zone }) }),
  });
</script>
```

C'est tout ce qu'il faut pour trier. `renderCard` est obligatoire en pratique : sans lui,
les cartes sont vides — la lib ne sait pas ce qu'il y a dedans, et c'est voulu.

Le conteneur `.tr-stage` est focusable : donne-lui le focus (`deck.focus()`) pour que le
clavier réponde.

## Ajouter le modèle

```js
import { createRecommender } from '@trieur/learn';

const brain = createRecommender({ key: 'liens' }); // modèle local, IndexedDB

new Deck(el, {
  items,
  zones,
  advisor: brain,
  // ce que le modèle a le droit de regarder — à toi de choisir
  meta: (lien) => ({ domain: lien.host, tag: lien.tags, title: lien.title }),
  renderCard,
  onSort,
});
```

Rien d'autre à câbler : le deck prévient le recommandeur à chaque rangement et à chaque
annulation, marque la zone proposée d'un liseré, et `↵` l'accepte.

## Le geste

| Touche | Effet |
|---|---|
| lettre d'une zone | y range la carte |
| `↵` | accepte la zone proposée par le modèle |
| `espace` | passer — la carte revient en fin de pile |
| `⌫` | annuler le dernier rangement, et le désapprendre |

À la souris et au doigt, c'est le même code (Pointer Events) : on tire la carte vers une
zone, on lâche. La carte rétrécit à mesure qu'elle s'approche — elle « rentre » dans la
zone visée avant même d'être lâchée.

## En markup

Les zones et le gabarit de carte peuvent se déclarer en HTML, sans écrire de JS :

```html
<script type="module">import '@trieur/core/element';</script>

<trieur-deck id="tri" layout="voronoi">
  <trieur-zone value="a-lire" key="a">À lire</trieur-zone>
  <trieur-zone value="jeter">Jeter</trieur-zone>
  <trieur-zone></trieur-zone><!-- zone libre -->

  <template data-card>
    <h3 data-field="titre"></h3>
    <img data-field="image" data-attr="src" alt="" />
  </template>
</trieur-deck>
```

Le JS l'emporte toujours sur le markup : un hôte qui construit ses zones à partir de
données garde la main. Voir la [démo en markup](/demos/markup).
