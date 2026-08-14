import { expect, test } from 'bun:test';
import { inPolygon, voronoi } from './voronoi.js';
import { layouts } from './layouts.js';

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

test('voronoi : chaque germe est dans sa propre cellule', () => {
  const pts = layouts.circle!(6, { w: 600, h: 480, clear: 150 }).map((p) => ({ x: 300 + p.x, y: 240 + p.y }));
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

test('layouts : les zones restent dans la scène', () => {
  const box = { w: 700, h: 520, clear: 180 };
  for (const name of ['circle', 'grid', 'voronoi'] as const) {
    for (const p of layouts[name]!(9, box)) {
      expect(Math.abs(p.x)).toBeLessThanOrEqual(box.w / 2);
      expect(Math.abs(p.y)).toBeLessThanOrEqual(box.h / 2);
    }
  }
});
