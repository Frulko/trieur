import { expect, test } from 'bun:test';
import { fitVelocity, resolveThrow, throwDefaults, type ThrowZone } from './throw.js';

const STAGE = { w: 760, h: 560 };
const RING: ThrowZone[] = [
  { index: 0, pos: { x: 0, y: -220 } }, // up
  { index: 1, pos: { x: 260, y: 0 } }, // right
  { index: 2, pos: { x: 0, y: 220 } }, // down
  { index: 3, pos: { x: -260, y: 0 } }, // left
];
const centre = { x: 0, y: 0 };
const opts = throwDefaults();

/** A gesture: samples every 16ms along `f`. */
const path = (f: (t: number) => { x: number; y: number }, n = 7) =>
  Array.from({ length: n }, (_, i) => ({ t: i * 16, ...f(i * 16) }));

test('velocity: constant, accelerating, stopped', () => {
  expect(fitVelocity(path((t) => ({ x: 2 * t, y: 0 })), 'x')).toBeCloseTo(2, 3);
  // x = ½·0.02·t² → v(96) = 0.02 · 96 = 1.92
  expect(fitVelocity(path((t) => ({ x: 0.01 * t * t, y: 0 })), 'x')).toBeCloseTo(1.92, 2);
  expect(fitVelocity(path(() => ({ x: 40, y: 0 })), 'x')).toBeCloseTo(0, 6);
  // a finger that slowed to a halt has thrown nothing, however fast it arrived
  expect(fitVelocity(path((t) => ({ x: 3 * t - 0.015 * t * t, y: 0 })), 'x')).toBeLessThan(0.4);
});

test('a slow release is a drop, not a throw', () => {
  const r = resolveThrow({ at: centre, from: centre, v: { x: 0.2, y: 0 }, zones: RING, stage: STAGE, opts });
  expect(r.thrown).toBe(false);
  expect(r.index).toBe(null);
  expect(r.why).toBe('slow');
});

test('a throw that lands on the stage takes the region under it', () => {
  const seen: Array<{ x: number; y: number }> = [];
  const r = resolveThrow({
    at: { x: 60, y: 0 },
    from: centre,
    v: { x: 0.9, y: 0 },
    zones: RING,
    stage: STAGE,
    opts,
    regionAt: (p) => {
      seen.push(p);
      return 1; // whatever region the landing point is in
    },
  });
  expect(r.thrown).toBe(true);
  expect(r.why).toBe('region');
  expect(r.index).toBe(1);
  // 0.9 px/ms × 170ms = 153px past the release point
  expect(seen[0]!.x).toBeCloseTo(60 + 153, 0);
});

test('a throw past the edge takes the tile nearest the line, not the point', () => {
  // hard to the right and slightly down: the landing point is way off the stage, and the tile
  // nearest *that point* would be the bottom one — the ray still points at the right one
  const r = resolveThrow({
    at: { x: 40, y: 30 },
    from: centre,
    v: { x: 3, y: 0.9 },
    zones: RING,
    stage: STAGE,
    opts,
    regionAt: () => null,
  });
  expect(r.why).toBe('ray');
  expect(r.index).toBe(1);
  expect(r.carried).toBeGreaterThan(400);
});

test('a zone the throw is heading away from is never chosen', () => {
  const r = resolveThrow({
    at: centre,
    from: centre,
    v: { x: 0, y: -2 }, // straight up
    zones: [RING[2]!], // only the zone below exists
    stage: STAGE,
    opts,
    regionAt: () => 2, // …and it owns the whole stage
  });
  expect(r.thrown).toBe(true);
  expect(r.index).toBe(null);
  expect(r.why).toBe('nothing');
});

test('the model widens what it is sure of, and only that', () => {
  // aimed between two tiles, a shade closer to the right one
  const between = { x: 2.2, y: -1.6 };
  const plain = resolveThrow({ at: centre, from: centre, v: between, zones: RING, stage: STAGE, opts, regionAt: () => null });
  expect(plain.index).toBe(1);

  const guessed = RING.map((z) => (z.index === 0 ? { ...z, score: 0.95 } : z));
  const pulled = resolveThrow({
    at: centre,
    from: centre,
    v: between,
    zones: guessed,
    stage: STAGE,
    opts: { ...opts, bias: 0.8 },
    regionAt: () => null,
  });
  expect(pulled.index).toBe(0); // the suggestion caught it

  // …and with the bias off it does not
  const off = resolveThrow({
    at: centre,
    from: centre,
    v: between,
    zones: guessed,
    stage: STAGE,
    opts: { ...opts, bias: 0 },
    regionAt: () => null,
  });
  expect(off.index).toBe(1);
});

test('the projection is capped, and reports what it carried', () => {
  const fast = resolveThrow({ at: centre, from: centre, v: { x: 40, y: 0 }, zones: RING, stage: STAGE, opts, regionAt: () => null });
  expect(fast.carried).toBeCloseTo(Math.hypot(STAGE.w, STAGE.h), 0);
  expect(fast.index).toBe(1);
});
