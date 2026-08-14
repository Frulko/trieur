// Public types for the deck.
//
// Nothing from any domain: an item is an opaque object, a zone an opaque label. Everything
// that knows what is being sorted lives in the host application.

export type Point = { x: number; y: number };
export type Polygon = Array<[number, number]>;

/** A zone: a fixed spot on the stage, with its key. */
export interface Zone {
  id: string;
  label?: string;
  /** keyboard key; assigned by position when absent */
  key?: string;
  color?: string;
  icon?: string;
  image?: string;
}

/** A zone once the deck has placed it on the stage. */
export interface PlacedZone extends Zone {
  index: number;
  /** free zone: nothing is assigned to it yet, dropping calls `onAssign` */
  empty: boolean;
  key: string;
  angle: number;
  pos: Point;
  /** the slice of stage this zone owns (Voronoi); null when `segments: false` */
  cell: Polygon | null;
}

export interface LayoutBox {
  w: number;
  h: number;
  /** radius to keep clear at the centre so zones do not sit under the card */
  clear: number;
}

/** A layout places N zones around the centre, in pixels. */
export type Layout = (n: number, box: LayoutBox) => Point[];

/** A zone the model suggests, with the features that carried the decision. */
export interface Prediction {
  id: string;
  score: number;
  why: string[];
}

/** One filing, as handed to the model. A card filed into three zones sends three of these. */
export interface SortRecord<T = unknown> {
  item: T;
  meta: unknown;
  zoneId: string;
  /** what the model had suggested — used to measure how right it was */
  predicted?: string | null;
  at: number;
}

/**
 * What the deck expects from a model. `@trieur/learn` provides one, but anything answering
 * `best()` will do — including a network call: the deck accepts a promise and drops the
 * answer if the card changed in the meantime.
 */
export interface Advisor<T = unknown> {
  best(meta: unknown, zoneIds: string[], minScore?: number): Prediction | null | Promise<Prediction | null>;
  record?(r: SortRecord<T>): unknown;
  forget?(r: SortRecord<T>): unknown;
}

/** Interface labels. English by default, `fr` provided, or bring your own. */
export interface DeckText {
  empty: string;
  skip: string;
  undo: string;
  expand: string;
  close: string;
  free: string;
  /** label of the multi-zone toggle */
  multi: string;
  /** name of the space bar, shown as the skip shortcut */
  space: string;
  count: (n: number) => string;
  /** label of the toggle once zones are picked */
  sortMany: (n: number) => string;
}

export interface DeckOptions<T = any> {
  /** the pile to sort; the first element is the top card */
  items?: T[];
  /** zones; `null` means a free zone */
  zones?: Array<Zone | null>;
  /** draws the card (required in practice) */
  renderCard?: (item: T, el: HTMLElement) => void;
  /** draws a zone; a Finder-style folder tile by default */
  renderZone?: (zone: PlacedZone, el: HTMLElement) => void;
  /** metadata handed to the model; the item itself by default */
  meta?: (item: T) => unknown;
  advisor?: Advisor<T>;
  /** minimum score for a zone to be suggested */
  minConfidence?: number;
  layout?: Layout | 'circle' | 'voronoi' | 'grid';
  /** carve the stage into regions and aim at the region rather than at an angle */
  segments?: boolean;
  /** keys handed to zones, in order */
  keys?: string;
  /** drag distance past which the drop is armed, in px */
  threshold?: number;
  /**
   * Allow a card to be filed into several zones at once. Off by default: it only makes
   * sense when zones are not mutually exclusive (folders, tags), and the host is the only
   * one who knows that.
   */
  multi?: boolean;
  text?: Partial<DeckText>;
  onSort?: (item: T, zone: PlacedZone) => unknown;
  /** files one card into several zones at once; see `multi` */
  onSortMany?: (item: T, zones: PlacedZone[]) => unknown;
  onUndo?: (item: T, zone: PlacedZone) => unknown;
  onUndoMany?: (item: T, zones: PlacedZone[]) => unknown;
  onSkip?: (item: T) => unknown;
  onAssign?: (index: number, item: T) => unknown;
  onEmpty?: () => unknown;
}

/** `detail` of the `trieur:*` events. */
export interface DeckEventMap<T = unknown> {
  /** `zone` is the primary (first) zone; `zones` holds them all */
  sort: { item: T; zone: PlacedZone; zones: PlacedZone[]; predicted: string | null; correct: boolean };
  undo: { item: T; zone: PlacedZone; zones: PlacedZone[] };
  skip: { item: T };
  assign: { index: number; item: T };
  suggest: { item: T } & Prediction;
  /** the multi-zone selection changed */
  pick: { item: T | undefined; zones: PlacedZone[]; multi: boolean };
  expand: { expanded: boolean };
  empty: Record<string, never>;
  error: { item?: T; zone?: PlacedZone; error: unknown };
}
