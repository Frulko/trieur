// Built-in layouts. A layout places N zones around the centre, in pixels.
//
// A layout may also hand back the **regions** themselves. Positions alone give tiles floating
// over a Voronoi carving; a radial menu wants annulus sectors, which no set of points can
// describe. So the contract is: return points, or return points and cells.

import type { Layout, LayoutBox, Placement, Point, Polygon } from './types.js';
import { voronoi } from './voronoi.js';

const TAU = Math.PI * 2;

/** Radius of an ellipse (rx, ry) at angle `a`. */
const onEllipse = (rx: number, ry: number, a: number): number => {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return (rx * ry) / Math.sqrt((ry * c) ** 2 + (rx * s) ** 2 || 1);
};

/** An ellipse hugging the stage: a strict circle wastes space on wide screens. */
const circle: Layout = (n, { w, h, clearX, clearY }) => {
  const rx = Math.max(clearX, w / 2 - 60);
  const ry = Math.max(clearY, h / 2 - 60);
  return Array.from({ length: n }, (_, i) => {
    const a = -Math.PI / 2 + (i / n) * TAU; // start at the top, go clockwise
    return { x: Math.cos(a) * rx, y: Math.sin(a) * ry };
  });
};

/**
 * A radial menu: the stage becomes a pie, one sector per zone, with the card in the hole.
 *
 * The sectors are elliptical rather than circular so they fill a wide stage instead of
 * leaving four empty corners, and the hole is the card's own ellipse. Each sector is handed
 * back as a polygon, so the drop targets *are* the wedges you see — the same rule as
 * everywhere else, just with a different carving.
 */
const radial: Layout = (n, { w, h, clearX, clearY }): Placement => {
  // A true circle, not an ellipse: a pie menu with wedges of different sizes reads as broken,
  // and equal wedges are the whole point of a radial menu — every choice is one flick, and
  // every flick is the same length. The price is the four corners of a wide stage.
  const inX = Math.max(clearX, clearY);
  const inY = inX;
  const outX = Math.max(inX + 40, Math.min(w, h) / 2 - 6);
  const outY = outX;
  const step = TAU / n;
  const gap = Math.min(step * 0.04, 0.03); // a hairline between wedges, not a slice of pie
  const SAMPLES = 14;

  const points: Point[] = [];
  const cells: Polygon[] = [];
  for (let i = 0; i < n; i++) {
    const mid = -Math.PI / 2 + (i + 0.5) * step;
    const a0 = mid - step / 2 + gap;
    const a1 = mid + step / 2 - gap;
    const poly: Polygon = [];
    for (let s = 0; s <= SAMPLES; s++) {
      const a = a0 + ((a1 - a0) * s) / SAMPLES;
      poly.push([Math.cos(a) * onEllipse(outX, outY, a), Math.sin(a) * onEllipse(outX, outY, a)]);
    }
    for (let s = SAMPLES; s >= 0; s--) {
      const a = a0 + ((a1 - a0) * s) / SAMPLES;
      poly.push([Math.cos(a) * onEllipse(inX, inY, a), Math.sin(a) * onEllipse(inX, inY, a)]);
    }
    cells.push(poly);
    // the label sits in the middle of the wedge, a touch outward so it clears the hole
    const r = (onEllipse(inX, inY, mid) + onEllipse(outX, outY, mid)) / 2;
    points.push({ x: Math.cos(mid) * r, y: Math.sin(mid) * r });
  }
  return { points, cells };
};

/**
 * Phyllotactic spiral, then relaxed: the seeds step by the golden angle so they are never
 * collinear, and Lloyd's algorithm then evens out the cells they produce.
 *
 * Without the relaxation the mosaic is pretty and unusable — the spiral crowds the middle,
 * so the first zones get postage stamps and the last ones get half the stage. Lloyd is the
 * standard fix (a centroidal Voronoi tessellation): compute the cells, move each seed to its
 * cell's centroid, repeat. Four passes is enough to make the areas comparable and the shapes
 * regular, and it stays deterministic.
 */
const mosaic: Layout = (n, box) => {
  const { w, h, clearX, clearY } = box;
  const maxX = Math.max(clearX, w / 2 - 70);
  const maxY = Math.max(clearY, h / 2 - 70);
  const seeds = Array.from({ length: n }, (_, i) => {
    const a = i * 2.399963229728653; // golden angle, in radians
    const t = Math.sqrt((i + 0.5) / n); // square root: constant density, no crowding at the rim
    return {
      x: Math.cos(a) * (clearX + t * (maxX - clearX)),
      y: Math.sin(a) * (clearY + t * (maxY - clearY)),
    };
  });
  return relax(seeds, box);
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

export const layouts: Record<string, Layout> = { circle, radial, voronoi: mosaic, grid };

// --- shared post-steps ---------------------------------------------------------

/** Area and centroid of a polygon, by the shoelace formula. */
function centroid(poly: Polygon): Point | null {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xj, yj] = poly[j]!;
    const [xi, yi] = poly[i]!;
    const f = xj * yi - xi * yj;
    a += f;
    cx += (xj + xi) * f;
    cy += (yj + yi) * f;
  }
  if (Math.abs(a) < 1e-6) return null;
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

