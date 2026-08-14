// Le dessin d'une carte appartient au site, pas à la lib : `renderCard` est justement le
// point où trieur passe la main. Il ne sait pas ce qu'est un lien, un dossier ou un tag.

import type { Lien } from '../data/liens';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function renderCard(l: Lien, el: HTMLElement): void {
  el.innerHTML = `
    <div class="lien">
      <span class="host">${esc(l.host)}</span>
      <h4>${esc(l.title)}</h4>
      <p>${esc(l.excerpt)}</p>
      <div class="tags">${l.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>
    </div>`;
}
