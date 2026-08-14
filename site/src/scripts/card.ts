// Drawing a card belongs to the site, not to the library: `renderCard` is exactly where
// trieur hands over. It does not know what a link, a folder or a tag is.

import type { Link } from '../data/links';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function renderCard(l: Link, el: HTMLElement): void {
  // the host is a real link: a tap opens it, a drag sorts the card. Both, from the same
  // pixels — which is the thing that breaks the moment a library captures the pointer early.
  el.innerHTML = `
    <div class="link">
      <a class="host" href="https://${esc(l.host)}" target="_blank" rel="noopener">${esc(l.host)} ↗</a>
      <h4>${esc(l.title)}</h4>
      <p>${esc(l.excerpt)}</p>
      <div class="tags">${l.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>
    </div>`;
}
