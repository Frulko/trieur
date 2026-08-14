// Dispositions fournies. Une disposition place N zones autour du centre, en pixels.
// Les marges valent une demi-tuile : une zone qui déborde de la scène est inatteignable
// au doigt.

import type { Layout, Point } from './types.js';

const TAU = Math.PI * 2;

/** Ellipse épousant la scène : le cercle strict gâche l'espace en écran large. */
const circle: Layout = (n, { w, h, clear }) => {
  const rx = Math.max(60, Math.min(w / 2 - 60, Math.max(clear, w / 2 - 110)));
  const ry = Math.max(60, Math.min(h / 2 - 62, Math.max(clear, h / 2 - 90)));
  return Array.from({ length: n }, (_, i) => {
    const a = -Math.PI / 2 + (i / n) * TAU; // on démarre en haut, sens horaire
    return { x: Math.cos(a) * rx, y: Math.sin(a) * ry };
  });
};

/**
 * Spirale phyllotaxique : les germes s'écartent d'un angle d'or, donc jamais alignés.
 * Les cellules de Voronoï qui en découlent sont irrégulières — une mosaïque plutôt qu'une
 * part de tarte. Déterministe : même nombre de zones, même dessin.
 */
const spiral: Layout = (n, { w, h, clear }) => {
  const maxX = Math.max(60, w / 2 - 70);
  const maxY = Math.max(60, h / 2 - 80);
  return Array.from({ length: n }, (_, i) => {
    const a = i * 2.399963229728653; // angle d'or, en radians
    const t = Math.sqrt((i + 0.5) / n); // racine : densité constante, pas de tassement au bord
    return {
      x: Math.cos(a) * (clear * 0.6 + t * (maxX - clear * 0.6)),
      y: Math.sin(a) * (clear * 0.6 + t * (maxY - clear * 0.6)),
    };
  });
};

/** Grille : utile quand les zones sont nombreuses. */
const grid: Layout = (n, { w, h }) => {
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const stepX = (w - 130) / Math.max(cols - 1, 1);
  const stepY = (h - 130) / Math.max(rows - 1, 1);
  return Array.from({ length: n }, (_, i) => ({
    x: (i % cols) * stepX - ((cols - 1) * stepX) / 2,
    y: Math.floor(i / cols) * stepY - ((rows - 1) * stepY) / 2,
  }));
};

export const layouts: Record<string, Layout> = { circle, voronoi: spiral, grid };

/** Angle d'un vecteur, ramené dans [0, 2π[. */
export const angleOf = (x: number, y: number): number => (Math.atan2(y, x) + TAU) % TAU;

/** Écart angulaire absolu entre deux angles, dans [0, π]. */
export const angleGap = (a: number, b: number): number => {
  const d = Math.abs(a - b) % TAU;
  return d > Math.PI ? TAU - d : d;
};

/** `'circle'`, `'grid'`, `'voronoi'` ou ta propre fonction. */
export const resolveLayout = (l: Layout | string | undefined): Layout =>
  typeof l === 'function' ? l : (layouts[l ?? 'circle'] ?? circle);
