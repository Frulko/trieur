# @trieur/core

The stage, the zones, the gesture. No dependencies, ES module, no build step.

```bash
npm i @trieur/core
```

```js
import { Deck } from '@trieur/core';
import '@trieur/core/trieur.css';

new Deck(document.querySelector('#sorter'), {
  items: [{ title: 'One thing' }, { title: 'Another' }],
  zones: [{ id: 'keep', label: 'Keep' }, { id: 'toss', label: 'Toss' }],
  renderCard: (item, el) => (el.innerHTML = `<h3>${item.title}</h3>`),
  onSort: (item, zone) => fetch('/file', { method: 'POST', body: JSON.stringify({ item, zone }) }),
});
```

Or in markup, without writing any JS:

```html
<script type="module">import '@trieur/core/element';</script>

<trieur-deck layout="voronoi" multi>
  <trieur-zone value="to-read" key="a">To read</trieur-zone>
  <trieur-zone value="toss">Toss</trieur-zone>
  <trieur-zone></trieur-zone><!-- free zone -->
  <template data-card><h3 data-field="title"></h3></template>
</trieur-deck>
```

- **Mouse, thumb and keyboard** through the same code (Pointer Events).
- **A zone is a spot**, not a label: the key comes from the position, so the gesture stays
  memorable when the content changes.
- **The stage is carved** (Voronoi) and the drop aims at the region under the finger.
- **Several zones per card** with `multi: true` — hold `⇧`, or latch the mode from the bar.
- **Domain-agnostic**: the library knows nothing about what it sorts.

For learning, add [`@trieur/learn`](https://github.com/Frulko/trieur/tree/main/packages/learn).
Full documentation and live demos: [frulko.github.io/trieur](https://frulko.github.io/trieur/).

MIT.
