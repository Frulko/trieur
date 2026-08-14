// Built-in layouts. A layout places N zones around the centre, in pixels.
//
// Margins are worth half a tile: a zone spilling off the stage is unreachable by thumb.

import type { Layout, Point } from './types.js';

const TAU = Math.PI * 2;

/** An ellipse hugging the stage: a strict circle wastes space on wide screens. */
const circle: Layout = (n, { w, h, clear }) => {
  const rx = Math.max(60, Math.min(w / 2 - 60, Math.max(clear, w / 2 - 110)));
  const ry = Math.max(60, Math.min(h / 2 - 62, Math.max(clear, h / 2 - 90)));
  return Array.from({ length: n }, (_, i) => {
    const a = -Math.PI / 2 + (i / n) * TAU; // start at the top, go clockwise
    return { x: Math.cos(a) * rx, y: Math.sin(a) * ry };
  });
};

/**
 * Phyllotactic spiral: seeds step by the golden angle, so they are never collinear. The
 * Voronoi cells that follow are irregular — a mosaic rather than a pie chart. Deterministic:
 * same number of zones, same drawing.
 */
const spiral: Layout = (n, { w, h, clear }) => {
  const maxX = Math.max(60, w / 2 - 70);
  const maxY = Math.max(60, h / 2 - 80);
  return Array.from({ length: n }, (_, i) => {
    const a = i * 2.399963229728653; // golden angle, in radians
    const t = Math.sqrt((i + 0.5) / n); // square root: constant density, no crowding at the rim
    return {
      x: Math.cos(a) * (clear * 0.6 + t * (maxX - clear * 0.6)),
      y: Math.sin(a) * (clear * 0.6 + t * (maxY - clear * 0.6)),
    };
  });
};

/** Grid: useful when zones are many. */
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

/** Angle of a vector, wrapped into [0, 2π[. */
export const angleOf = (x: number, y: number): number => (Math.atan2(y, x) + TAU) % TAU;

/** Absolute angular gap between two angles, in [0, π]. */
export const angleGap = (a: number, b: number): number => {
  const d = Math.abs(a - b) % TAU;
  return d > Math.PI ? TAU - d : d;
};

/** `'circle'`, `'grid'`, `'voronoi'` or your own function. */
export const resolveLayout = (l: Layout | string | undefined): Layout =>
  typeof l === 'function' ? l : (layouts[l ?? 'circle'] ?? circle);