/**
 * Lloyd's algorithm: move every seed to the centroid of its own cell, a few times over.
 *
 * The clearance is reapplied after each pass, otherwise the seeds drift into the middle —
 * the centre of the stage is the largest empty area, and it is exactly where the card is.
 */
export function relax(pts: Point[], box: LayoutBox, iterations = 4): Point[] {
  const { w, h } = box;
  let seeds = clearCentre(pts, box);
  for (let k = 0; k < iterations; k++) {
    const abs = seeds.map((p) => ({ x: w / 2 + p.x, y: h / 2 + p.y }));
    seeds = clearCentre(
      voronoi(abs, w, h).map((cell, i) => {
        const c = centroid(cell);
        return c ? { x: c.x - w / 2, y: c.y - h / 2 } : seeds[i]!;
      }),
      box,
    );
  }
  return seeds;
}

/**
 * Pushes any seed that landed inside the card out to the edge of it.
 *
 * The clearance is an **ellipse**, not a circle: a zone directly above the card only has to
 * clear its height, and using the circumscribed radius everywhere pushed the top zone off the
 * stage on a short stage. A tile under the card cannot be seen, cannot be tapped, and owns a
 * region nobody can reach — a grid with an odd number of cells puts one there every time.
 */
export function clearCentre(pts: Point[], box: LayoutBox): Point[] {
  return pts.map((p, i) => {
    // exactly at the centre there is no direction to push along, so borrow one from the index
    const a =
      Math.hypot(p.x, p.y) < 1 ? (i / Math.max(pts.length, 1)) * TAU - Math.PI / 2 : Math.atan2(p.y, p.x);
    const r = clearanceAt(a, box);
    if (Math.hypot(p.x, p.y) >= r - 0.5) return p;
    return { x: Math.cos(a) * r, y: Math.sin(a) * r };
  });
}

/**
 * How far out a zone has to sit, in the direction `a`, to be clear of the card.
 *
 * A **rectangle**, not an ellipse: cards are rectangles and so are tiles, and an ellipse cuts
 * the corners — a tile at 45° sat outside the ellipse and still overlapped the card. This is
 * the ray hitting the card's box inflated by half a tile, which is the exact condition.
 */
export function clearanceAt(a: number, { clearX, clearY }: LayoutBox): number {
  const c = Math.abs(Math.cos(a));
  const s = Math.abs(Math.sin(a));
  return Math.min(c < 1e-6 ? Infinity : clearX / c, s < 1e-6 ? Infinity : clearY / s);
}

/**
 * Scales the whole set down until it fits the stage, tile included.
 *
 * Uniform, so the arrangement is preserved: clamping each point separately would fold a
 * circle into a rectangle. A zone half off the stage is unreachable by thumb, which is the
 * same failure as a zone under the card, from the other side.
 */
export function fitToStage(pts: Point[], box: LayoutBox): Point[] {
  const maxX = Math.max(box.w / 2 - box.tile / 2, 20);
  const maxY = Math.max(box.h / 2 - box.tile / 2, 20);
  let k = 1;
  for (const p of pts) {
    if (Math.abs(p.x) > maxX) k = Math.min(k, maxX / Math.abs(p.x));
    if (Math.abs(p.y) > maxY) k = Math.min(k, maxY / Math.abs(p.y));
  }
  return k === 1 ? pts : pts.map((p) => ({ x: p.x * k, y: p.y * k }));
}

/**
 * `'circle'`, `'radial'`, `'voronoi'`, `'grid'` or your own function.
 *
 * Whatever comes back goes through the same two guarantees — nothing under the card, nothing
 * off the stage — so a custom layout gets them for free.
 */
export function resolveLayout(l: Layout | string | undefined): (n: number, box: LayoutBox) => Placement {
  const place = typeof l === 'function' ? l : (layouts[l ?? 'circle'] ?? circle);
  return (n, box) => {
    const out = place(n, box);
    const raw = Array.isArray(out) ? { points: out } : out;
    // a layout that draws its own regions places its own labels: pushing them out would move
    // them out of the very wedges they belong to
    if (raw.cells) return { points: fitToStage(raw.points, box), cells: raw.cells };
    // Fit first, clear second, because when the two cannot both hold — a tall card on a short
    // stage — the clearance is the one that must win. A tile poking past the edge is untidy;
    // a tile under the card is invisible and unreachable.
    return { points: clearCentre(fitToStage(raw.points, box), box) };
  };
}

/** Angle of a vector, wrapped into [0, 2π[. */
export const angleOf = (x: number, y: number): number => (Math.atan2(y, x) + TAU) % TAU;

/** Absolute angular gap between two angles, in [0, π]. */
export const angleGap = (a: number, b: number): number => {
  const d = Math.abs(a - b) % TAU;
  return d > Math.PI ? TAU - d : d;
};
