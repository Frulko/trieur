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
  /** the card's own size, for a layout that wants to hug it rather than clear it */
  cardW: number;
  cardH: number;
  /** half-width of the box to keep clear at the centre — the card, plus half a tile */
  clearX: number;
  /** half-height of that box */
  clearY: number;
  /** largest dimension of a zone tile, measured — so a layout can keep one on the stage */
  tile: number;
}

/**
 * What a layout hands back. Points alone are enough for tiles floating over a Voronoi
 * carving; a radial menu needs to describe its own wedges, so it may return them too.
 * Cells are in the same coordinates as points: pixels from the centre of the stage.
 */
export interface Placement {
  points: Point[];
  cells?: Polygon[];
  /**
   * Where the card should sit, in pixels from the centre of the stage.
   *
   * A layout that does not surround the card — a half or quarter radial menu — wants the hole
   * somewhere other than the middle, so that the arc gets the whole stage instead of half of
   * it. Absent, the card stays centred.
   */
  centre?: Point;
}

/** A layout places N zones around the centre, in pixels. */
export type Layout = (n: number, box: LayoutBox) => Point[] | Placement;

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
  /** accessible name of the held pad */
  hold: string;
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
  layout?: Layout | 'auto' | 'circle' | 'radial' | 'voronoi' | 'grid' | 'dock';
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
  /**
   * The held pad that turns multi-zone mode on with a thumb, like a virtual gamepad button.
   *
   * `'dynamic'` summons it wherever the thumb presses and holds on the stage, the way a
   * virtual joystick appears under the thumb rather than waiting in a corner. `'left'` /
   * `'right'` pin it to a corner. `'auto'` (default) means dynamic on coarse pointers and
   * nothing on a mouse. `false` removes it. Ignored unless `multi` is on.
   */
  multiPad?: 'auto' | 'dynamic' | 'left' | 'right' | false;
  /**
   * How long a finger must rest on a card before it turns multi-zone mode on, in ms. The same
   * finger then sweeps across zones, and releasing files them. `0` disables it.
   */
  holdDelay?: number;
  /**
   * On a touch screen, outside fullscreen, a tap on the card opens the deck fullscreen instead
   * of starting a drag (default `true`).
   *
   * On a phone a sorting swipe and a page scroll are the same gesture: taking one takes the
   * other, and the page turns into a trap you cannot scroll past. So inline the deck is a
   * preview — the page scrolls straight through it — and the gesture is ours only once the
   * deck owns the screen, the way an embedded map waits to be opened before it eats drags.
   * Set it to `false` where the deck already *is* the screen: an app view, a phone-sized popup.
   */
  touchFullscreen?: boolean;
  /**
   * **Experimental.** Throw instead of drop: on release the card keeps the speed it had, and
   * the zone is the one where that throw *lands*, not the one under the finger.
   *
   * It is aimed at the two cases where a drop-where-you-are is a coin toss: zones far from the
   * card, where the drag has to cross the whole stage to reach them, and a mosaic of small
   * neighbouring cells, where a few pixels either side of a border file the card in the wrong
   * folder. A flick states a direction, and a direction is a much easier thing to be accurate
   * about than a coordinate.
   */
  /**
   * **Experimental.** How many piles to deal at once, side by side, sharing the same zones
   * (default 1).
   *
   * It is for a big tablet held in two hands: one pile in the middle has both thumbs doing
   * the same job in turn, two piles have each thumb owning one, and neither waits for the
   * other. A pile keeps its card until that card leaves, so filing on the left never shuffles
   * what the right hand was about to drop. The keyboard, the suggestion and Undo follow the
   * pile you last touched — `deck.active`.
   */
  piles?: number;
  flick?: boolean;
  /** how far ahead a throw is projected, in ms of travel at the release speed (default 170) */
  flickMs?: number;
  /** below this speed, in px/ms, a release is a drop and not a throw (default 0.25) */
  flickMin?: number;
  /** draw the throw vector and where it lands — for tuning `flickMs`, and for the demo */
  flickDebug?: boolean;
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
  /** a drag ended: what the release was worth, and what it aimed at. See `flick`. */
  release: { item: T | undefined; zone: PlacedZone | null; speed: number; carried: number; thrown: boolean };
  /** the multi-zone selection changed */
  pick: { item: T | undefined; zones: PlacedZone[]; multi: boolean };
  expand: { expanded: boolean };
  empty: Record<string, never>;
  error: { item?: T; zone?: PlacedZone; error: unknown };
}
