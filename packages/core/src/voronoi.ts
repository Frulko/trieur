// Découpage de la scène en régions.
//
// Les zones ne sont pas que des étiquettes : chaque zone possède un morceau de surface.
// On calcule le diagramme de Voronoï des positions — ça donne exactement « le cercle
// divisé en secteurs » pour une disposition circulaire, des cases pour une grille, et
// n'importe quel pavage pour une disposition maison. Une seule formule pour les trois.
//
// Méthode : découpes de demi-plans. On part du rectangle de la scène et, pour chaque
// autre germe, on coupe par la médiatrice. O(n²) sur des polygones de quelques sommets —
// à douze zones c'est instantané, et ça évite d'embarquer une lib de géométrie.

import type { Point, Polygon } from './types.js';

/** Garde la partie de `poly` la plus proche de `a` que de `b`. */
function clipHalfPlane(poly: Polygon, a: Point, b: Point): Polygon {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const nx = b.x - a.x;
  const ny = b.y - a.y;
  const side = (p: [number, number]) => (p[0] - mx) * nx + (p[1] - my) * ny; // < 0 = du côté de `a`
  const out: Polygon = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    const dp = side(p);
    const dq = side(q);
    if (dp <= 0) out.push(p);
    if (dp * dq < 0) {
      const t = dp / (dp - dq);
      out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
    }
  }
  return out;
}

/** Cellules de Voronoï des points `pts` dans un rectangle w×h, dans le même ordre. */
export function voronoi(pts: Point[], w: number, h: number): Polygon[] {
  return pts.map((p, i) => {
    let poly: Polygon = [
      [0, 0],
      [w, 0],
      [w, h],
      [0, h],
    ];
    for (let j = 0; j < pts.length && poly.length; j++) if (j !== i) poly = clipHalfPlane(poly, p, pts[j]!);
    return poly;
  });
}

/** Test d'appartenance par lancer de rayon. */
export function inPolygon(poly: Polygon, x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** Chemin SVG d'un polygone. */
export const pathOf = (poly: Polygon): string =>
  poly.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('') + 'Z';
