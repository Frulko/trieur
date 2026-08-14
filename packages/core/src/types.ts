// Types publics du deck. Rien du domaine : un item est un objet opaque, une zone une
// étiquette opaque. Tout ce qui sait de quoi on parle vit chez l'appelant.

export type Point = { x: number; y: number };
export type Polygon = Array<[number, number]>;

/** Une zone : un emplacement fixe de la scène, avec sa touche. */
export interface Zone {
  id: string;
  label?: string;
  /** touche clavier ; à défaut, attribuée par position */
  key?: string;
  color?: string;
  icon?: string;
  image?: string;
}

/** Une zone une fois placée sur la scène par le deck. */
export interface PlacedZone extends Zone {
  index: number;
  /** zone libre : rien n'y est encore attribué, le dépôt appelle `onAssign` */
  empty: boolean;
  key: string;
  angle: number;
  pos: Point;
  /** région de la scène possédée par la zone (Voronoï) ; null si `segments: false` */
  cell: Polygon | null;
}

export interface LayoutBox {
  w: number;
  h: number;
  /** rayon à dégager au centre pour que les zones ne passent pas sous la carte */
  clear: number;
}

/** Une disposition place N zones autour du centre, en pixels. */
export type Layout = (n: number, box: LayoutBox) => Point[];

/** Une zone proposée par un modèle, avec les traits qui ont pesé. */
export interface Prediction {
  id: string;
  score: number;
  why: string[];
}

/** Un rangement, tel qu'il est transmis au modèle. */
export interface SortRecord<T = unknown> {
  item: T;
  meta: unknown;
  zoneId: string;
  /** ce que le modèle avait proposé — sert à mesurer sa justesse */
  predicted?: string | null;
  at: number;
}

/**
 * Ce que le deck attend d'un modèle. `@trieur/learn` en fournit un, mais n'importe quoi
 * qui répond à `best()` fait l'affaire — y compris un appel réseau : le deck accepte une
 * promesse et ignore la réponse si la carte a changé entre-temps.
 */
export interface Advisor<T = unknown> {
  best(meta: unknown, zoneIds: string[], minScore?: number): Prediction | null | Promise<Prediction | null>;
  record?(r: SortRecord<T>): unknown;
  forget?(r: SortRecord<T>): unknown;
}

/** Libellés de l'interface. `fr` par défaut, `en` fourni, ou les tiens. */
export interface DeckText {
  empty: string;
  skip: string;
  undo: string;
  expand: string;
  close: string;
  free: string;
  count: (n: number) => string;
}

export interface DeckOptions<T = any> {
  /** pile à trier ; le premier élément est la carte du dessus */
  items?: T[];
  /** zones ; `null` = zone libre */
  zones?: Array<Zone | null>;
  /** dessine la carte (obligatoire en pratique) */
  renderCard?: (item: T, el: HTMLElement) => void;
  /** dessine une zone ; par défaut une tuile façon dossier */
  renderZone?: (zone: PlacedZone, el: HTMLElement) => void;
  /** métadonnées passées au modèle ; par défaut l'item lui-même */
  meta?: (item: T) => unknown;
  advisor?: Advisor<T>;
  /** score minimum pour qu'une zone soit proposée */
  minConfidence?: number;
  layout?: Layout | 'circle' | 'voronoi' | 'grid';
  /** découpe la scène en régions et vise à la région plutôt qu'à l'angle */
  segments?: boolean;
  /** touches attribuées aux zones, dans l'ordre */
  keys?: string;
  /** distance de glisser au-delà de laquelle le dépôt est armé, en px */
  threshold?: number;
  text?: Partial<DeckText>;
  onSort?: (item: T, zone: PlacedZone) => unknown;
  onUndo?: (item: T, zone: PlacedZone) => unknown;
  onSkip?: (item: T) => unknown;
  onAssign?: (index: number, item: T) => unknown;
  onEmpty?: () => unknown;
}

/** `detail` des événements `trieur:*`. */
export interface DeckEventMap<T = unknown> {
  sort: { item: T; zone: PlacedZone; predicted: string | null; correct: boolean };
  undo: { item: T; zone: PlacedZone };
  skip: { item: T };
  assign: { index: number; item: T };
  suggest: { item: T } & Prediction;
  expand: { expanded: boolean };
  empty: Record<string, never>;
  error: { item?: T; zone?: PlacedZone; error: unknown };
}
