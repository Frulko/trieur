import { expect, test } from 'bun:test';
import { inPolygon, voronoi } from './voronoi.js';
import { layouts, radialLayout, resolveLayout } from './layouts.js';

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
  const placed = resolveLayout('circle')(6, { w: 600, h: 480, cardW: 200, cardH: 220, clearX: 152, clearY: 162, tile: 104 });
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

const BOX = { w: 760, h: 560, cardW: 260, cardH: 300, clearX: 182, clearY: 202, tile: 104 };
const NAMES = ['auto', 'circle', 'radial', 'voronoi', 'grid', 'dock'] as const;
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
    // these draw their own regions, so they place their own labels
    if (name === 'radial' || name === 'grid' || name === 'dock' || name === 'auto') continue;
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

test('radial: past eight zones it grows a second ring', () => {
  const one = resolveLayout('radial')(6, BOX);
  const many = resolveLayout('radial')(14, BOX);
  const radii = (p: { points: Array<{ x: number; y: number }> }) =>
    new Set(p.points.map((q) => Math.round(Math.hypot(q.x, q.y) / 10)));
  expect(radii(one).size).toBe(1); // six zones live on one ring
  expect(radii(many).size).toBeGreaterThan(1); // fourteen do not
  expect(many.cells!.length).toBe(14);
  // and no wedge is a sliver: that is the point of spilling into a second ring
  const areas = many.cells!.map(area);
  expect(Math.min(...areas)).toBeGreaterThan(1200);
});

test('radial: the hole hugs the card, whatever the tiles do', () => {
  const small = resolveLayout('radial')(6, { ...BOX, cardW: 160, cardH: 180 });
  const big = resolveLayout('radial')(6, { ...BOX, cardW: 300, cardH: 340 });
  const inner = (p: { cells?: Array<Array<[number, number]>> }) =>
    Math.min(...p.cells![0]!.map(([x, y]) => Math.hypot(x, y)));
  // the hole is the circle that just contains the card, so a bigger card means a bigger hole
  expect(inner(small)).toBeCloseTo(Math.hypot(80, 90) + 12, 0);
  expect(inner(big)).toBeCloseTo(Math.hypot(150, 170) + 12, 0);
});

test('grid: the regions are rectangles that tile the stage', () => {
  const { cells } = resolveLayout('grid')(5, BOX);
  expect(cells!.length).toBe(5);
  for (const cell of cells!) expect(cell.length).toBe(4); // rectangles, not scatter
  const total = cells!.reduce((s2, c) => s2 + area(c), 0);
  expect(total).toBeCloseTo(BOX.w * BOX.h, 3); // no gap, no overlap, no leftover cell
});

test('dock: full-height columns, tiles on the bottom edge', () => {
  const { points, cells } = resolveLayout('dock')(4, BOX);
  expect(cells!.length).toBe(4);
  expect(cells!.reduce((s2, c) => s2 + area(c), 0)).toBeCloseTo(BOX.w * BOX.h, 3);
  for (const p of points) expect(p.y).toBeGreaterThan(BOX.h / 2 - BOX.tile - 10);
});

test('dock: more tiles than fit across wrap into a tray', () => {
  const phone = { ...BOX, w: 380, h: 640, tile: 80 };
  const { points, cells } = resolveLayout('dock')(6, phone);
  // two rows of three rather than six tiles spilling off both edges
  expect(new Set(points.map((p) => Math.round(p.y))).size).toBe(2);
  for (const p of points) expect(Math.abs(p.x)).toBeLessThanOrEqual(phone.w / 2 - phone.tile / 2 + 1);
  // and the tray still carves the whole stage: nowhere to drop a card into nothing
  expect(cells!.reduce((s2, c) => s2 + area(c), 0)).toBeCloseTo(phone.w * phone.h, 3);
});

test('radial: an arc moves the hole, and no label lands on the card', () => {
  // a half menu is where this shows: the wedges no longer surround the card, so the arc takes
  // the whole stage and the card moves to the hole the layout asked for
  const half = radialLayout({ sweep: Math.PI, start: -Math.PI / 2 })(6, BOX);
  expect(half.centre!.x).toBeLessThan(-40); // opening right, so the hole sits left of centre
  for (const p of half.points) {
    const d = { x: p.x - half.centre!.x, y: p.y - half.centre!.y };
    expect(Math.hypot(d.x, d.y)).toBeGreaterThanOrEqual(clearAt(d) - 1);
  }
  // a full circle is unchanged: the hole is the middle of the stage
  const full = radialLayout()(6, BOX).centre!;
  expect(Math.abs(full.x) + Math.abs(full.y)).toBe(0);
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
