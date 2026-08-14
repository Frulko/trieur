# @trieur/core

La scène, les zones, le geste. Zéro dépendance, module ES, pas de build.

```bash
npm i @trieur/core
```

```js
import { Deck } from '@trieur/core';
import '@trieur/core/trieur.css';

new Deck(document.querySelector('#tri'), {
  items: [{ titre: 'Une chose' }, { titre: 'Une autre' }],
  zones: [{ id: 'garder', label: 'Garder' }, { id: 'jeter', label: 'Jeter' }],
  renderCard: (item, el) => (el.innerHTML = `<h3>${item.titre}</h3>`),
  onSort: (item, zone) => fetch('/ranger', { method: 'POST', body: JSON.stringify({ item, zone }) }),
});
```

Ou en markup, sans écrire de JS :

```html
<script type="module">import '@trieur/core/element';</script>

<trieur-deck layout="voronoi">
  <trieur-zone value="a-lire" key="a">À lire</trieur-zone>
  <trieur-zone value="jeter">Jeter</trieur-zone>
  <trieur-zone></trieur-zone><!-- zone libre -->
  <template data-card><h3 data-field="titre"></h3></template>
</trieur-deck>
```

- **Souris, doigt et clavier** avec le même code (Pointer Events).
- **Une zone est un emplacement**, pas une étiquette : la touche vient de la position, donc
  le geste reste mémorisable quand le contenu change.
- **La scène est découpée** (Voronoï) et le dépôt vise la région sous le doigt.
- **Agnostique du domaine** : la lib ne sait rien de ce qu'elle trie.

Pour l'apprentissage, ajouter [`@trieur/learn`](../learn). Documentation complète et démos :
[trieur.dev](https://trieur.dev).

MIT.
