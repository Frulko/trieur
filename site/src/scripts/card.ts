// Drawing a card belongs to the site, not to the library: `renderCard` is exactly where
// trieur hands over. It does not know what a link, a folder or a tag is.

import type { Link } from '../data/links';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function renderCard(l: Link, el: HTMLElement): void {
  el.innerHTML = `
    <div class="link">
      <span class="host">${esc(l.host)}</span>
      <h4>${esc(l.title)}</h4>
      <p>${esc(l.excerpt)}</p>
      <div class="tags">${l.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>
    </div>`;
}
