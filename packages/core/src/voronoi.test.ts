import { expect, test } from 'bun:test';
import { inPolygon, voronoi } from './voronoi.js';
import { layouts, resolveLayout } from './layouts.js';

const area = (poly: Array<[number, number]>) => {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    a += (poly[j]![0] + poly[i]![0]) * (poly[j]![1] - poly[i]![1]);
  }
  return Math.abs(a / 2);
};

test('voronoi : les cellules pavent exactement le rectangle', () => {
  const pts = [
    { x: 20, y: 20 },
    { x: 180, y: 40 },
    { x: 90, y: 160 },
    { x: 30, y: 120 },
  ];
  const cells = voronoi(pts, 200, 200);
  expect(cells.length).toBe(4);
  const total = cells.reduce((s, c) => s + area(c), 0);
  expect(total).toBeCloseTo(200 * 200, 3); // ni trou ni recouvrement
});

test('voronoi: every seed sits in its own cell', () => {
  const placed = resolveLayout('circle')(6, { w: 600, h: 480, clearX: 150, clearY: 160, tile: 104 });
  const pts = placed.points.map((p) => ({ x: 300 + p.x, y: 240 + p.y }));
  const cells = voronoi(pts, 600, 480);
  pts.forEach((p, i) => {
    expect(inPolygon(cells[i]!, p.x, p.y)).toBe(true);
    // et dans aucune autre : c'est ce qui rend le dépôt sans ambiguïté
    for (let j = 0; j < cells.length; j++) if (j !== i) expect(inPolygon(cells[j]!, p.x, p.y)).toBe(false);
  });
});

test('voronoi : un seul germe possède toute la scène', () => {
  const [cell] = voronoi([{ x: 10, y: 10 }], 100, 50);
  expect(area(cell!)).toBeCloseTo(5000, 3);
});

const BOX = { w: 760, h: 560, clearX: 192, clearY: 208, tile: 104 };
const NAMES = ['circle', 'radial', 'voronoi', 'grid'] as const;
/** How far the clearance rectangle reaches in the direction of a point. */
const clearAt = (p: { x: number; y: number }, box = BOX) => {
  const a = Math.atan2(p.y, p.x);
  const c = Math.abs(Math.cos(a));
  const si = Math.abs(Math.sin(a));
  return Math.min(c < 1e-6 ? Infinity : box.clearX / c, si < 1e-6 ? Infinity : box.clearY / si);
};

test('layouts: every zone stays on the stage, tile included', () => {
  for (const name of NAMES) {
    for (const n of [2, 5, 9, 14]) {
      for (const p of resolveLayout(name)(n, BOX).points) {
        expect(Math.abs(p.x)).toBeLessThanOrEqual(BOX.w / 2 - BOX.tile / 2 + 1);
        expect(Math.abs(p.y)).toBeLessThanOrEqual(BOX.h / 2 - BOX.tile / 2 + 1);
      }
    }
  }
});

test('layouts: no zone lands under the card', () => {
  // through resolveLayout, which is what the deck uses — the clearance is enforced there,
  // so a custom layout gets the same guarantee as the built-in ones
  for (const name of NAMES) {
    if (name === 'radial') continue; // it draws its own wedges, so it places its own labels
    for (const n of [3, 6, 7, 9, 12]) {
      for (const p of resolveLayout(name)(n, BOX).points) {
        expect(Math.hypot(p.x, p.y)).toBeGreaterThanOrEqual(clearAt(p) - 1);
      }
    }
  }
  // including one that does not think about it at all
  for (const p of resolveLayout(() => [
    { x: 0, y: 0 },
    { x: 10, y: 5 },
  ])(2, BOX).points) {
    expect(Math.hypot(p.x, p.y)).toBeGreaterThanOrEqual(clearAt(p) - 1);
  }
});

test('radial: the wedges are the regions, and they tile the ring', () => {
  const { points, cells } = resolveLayout('radial')(6, BOX);
  expect(cells).toBeDefined();
  expect(cells!.length).toBe(6);
  // each label sits inside its own wedge and no other
  points.forEach((p, i) => {
    expect(inPolygon(cells![i]!, p.x, p.y)).toBe(true);
    for (let j = 0; j < cells!.length; j++) if (j !== i) expect(inPolygon(cells![j]!, p.x, p.y)).toBe(false);
  });
  // and the wedges are of comparable size — a radial menu with one giant slice is a bug
  const areas = cells!.map(area);
  expect(Math.max(...areas) / Math.min(...areas)).toBeLessThan(1.6);
});

test('voronoi: relaxing evens the cells out', () => {
  const spread = (name: 'voronoi', n: number) => {
    const { points } = resolveLayout(name)(n, BOX);
    const abs = points.map((p) => ({ x: BOX.w / 2 + p.x, y: BOX.h / 2 + p.y }));
    const areas = voronoi(abs, BOX.w, BOX.h).map(area);
    return Math.max(...areas) / Math.min(...areas);
  };
  // before Lloyd, the golden-angle spiral gave ratios past 4×; a usable mosaic stays close
  expect(spread('voronoi', 8)).toBeLessThan(2.6);
});
