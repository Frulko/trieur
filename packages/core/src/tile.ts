// Rendu par défaut d'une zone.
//
// Une zone est une tuile, pas une étiquette : pastille de 46 px remplie de sa couleur,
// ou son emoji, ou son image ; libellé sur deux lignes ; touche en pied. `renderZone`
// reprend la main si tu veux autre chose.

import type { DeckText, PlacedZone } from './types.js';

// Dossier plein, à la Finder : la couleur remplit, elle ne se contente pas d'un liseré.
const FOLDER =
  'M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z';

export function defaultTile(z: PlacedZone, text: DeckText): DocumentFragment {
  const frag = document.createDocumentFragment();

  const glyph = document.createElement('span');
  glyph.className = 'tr-glyph';
  if (z.image) {
    const img = document.createElement('img');
    img.src = z.image;
    img.alt = '';
    img.addEventListener('error', () => img.remove());
    glyph.append(img);
  } else if (z.icon) {
    glyph.textContent = z.icon;
  } else {
    glyph.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${FOLDER}" fill="currentColor"/></svg>`;
  }

  const label = document.createElement('span');
  label.className = 'tr-label';
  label.textContent = z.empty ? text.free : (z.label ?? z.id);
  frag.append(glyph, label);

  if (z.key) {
    const kbd = document.createElement('kbd');
    kbd.textContent = z.key;
    frag.append(kbd);
  }
  return frag;
}
