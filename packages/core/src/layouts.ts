// Built-in layouts. A layout places N zones around the centre, in pixels.
//
// A layout may also hand back the **regions** themselves. Positions alone give tiles floating
// over a Voronoi carving; a radial menu wants annulus sectors and a grid wants rectangles,
// neither of which a set of points can describe.

import type { Layout, LayoutBox, Placement, Point, Polygon } from './types.js';
import { voronoi } from './voronoi.js';

const TAU = Math.PI * 2;

/** Radius of an ellipse (rx, ry) at angle `a`. */
const onEllipse = (rx: number, ry: number, a: number): number => {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return (rx * ry) / Math.sqrt((ry * c) ** 2 + (rx * s) ** 2 || 1);
};

/** Splits `n` across buckets in proportion to `weights`, whole numbers, at least one each. */
function share(n: number, weights: number[]): number[] {
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const raw = weights.map((c) => (n * c) / total);
  const out = raw.map((v) => Math.max(1, Math.floor(v)));
  let left = n - out.reduce((a, b) => a + b, 0);
  const order = raw.map((v, i) => [v - Math.floor(v), i] as const).sort((a, b) => b[0] - a[0]);
  for (let i = 0; left > 0 && order.length; i = (i + 1) % order.length) {
    out[order[i]![1]]!++;
    left--;
  }
  // more buckets than zones: hand the surplus back by dropping the emptiest
  while (out.reduce((a, b) => a + b, 0) > n) {
    const i = out.lastIndexOf(Math.min(...out));
    out.splice(i, 1);
  }
  return out;
}

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
 * A radial menu: the stage becomes a pie, one wedge per zone, with the card in the hole.
 *
 * The hole is the circle that just contains the card, so it hugs whatever card you give it
 * rather than drifting with the tile size. Equal wedges are the point — every choice is one
 * flick, and every flick is the same length — which is why it is a circle and not an ellipse.
 *
 * **Past eight zones it grows a second ring**, then a third. Wedges much narrower than that
 * stop being aimable (a pie menu is a Fitts's-law device: the target you cannot miss is one
 * with a wide angle), and every extra ring is longer, so it holds proportionally more. The
 * capacity of ring k is the capacity of ring 0 scaled by its radius — the geometry decides,
 * not a magic number.
 */
const RING_MAX = 8;

const radial: Layout = (n, { w, h, cardW, cardH }): Placement => {
  const rIn = Math.hypot(cardW / 2, cardH / 2) + 12;
  const rOut = Math.max(rIn + 76, Math.min(w, h) / 2 - 6);

  let counts = [n];
  for (let rings = 1; rings <= 4 && rings <= n; rings++) {
    const t = (rOut - rIn) / rings;
    const caps = Array.from({ length: rings }, (_, k) =>
      Math.max(3, Math.round((RING_MAX * (rIn + (k + 0.5) * t)) / (rIn + 0.5 * t))),
    );
    if (caps.reduce((a, b) => a + b, 0) >= n) {
      counts = share(n, caps);
      break;
    }
  }

  const thickness = (rOut - rIn) / counts.length;
  const SAMPLES = 14;
  const points: Point[] = [];
  const cells: Polygon[] = [];

  counts.forEach((count, ring) => {
    const r0 = rIn + ring * thickness;
    const r1 = r0 + thickness - (ring < counts.length - 1 ? 3 : 0); // a hairline between rings
    const step = TAU / count;
    const gap = Math.min(step * 0.04, 0.03); // a hairline between wedges, not a slice of pie
    for (let i = 0; i < count; i++) {
      const mid = -Math.PI / 2 + (i + 0.5) * step;
      const a0 = mid - step / 2 + gap;
      const a1 = mid + step / 2 - gap;
      const poly: Polygon = [];
      for (let s = 0; s <= SAMPLES; s++) {
        const a = a0 + ((a1 - a0) * s) / SAMPLES;
        poly.push([Math.cos(a) * r1, Math.sin(a) * r1]);
      }
      for (let s = SAMPLES; s >= 0; s--) {
        const a = a0 + ((a1 - a0) * s) / SAMPLES;
        poly.push([Math.cos(a) * r0, Math.sin(a) * r0]);
      }
      cells.push(poly);
      const r = (r0 + r1) / 2;
      points.push({ x: Math.cos(mid) * r, y: Math.sin(mid) * r });
    }
  });
  return { points, cells };
};

/**
 * Phyllotactic spiral, then relaxed: the seeds step by the golden angle so they are never
 * collinear, and Lloyd's algorithm then evens out the cells they produce.
 *
 * Without the relaxation the mosaic is pretty and unusable — the spiral crowds the middle,
 * so the first zones get postage stamps and the last ones get half the stage. Lloyd is the
 * standard fix (a centroidal Voronoi tessellation): compute the cells, move each seed to its
 * cell's centroid, repeat. Four passes is enough to make the areas comparable, and it stays
 * deterministic.
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

/**
 * A grid that looks like a grid: `n` rectangles tiling the whole stage, no gaps, no leftover
 * cell. Rows are chosen from the stage's aspect ratio and the zones shared out between them,
 * so five zones give a row of three over a row of two rather than a 3×2 grid with a hole.
 *
 * The card floats over the middle, so a tile whose cell centre falls behind it slides outward
 * **within its own cell** — moving it to a ring, as the other layouts do, is exactly what made
 * the grid stop looking like a grid.
 */
const grid: Layout = (n, box): Placement => {
  const { w, h, tile } = box;
  const rows = Math.max(1, Math.min(n, Math.round(Math.sqrt((n * h) / w)) || 1));
  const perRow = share(n, Array.from({ length: rows }, () => 1));
  const rowH = h / perRow.length;
  const points: Point[] = [];
  const cells: Polygon[] = [];

  perRow.forEach((cols, r) => {
    const cellW = w / cols;
    const y0 = -h / 2 + r * rowH;
    const y1 = y0 + rowH;
    for (let c = 0; c < cols; c++) {
      const x0 = -w / 2 + c * cellW;
      const x1 = x0 + cellW;
      cells.push([
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
      ]);
      points.push(slideOut({ x: (x0 + x1) / 2, y: (y0 + y1) / 2 }, { x0, x1, y0, y1 }, box));
    }
  });
  return { points, cells };
};

/** Moves a point out of the card, but no further than its own cell allows. */
function slideOut(p: Point, cell: { x0: number; x1: number; y0: number; y1: number }, box: LayoutBox): Point {
  if (Math.abs(p.x) >= box.clearX || Math.abs(p.y) >= box.clearY) return p;
  const a = Math.hypot(p.x, p.y) < 1 ? -Math.PI / 2 : Math.atan2(p.y, p.x);
  const r = clearanceAt(a, box) + 4;
  const m = box.tile / 2;
  const clamp = (v: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : Math.min(Math.max(v, lo), hi));
  return {
    x: clamp(Math.cos(a) * r, cell.x0 + m, cell.x1 - m),
    y: clamp(Math.sin(a) * r, cell.y0 + m, cell.y1 - m),
  };
}

/**
 * A dock: the zones line the bottom edge, and each one owns a full-height column.
 *
 * This is the phone layout. A ring of tiles around a card spends most of a tall screen on
 * empty corners; a dock spends all of it on the card, and turns the gesture into a horizontal
 * flick, which is the one a thumb makes best. It suits a handful of zones — past what fits
 * along the bottom, the tiles start to touch.
 */
const dock: Layout = (n, { w, h, tile }): Placement => {
  const colW = w / n;
  const y = h / 2 - tile / 2 - 6;
  const points: Point[] = [];
  const cells: Polygon[] = [];
  for (let i = 0; i < n; i++) {
    const x0 = -w / 2 + i * colW;
    const x1 = x0 + colW;
    cells.push([
      [x0, -h / 2],
      [x1, -h / 2],
      [x1, h / 2],
      [x0, h / 2],
    ]);
    points.push({ x: (x0 + x1) / 2, y });
  }
  return { points, cells };
};

/** Whatever fits: a dock on a narrow stage that can hold one, a circle everywhere else. */
const auto: Layout = (n, box) => {
  const fitsDock = n <= Math.max(1, Math.floor(box.w / (box.tile + 6)));
  const narrow = box.w < 620 || box.h / box.w > 1.15;
  return (narrow && fitsDock ? dock : circle)(n, box);
};

export const layouts: Record<string, Layout> = { auto, circle, radial, voronoi: mosaic, grid, dock };

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

/** Pushes any seed that landed inside the card out to the edge of it. */
export function clearCentre(pts: Point[], box: LayoutBox): Point[] {
  return pts.map((p, i) => {
    // exactly at the centre there is no direction to push along, so borrow one from the index
    const a = Math.hypot(p.x, p.y) < 1 ? (i / Math.max(pts.length, 1)) * TAU - Math.PI / 2 : Math.atan2(p.y, p.x);
    const r = clearanceAt(a, box);
    if (Math.hypot(p.x, p.y) >= r - 0.5) return p;
    return { x: Math.cos(a) * r, y: Math.sin(a) * r };
  });
}

/**
 * Scales the whole set down until it fits the stage, tile included.
 *
 * Uniform, so the arrangement is preserved: clamping each point separately would fold a
 * circle into a rectangle. A zone half off the stage is unreachable by thumb, which is the
 * same failure as a zone under the card, from the other side.
 */
/**
 * Pulls each point back inside the stage, one axis at a time.
 *
 * For a layout that draws its own regions, scaling the whole set would slide the labels out
 * of the very wedges they belong to; clamping moves a label along the axis that overflows and
 * leaves it on its own ray. The outer ring of a radial menu needs this — its mid-radius is
 * where the label goes, and that can sit past the bottom edge.
 */
export function clampToStage(pts: Point[], box: LayoutBox): Point[] {
  const maxX = Math.max(box.w / 2 - box.tile / 2, 20);
  const maxY = Math.max(box.h / 2 - box.tile / 2, 20);
  return pts.map((p) => ({
    x: Math.min(Math.max(p.x, -maxX), maxX),
    y: Math.min(Math.max(p.y, -maxY), maxY),
  }));
}

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
 * `'auto'` (default), `'circle'`, `'radial'`, `'voronoi'`, `'grid'`, `'dock'` or your own.
 *
 * Whatever comes back goes through the same two guarantees — nothing under the card, nothing
 * off the stage — so a custom layout gets them for free. A layout that draws its own regions
 * is trusted with its own labels: pushing them out would move them out of the very wedges
 * they belong to.
 */
export function resolveLayout(l: Layout | string | undefined): (n: number, box: LayoutBox) => Placement {
  const place = typeof l === 'function' ? l : (layouts[l ?? 'auto'] ?? auto);
  return (n, box) => {
    const out = place(n, box);
    const raw = Array.isArray(out) ? { points: out } : out;
    if (raw.cells) return { points: clampToStage(raw.points, box), cells: raw.cells };
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

export { onEllipse };
