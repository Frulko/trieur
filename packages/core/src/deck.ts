// The deck: a pile of cards, zones around it, one gesture per card.
//
// Domain-agnostic — the library knows nothing about what it sorts. The host draws the card
// (`renderCard`) and performs the filing (`onSort`). No dependencies.

import { catchPulse, enterBehind, enterTop, genie, type Enter } from './anim.js';
import { startGesture, type GestureState } from './drag.js';
import { angleGap, angleOf, resolveLayout } from './layouts.js';
import { en } from './text.js';
import { defaultTile } from './tile.js';
import type {
  DeckEventMap,
  DeckOptions,
  DeckText,
  LayoutBox,
  PlacedZone,
  Point,
  Polygon,
  Prediction,
  SortRecord,
  Zone,
} from './types.js';
import { inPolygon, pathOf, voronoi } from './voronoi.js';

// home-row keys first, in the order the eye travels around the circle
const DEFAULT_KEYS = 'asdfghjklqwertyuiopzxcvbnm';
/** Width of a zone tile. Layouts use it to keep one from hanging off the stage. */
const TILE = 104;

/**
 * How the multi-zone stack was opened — which decides how it closes.
 *
 * `shift` and `hold` and `pad` are *held*: letting go files the stack. `latch` is sticky and
 * waits for an explicit confirmation. Keeping the source is what stops a stray Shift release
 * from firing a stack the user latched from the bar.
 */
type MultiSource = 'shift' | 'latch' | 'hold' | 'pad';

export class Deck<T = any> {
  readonly root: HTMLElement;
  items: T[];
  zones: PlacedZone[] = [];
  /** what the model suggests for the top card, or null */
  prediction: Prediction | null = null;
  expanded = false;

  #opts: DeckOptions<T>;
  #text: DeckText;
  #stage: HTMLElement;
  #segsEl: SVGSVGElement;
  #vecEl: SVGSVGElement;
  #zonesEl: HTMLElement;
  #cardsEl: HTMLElement;
  #padEl: HTMLElement;
  #history: Array<{ item: T; zones: PlacedZone[] }> = [];
  #busy = false;
  /** zones stacked up for the current card, in the order they were picked */
  #picks: PlacedZone[] = [];
  #multi: MultiSource | null = null;
  /** a key was pressed while Shift was down — so a bare Shift tap stays unambiguous */
  #shiftUsed = false;
  /** suggestion token: a late answer must not apply to the next card */
  #ask = 0;
  /** where the card sits, in px from the centre of the stage — a layout may move it */
  #centre: Point = { x: 0, y: 0 };
  /** stage rect, read once per drag instead of once per move */
  #rect: DOMRect | null = null;
  /** what is currently lit, so a move that changes nothing touches no DOM */
  #lit = '';
  /** signature of the last layout, so an unchanged stage is not rebuilt */
  #layoutKey = '';
  /** last tap on a card, to spot the second one */
  #lastTap = { t: 0, x: 0, y: 0 };
  /** which item each card element is showing, so a card can be kept instead of rebuilt */
  #shown = new WeakMap<HTMLElement, T>();
  /** the item each pile is holding; `piles: 1` makes this a one-element array */
  #lanes: Array<T | undefined> = [];
  /** the pile the keyboard and the suggestion apply to */
  #active = 0;
  #onResize: () => void;
  #onEsc: (e: KeyboardEvent) => void;

  constructor(root: HTMLElement, opts: DeckOptions<T> = {}) {
    this.root = root;
    this.#opts = { threshold: 90, holdDelay: 420, ...opts };
    this.#text = { ...en, ...opts.text };
    this.items = [...(opts.items ?? [])];

    const t = this.#text;
    root.classList.add('tr');
    root.innerHTML = `
      <div class="tr-stage" tabindex="0" role="application" aria-roledescription="card sorter">
        <svg class="tr-segments" aria-hidden="true"></svg>
        <svg class="tr-vector" aria-hidden="true" hidden></svg>
        <div class="tr-zones"></div>
        <div class="tr-cards"></div>
        <p class="tr-nothing" hidden></p>
        <button type="button" class="tr-pad" data-tr="pad" aria-label="${t.hold}" hidden>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4 5 11h4v9h6v-9h4Z" fill="currentColor"/></svg>
        </button>
      </div>
      <div class="tr-bar">
        <span class="tr-count" aria-live="polite"></span>
        <span class="tr-actions">
          <button type="button" data-tr="multi" aria-pressed="false" hidden></button>
          <button type="button" data-tr="skip"></button>
          <button type="button" data-tr="undo" disabled></button>
          <button type="button" data-tr="expand" aria-expanded="false"></button>
        </span>
      </div>
      <button type="button" class="tr-close" data-tr="collapse" aria-label="${t.close}">
        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
        <kbd>Esc</kbd>
      </button>`;
    this.#stage = root.querySelector('.tr-stage')!;
    this.#segsEl = root.querySelector('.tr-segments')!;
    this.#vecEl = root.querySelector('.tr-vector')!;
    this.#zonesEl = root.querySelector('.tr-zones')!;
    this.#cardsEl = root.querySelector('.tr-cards')!;
    this.#padEl = root.querySelector('.tr-pad')!;
    this.#label('.tr-nothing', t.empty);
    this.#button('skip', t.skip, t.space);
    this.#button('undo', t.undo, '⌫');
    this.#button('expand', t.expand);
    root.querySelector('[data-tr="collapse"]')!.setAttribute('title', t.close);

    this.#stage.addEventListener('pointerdown', (e) => this.#stagePress(e));
    this.#stage.addEventListener('keydown', (e) => this.#onKey(e));
    this.#stage.addEventListener('keyup', (e) => this.#onKeyUp(e));
    this.#bindPad();
    root.addEventListener('click', (e) => {
      const target = e.target as Element;
      const b = target.closest<HTMLElement>('[data-tr]');
      switch (b?.dataset.tr) {
        case 'skip':
          return this.skip();
        case 'undo':
          return void this.undo();
        case 'expand':
          return this.expand(!this.expanded);
        case 'collapse':
          return this.expand(false);
        case 'multi':
          // once something is picked, the same button becomes the confirmation
          if (this.#picks.length) return void this.commitMany();
          return this.#setMulti(this.#multi ? null : 'latch');
      }
      // in multi mode the tiles become tappable: pick, pick, pick, confirm — no keyboard
      const tile = target.closest<HTMLElement>('.tr-zone');
      if (tile && this.#multi) {
        const zone = this.zones[Number(tile.dataset.index)];
        if (zone) this.#togglePick(zone);
      }
    });
    // Esc unwinds one layer at a time, from anywhere: focus may sit on a card
    this.#onEsc = (e) => {
      if (e.key !== 'Escape') return;
      if (this.#multi || this.#picks.length) {
        e.preventDefault();
        return this.#clearPicks();
      }
      if (this.expanded) {
        e.preventDefault();
        this.expand(false);
      }
    };
    document.addEventListener('keydown', this.#onEsc);
    // a resize moves the zones, hence the drop regions
    this.#onResize = () => this.layout(true);
    window.addEventListener('resize', this.#onResize);

    this.setZones(opts.zones ?? []);
    this.render();
  }

  destroy(): void {
    window.removeEventListener('resize', this.#onResize);
    document.removeEventListener('keydown', this.#onEsc);
    document.documentElement.classList.remove('tr-locked');
    this.root.classList.remove('tr', 'tr-full', 'tr-multi');
    this.root.innerHTML = '';
  }

  // --- data ------------------------------------------------------------------

  setItems(items: T[]): void {
    this.items = [...items];
    this.#clearPicks();
    this.render();
  }

  /**
   * Sets the zones. A zone is a fixed spot with its key; what it holds can change without
   * the key moving — that is what makes the gesture memorable. `null` means a free zone:
   * dropping a card there calls `onAssign(index)` instead of `onSort`.
   */
  setZones(zones: Array<Zone | null>): void {
    const keys = this.#opts.keys ?? DEFAULT_KEYS;
    this.zones = zones.map((z, i) => ({
      ...(z ?? {}),
      id: z?.id ?? '',
      index: i,
      empty: !z?.id,
      // key by position, not by label: it survives a change of content
      key: (z?.key ?? keys[i] ?? '').toLowerCase(),
      angle: 0,
      pos: { x: 0, y: 0 },
      cell: null,
    }));
    // a pick pointing at a zone that no longer exists would file into nowhere
    this.#picks = this.#picks.map((p) => this.zones.find((z) => z.id === p.id)).filter((z): z is PlacedZone => !!z);
    this.#renderZones();
  }

  setOptions(patch: Partial<DeckOptions<T>>): void {
    this.#opts = { ...this.#opts, ...patch };
    if (patch.text) this.#text = { ...this.#text, ...patch.text };
    if (patch.zones) return this.setZones(patch.zones);
    this.layout(true);
    this.render();
  }

  get current(): T | undefined {
    return this.#lanes[this.#active] ?? this.items[0];
  }

  /** Which pile the keyboard, the suggestion and Undo are talking about. */
  get active(): number {
    return this.#active;
  }
  set active(i: number) {
    const piles = Math.max(1, Math.round(this.#opts.piles ?? 1));
    this.#active = Math.max(0, Math.min(Math.round(i), piles - 1));
    for (const pile of this.#cardsEl.children) {
      (pile as HTMLElement).dataset.active = String(Number((pile as HTMLElement).dataset.lane) === this.#active);
    }
    void this.suggest();
  }

  get options(): Readonly<DeckOptions<T>> {
    return this.#opts;
  }

  /** Zones stacked up for the current card, in pick order. The first one is the primary. */
  get picking(): PlacedZone[] {
    return [...this.#picks];
  }

  /** Whether the multi-zone mode is on. */
  get multi(): boolean {
    return this.#multi !== null;
  }

  // --- rendering -------------------------------------------------------------

  #renderZones(): void {
    this.#zonesEl.replaceChildren();
    for (const z of this.zones) {
      const el = document.createElement('div');
      el.className = 'tr-zone' + (z.empty ? ' tr-free' : '');
      el.dataset.index = String(z.index);
      if (z.id) el.dataset.id = z.id;
      if (z.color) el.style.setProperty('--tr-seg', z.color);
      if (this.#opts.renderZone) this.#opts.renderZone(z, el);
      else el.append(defaultTile(z, this.#text));
      this.#zonesEl.append(el);
    }
    this.#lit = '';
    this.layout(true);
    this.#paintPicks();
  }

  /**
   * Places the zones and remembers each one's direction (used for aiming while dragging).
   *
   * Nothing is written when the stage, the card size and the zone count are unchanged. That
   * matters more than it looks: `render()` runs while a card is in flight, and rebuilding the
   * region SVG mid-flight is exactly the hitch you feel on an older tablet.
   */
  layout(force = false): void {
    const els = [...this.#zonesEl.children] as HTMLElement[];
    if (!els.length) return;
    // The scale follows the stage, not the window: a deck in a 420px panel on a wide screen
    // has exactly the problem a deck on a phone has, and a viewport media query answers the
    // wrong question in both directions. Set before anything is measured, so the measurements
    // are the ones that count.
    const stageW = this.#stage.clientWidth;
    this.root.classList.toggle('tr-sm', stageW > 0 && stageW < 560);
    this.root.classList.toggle('tr-xs', stageW > 0 && stageW < 400);
    const card = this.#cardsEl.querySelector('.tr-card') as HTMLElement | null;
    // Zones clear the card along an **ellipse**, not a circle: a zone directly above only has
    // to clear the card's height, and using the circumscribed radius everywhere pushed the top
    // tile off a short stage. Rounded to 8px steps so a card one pixel taller does not shift
    // every zone.
    const round = (v: number) => Math.round(v / 8) * 8;
    // measured, not assumed: a tile with a two-line label and a keycap is half again as tall
    // as it is wide, and margining on the width alone let the top row hang off the stage
    const first = els[0]!;
    const tile = round(Math.max(first.offsetWidth, first.offsetHeight)) || TILE;
    const cardW = card?.offsetWidth ?? 260;
    const cardH = card?.offsetHeight ?? 300;
    const box: LayoutBox = {
      w: this.#stage.clientWidth,
      h: this.#stage.clientHeight,
      cardW,
      cardH,
      clearX: round(cardW / 2 + tile * 0.5),
      clearY: round(cardH / 2 + tile * 0.5),
      tile,
    };
    const key = `${box.w}×${box.h}:${cardW}×${cardH}:${tile}:${els.length}:${String(this.#opts.layout)}:${this.#opts.segments !== false}`;
    if (!force && key === this.#layoutKey) return;
    this.#layoutKey = key;

    const { points, cells, centre } = resolveLayout(this.#opts.layout)(els.length, box);
    // Where the card goes — read before the zones, since their direction is measured from it.
    // A layout may say so itself: an arc menu wants the hole off-centre so the wedges get the
    // whole stage instead of half of it.
    this.#centre = centre ?? { x: 0, y: 0 };
    els.forEach((el, i) => {
      const p = points[i] ?? { x: 0, y: 0 };
      const z = this.zones[i]!;
      // the direction *from the card*, which is not the stage centre when a layout moved it
      z.angle = angleOf(p.x - this.#centre.x, p.y - this.#centre.y);
      z.pos = p; // where the genie animation lands
      el.style.left = `calc(50% + ${p.x}px)`;
      el.style.top = `calc(50% + ${p.y}px)`;
    });
    // Otherwise the deck works it out: a layout that parks every tile along the bottom edge
    // leaves the card everything above them, which is what stops the first wrapped row of a
    // dock from landing on the card.
    const ys = points.map((p) => p.y);
    const band = !centre && ys.length && ys.every((y) => y > 0) ? box.h / 2 - (Math.min(...ys) - box.tile / 2) : 0;
    // never so deep that the card no longer fits above it: a tray that squeezes the card is
    // worse than a tray the card slightly overlaps
    const tray = Math.max(0, Math.min(band, box.h - box.cardH - 12));
    this.root.style.setProperty('--tr-tray', `${Math.round(tray)}px`);
    this.root.style.setProperty('--tr-card-x', `${Math.round(this.#centre.x)}px`);
    this.root.style.setProperty('--tr-card-y', `${Math.round(this.#centre.y)}px`);
    // a host styles a radial menu differently from floating tiles, and only the deck knows
    // which layout is in play
    const name = typeof this.#opts.layout === 'string' ? this.#opts.layout : this.#opts.layout ? 'custom' : 'auto';
    for (const c of [...this.root.classList]) if (c.startsWith('tr-layout-')) this.root.classList.remove(c);
    this.root.classList.add(`tr-layout-${name}`);
    this.#paintSegments(points, cells, box.w, box.h);
  }

  /**
   * Draws the carving. It is not only a drawing: **the drop aims at the region under the
   * finger**, not at an approximate angle. What you see is what you touch.
   */
  #paintSegments(pts: Point[], given: Polygon[] | undefined, w: number, h: number): void {
    if (this.#opts.segments === false || pts.length < 2) {
      this.#segsEl.replaceChildren();
      for (const z of this.zones) z.cell = null;
      return;
    }
    // a layout that describes its own regions (a radial menu) keeps them; anything else gets
    // the Voronoi of its points
    const cells = given
      ? given.map((cell) => cell.map(([x, y]) => [w / 2 + x, h / 2 + y] as [number, number]))
      : voronoi(
          pts.map((p) => ({ x: w / 2 + p.x, y: h / 2 + p.y })),
          w,
          h,
        );
    this.#segsEl.setAttribute('viewBox', `0 0 ${w} ${h}`);
    this.#segsEl.replaceChildren(
      ...cells.map((cell, i) => {
        const z = this.zones[i]!;
        z.cell = cell;
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', pathOf(cell));
        path.setAttribute('class', 'tr-seg');
        path.dataset.index = String(i);
        if (z.color) path.style.setProperty('--tr-seg', z.color);
        return path;
      }),
    );
    this.#lit = '';
    this.#paintPicks();
  }

  /** Zone under a point of the stage (screen coordinates). */
  zoneAt(clientX: number, clientY: number): PlacedZone | null {
    // during a drag the rect is the one cached at pointerdown: measuring it on every move is
    // a forced layout per frame, and it is the single most expensive thing a drag can do
    const r = this.#rect ?? this.#stage.getBoundingClientRect();
    const [x, y] = [clientX - r.left, clientY - r.top];
    return this.zones.find((z) => z.cell && inPolygon(z.cell, x, y)) ?? null;
  }

  /**
   * Which item each pile shows, and the one behind it.
   *
   * A pile keeps its card until that card actually leaves: filing the left pile must not make
   * the right one change under the other hand. So the lanes hold items, the queue is whatever
   * no lane holds, and only an empty lane draws from it.
   */
  #assign(piles: number): Array<{ top?: T; behind?: T }> {
    const lanes = this.#lanes;
    lanes.length = piles;
    for (let i = 0; i < piles; i++) {
      if (lanes[i] !== undefined && !this.items.includes(lanes[i]!)) lanes[i] = undefined;
    }
    const held = new Set(lanes.filter((x): x is T => x !== undefined));
    const queue = this.items.filter((it) => !held.has(it));
    let q = 0;
    const out: Array<{ top?: T; behind?: T }> = [];
    for (let i = 0; i < piles; i++) {
      if (lanes[i] === undefined && q < queue.length) lanes[i] = queue[q++];
      out[i] = { top: lanes[i] };
    }
    // one card showing behind each top card, so a pile reads as a pile
    for (let i = 0; i < piles; i++) if (q < queue.length) out[i]!.behind = queue[q++];
    if (lanes[this.#active] === undefined) {
      const first = lanes.findIndex((x) => x !== undefined);
      this.#active = first < 0 ? 0 : first;
    }
    return out;
  }

  /** Makes the DOM hold exactly `n` piles. One pile is the ordinary deck. */
  #syncPiles(n: number): void {
    this.root.classList.toggle('tr-piles', n > 1);
    while (this.#cardsEl.children.length > n) this.#cardsEl.lastElementChild!.remove();
    while (this.#cardsEl.children.length < n) {
      const pile = document.createElement('div');
      pile.className = 'tr-pile';
      pile.dataset.lane = String(this.#cardsEl.children.length);
      this.#cardsEl.append(pile);
    }
    for (const pile of this.#cardsEl.children) {
      (pile as HTMLElement).dataset.active = String(Number((pile as HTMLElement).dataset.lane) === this.#active);
    }
  }

  /** One pile: the top card, the one behind it, and as little DOM churn as possible. */
  #renderPile(pile: HTMLElement, top: T | undefined, next: T | undefined, enter?: Enter): void {
    // A card in flight survives the next render, and above all we do not *touch* it:
    // reinserting it in the DOM cancels its transition and snaps it to the end state.
    const live = ([...pile.children] as HTMLElement[]).filter((c) => !c.classList.contains('tr-genie'));
    // The card that was second becomes first — and it is the *same element*, promoted by a
    // class. Rebuilding it would refetch every image it holds, and an image that reloads
    // blinks: that blink is the whole reason this reconciles instead of replacing.
    const take = (item: T | undefined): HTMLElement | null => {
      if (item === undefined) return null;
      const i = live.findIndex((c) => this.#shown.get(c) === item);
      return i < 0 ? null : live.splice(i, 1)[0]!;
    };
    const kept = { top: take(top), behind: take(next) };
    for (const stale of live) stale.remove();

    const behind = kept.behind ?? (next !== undefined ? this.#buildCard(next) : null);
    const front = kept.top ?? (top !== undefined ? this.#buildCard(top) : null);
    behind?.classList.add('tr-behind');
    front?.classList.remove('tr-behind');
    // insert around whichever card stayed, so the one that stayed keeps its transition: moving
    // a node in the DOM restarts it, and the promotion *is* the animation
    if (behind && front) {
      if (!behind.isConnected && !front.isConnected) pile.append(behind, front);
      else if (!behind.isConnected) front.before(behind);
      else if (!front.isConnected) behind.after(front);
      else if (behind.compareDocumentPosition(front) & Node.DOCUMENT_POSITION_PRECEDING) front.before(behind);
    } else if (behind && !behind.isConnected) pile.append(behind);
    else if (front && !front.isConnected) pile.append(front);
    if (enter) {
      if (behind && !kept.behind) enterBehind(behind);
      if (front && !kept.top) enterTop(front, enter);
    }
  }

  render(enter?: Enter): void {
    const piles = Math.max(1, Math.round(this.#opts.piles ?? 1));
    const plan = this.#assign(piles);
    this.#syncPiles(piles);
    const piled = [...this.#cardsEl.children] as HTMLElement[];
    plan.forEach((p, i) => this.#renderPile(piled[i]!, p.top, p.behind, enter));
    const top = this.current;
    (this.root.querySelector('.tr-nothing') as HTMLElement).hidden = top !== undefined;
    this.layout(); // the card's size can change the clearance
    this.#label('.tr-count', this.items.length ? this.#text.count(this.items.length) : '');
    (this.root.querySelector('[data-tr="undo"]') as HTMLButtonElement).disabled = !this.#history.length;
    (this.root.querySelector('[data-tr="multi"]') as HTMLButtonElement).hidden = !this.#opts.multi;
    this.#syncPad();
    void this.suggest();
    if (top === undefined) {
      this.#emit('empty', {});
      this.#opts.onEmpty?.();
    }
  }

  /**
   * Marks the zone the model suggests for the top card.
   *
   * `best()` may answer asynchronously (a server, for instance): we drop the answer if the
   * card changed in the meantime. The prediction never blocks the gesture — the card is
   * already under the finger.
   */
  async suggest(): Promise<void> {
    const ask = ++this.#ask;
    this.prediction = null;
    for (const el of this.#zonesEl.children) el.classList.remove('tr-suggest');
    const advisor = this.#opts.advisor;
    const item = this.current;
    if (!advisor || item === undefined) return;
    const ids = this.zones.filter((z) => !z.empty).map((z) => z.id);
    if (!ids.length) return;
    let top: Prediction | null = null;
    try {
      top = (await advisor.best(this.#meta(item), ids, this.#opts.minConfidence)) ?? null;
    } catch (error) {
      this.#emit('error', { item, error });
      return;
    }
    if (ask !== this.#ask || !top) return; // the card changed while we waited
    this.prediction = top;
    [...this.#zonesEl.children].find((e) => (e as HTMLElement).dataset.id === top!.id)?.classList.add('tr-suggest');
    this.#emit('suggest', { item, ...top });
  }

  #meta(item: T): unknown {
    return this.#opts.meta ? this.#opts.meta(item) : item;
  }

  #buildCard(item: T): HTMLElement {
    const el = document.createElement('article');
    el.className = 'tr-card';
    this.#shown.set(el, item);
    this.#opts.renderCard?.(item, el);
    // without this the browser starts its own image drag and steals the gesture
    for (const img of el.querySelectorAll('img')) img.draggable = false;
    // The listeners live on the element for as long as it does: a card is promoted from the
    // pile by a class, not by being rebuilt, so they check the role instead of assuming it.
    el.addEventListener('pointerdown', (e) => {
      if (el.classList.contains('tr-behind')) return;
      // the hand that touches a pile is the hand the keyboard and the suggestion follow
      const lane = Number((el.parentElement as HTMLElement | null)?.dataset.lane ?? 0);
      if (lane !== this.#active) this.active = lane;
      // A phone scrolls the page with the same swipe that would drag a card. Inline the deck
      // stays a preview and lets the page scroll; the gesture is ours alone once expanded.
      if (this.#tapToExpand()) return;
      if (!this.#doubleTap(e)) this.#startDrag(e, el);
    });
    el.addEventListener('click', (e) => {
      if (!this.#tapToExpand() || (e.target as Element).closest('a, button, input, label')) return;
      this.expand(true);
    });
    return el;
  }

  /** On a touch screen, outside fullscreen, a tap opens rather than sorts. */
  #tapToExpand(): boolean {
    return (
      this.#opts.touchFullscreen !== false &&
      !this.expanded &&
      typeof matchMedia === 'function' &&
      matchMedia('(pointer: coarse)').matches
    );
  }

  // --- multi-zone selection --------------------------------------------------

  #setMulti(source: MultiSource | null): void {
    if (this.#multi === source) return;
    this.#multi = source;
    this.root.classList.toggle('tr-multi', source !== null);
    this.#padEl.classList.toggle('tr-on', source === 'pad' || source === 'hold');
    // a short buzz makes a held mode feel like a button, where a phone has no Shift key
    if (source && typeof navigator !== 'undefined') navigator.vibrate?.(8);
    this.#paintPicks();
    this.#emit('pick', { item: this.current, zones: this.picking, multi: this.multi });
  }

  /** Adds or removes a zone from the stack. The first one picked stays the primary zone. */
  #togglePick(zone: PlacedZone): void {
    if (zone.empty) return; // a free zone has nothing to file into yet
    const i = this.#picks.findIndex((z) => z.index === zone.index);
    if (i >= 0) this.#picks.splice(i, 1);
    else this.#picks.push(zone);
    catchPulse(this.#tile(zone));
    this.#paintPicks();
    this.#emit('pick', { item: this.current, zones: this.picking, multi: this.multi });
  }

  /** Adds a zone, never removes it — sweeping back over a zone must not undo it. */
  #stack(zone: PlacedZone): void {
    if (zone.empty || this.#picks.some((z) => z.index === zone.index)) return;
    this.#togglePick(zone);
  }

  #clearPicks(): void {
    this.#picks = [];
    this.#setMulti(null);
    this.#paintPicks();
  }

  #paintPicks(): void {
    const rankOf = (el: Element) => this.#picks.findIndex((z) => z.index === Number((el as HTMLElement).dataset.index));
    for (const el of this.#zonesEl.children) {
      const rank = rankOf(el);
      el.classList.toggle('tr-picked', rank >= 0);
      if (rank >= 0) (el as HTMLElement).dataset.pick = String(rank + 1);
      else delete (el as HTMLElement).dataset.pick;
    }
    for (const p of this.#segsEl.children) p.classList.toggle('tr-picked', rankOf(p) >= 0);
    const btn = this.root.querySelector('[data-tr="multi"]') as HTMLButtonElement | null;
    if (btn) {
      btn.textContent = this.#picks.length ? this.#text.sortMany(this.#picks.length) : this.#text.multi;
      btn.classList.toggle('tr-on', this.#multi !== null);
      btn.setAttribute('aria-pressed', String(this.#multi !== null));
    }
  }

  /** The held pad: a virtual gamepad button for the hand that has no Shift key. */
  #bindPad(): void {
    this.#padEl.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (!this.#opts.multi) return;
      try {
        this.#padEl.setPointerCapture(e.pointerId);
      } catch {}
      this.#setMulti('pad');
    });
    const release = () => {
      if (this.#multi !== 'pad') return;
      if (this.#picks.length) void this.commitMany();
      else this.#clearPicks();
    };
    this.#padEl.addEventListener('pointerup', release);
    this.#padEl.addEventListener('pointercancel', release);
  }

  /** Where the pad lives, or nowhere. `'auto'` means "where it earns its place": a thumb has
   *  no Shift key, a mouse does. */
  #padMode(): 'left' | 'right' | 'dynamic' | null {
    const want = this.#opts.multiPad ?? 'auto';
    if (!this.#opts.multi || want === false) return null;
    if (want !== 'auto') return want;
    const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    return coarse ? 'dynamic' : null;
  }

  #syncPad(): void {
    const mode = this.#padMode();
    const pad = this.#padEl;
    pad.classList.toggle('tr-pad-left', mode === 'left');
    pad.classList.toggle('tr-pad-dynamic', mode === 'dynamic');
    if (mode === 'dynamic') {
      // a dynamic pad only exists under the thumb that summoned it
      if (this.#multi !== 'pad' && !pad.classList.contains('tr-charging')) pad.hidden = true;
      return;
    }
    pad.hidden = mode === null;
    pad.style.left = '';
    pad.style.top = '';
  }

  /**
   * A thumb pressed and held on the empty part of the stage summons the pad **where it
   * is** — the way a virtual joystick appears under the thumb instead of waiting in a corner.
   * A ring fills during the hold so the wait is visible, and letting go files the stack.
   */
  #stagePress(e: PointerEvent): void {
    if (this.#padMode() !== 'dynamic' || this.#multi || this.#tapToExpand()) return;
    if ((e.target as Element).closest('.tr-card, .tr-pad, .tr-bar')) return; // the card has its own gesture
    const r = this.#stage.getBoundingClientRect();
    const pad = this.#padEl;
    pad.style.left = `${e.clientX - r.left}px`;
    pad.style.top = `${e.clientY - r.top}px`;
    pad.style.setProperty('--tr-hold', `${this.#opts.holdDelay || 420}ms`);
    pad.hidden = false;
    pad.classList.add('tr-charging');

    const timer = setTimeout(() => {
      pad.classList.remove('tr-charging');
      this.#setMulti('pad');
    }, this.#opts.holdDelay || 420);
    const off = (ev: Event) => {
      if ((ev as PointerEvent).pointerId !== e.pointerId) return;
      clearTimeout(timer);
      pad.classList.remove('tr-charging');
      window.removeEventListener('pointerup', off);
      window.removeEventListener('pointercancel', off);
      if (this.#multi === 'pad') {
        if (this.#picks.length) void this.commitMany();
        else this.#clearPicks();
      }
      this.#syncPad();
    };
    window.addEventListener('pointerup', off);
    window.addEventListener('pointercancel', off);
  }

  /**
   * Two taps on the card take the model's word for it — the touch equivalent of `↵`, which a
   * thumb cannot press. Only when there is something to accept, and never on a link.
   */
  #doubleTap(e: PointerEvent): boolean {
    const now = Date.now();
    const quick = now - this.#lastTap.t < 320;
    const near = Math.hypot(e.clientX - this.#lastTap.x, e.clientY - this.#lastTap.y) < 26;
    this.#lastTap = { t: now, x: e.clientX, y: e.clientY };
    if (!quick || !near || this.#multi || (e.target as Element).closest('a, button, input')) return false;
    const z = this.prediction ? this.zones.find((x) => x.id === this.prediction!.id) : null;
    if (!z) return false;
    this.#lastTap.t = 0; // a triple tap is not a second acceptance
    void this.commit(z);
    return true;
  }

  // --- gesture ---------------------------------------------------------------

  #startDrag(e: PointerEvent, el: HTMLElement): void {
    if (this.#busy) return;
    const threshold = this.#opts.threshold!;
    this.#rect = this.#stage.getBoundingClientRect(); // read once, then never during the drag
    startGesture(
      el,
      e,
      {
        // a finger resting on the card opens the stack, and the same finger then sweeps
        onHold: () => {
          if (this.#opts.multi && !this.#multi) this.#setMulti('hold');
        },
        onMove: (g, ev) => {
          // the closer to a zone, the smaller the card: it "enters" the zone before release.
          // translate3d keeps the card on its own compositor layer instead of repainting it.
          const k = Math.min(g.dist / (threshold * 2), 1);
          el.style.transform = `translate3d(${g.dx}px, ${g.dy}px, 0) rotate(${(g.dx / 22).toFixed(2)}deg) scale(${(1 - 0.42 * k).toFixed(3)})`;
          // where a release *now* would land: under the finger, or where the throw carries
          const thrown = this.#throwTo(g, ev);
          const near = thrown
            ? this.#aim(g.dx + thrown.x - ev.clientX, g.dy + thrown.y - ev.clientY, thrown.x, thrown.y)
            : g.dist > 30
              ? this.#aim(g.dx, g.dy, ev.clientX, ev.clientY)
              : null;
          const armed = thrown !== null || g.dist > threshold;
          this.#highlight(near, armed);
          if (this.#opts.flick && this.#opts.flickDebug) this.#paintVector(ev, thrown);
          // in multi mode the finger stays down and sweeps: every region it reaches joins the
          // stack, and letting go files them
          if (this.#multi && near && armed) this.#stack(near);
        },
        onEnd: (g, ev) => {
          this.#highlight(null, false);
          this.#paintVector(null, null);
          const thrown = this.#throwTo(g, ev);
          this.#rect = null;
          if (this.#multi) {
            el.style.transform = ''; // the card was pointing at zones, not leaving
            // the pad decides when a pad-held stack goes; this finger only pointed
            if (this.#multi === 'hold') {
              if (this.#picks.length) void this.commitMany();
              else this.#clearPicks();
            }
            return;
          }
          // a cancelled pointer is not a drop: the system took the touch back
          const zone = g.cancelled
            ? null
            : thrown
              ? this.#aim(g.dx + thrown.x - ev.clientX, g.dy + thrown.y - ev.clientY, thrown.x, thrown.y)
              : g.dist > threshold
                ? this.#aim(g.dx, g.dy, ev.clientX, ev.clientY)
                : null;
          this.#emit('release', {
            item: this.current,
            zone,
            speed: Math.hypot(g.vx, g.vy),
            carried: thrown ? Math.hypot(thrown.x - ev.clientX, thrown.y - ev.clientY) : 0,
            thrown: thrown !== null,
          });
          if (!zone) return void (el.style.transform = ''); // nothing aimed at: back to the centre
          // A release always resolves. The card only stays out there if a zone actually took
          // it — a free zone, a busy deck or a refused filing all mean it comes home. Without
          // this it froze between where it started and where it was dropped.
          void this.commit(zone, g.dx).then((taken) => {
            if (!taken) el.style.transform = '';
          });
        },
      },
      { holdDelay: this.#opts.multi ? this.#opts.holdDelay : 0 },
    );
  }

  /**
   * Where a throw lands, or `null` when the release was a drop.
   *
   * The card keeps the speed it had and travels `flickMs` more milliseconds at it. That is all
   * a flick is: a release point plus a vector. It matters where the target is far (the drag no
   * longer has to *reach* it) and where the targets are small (a direction survives a few
   * pixels of slop, a coordinate does not).
   */
  #throwTo(g: GestureState, ev: PointerEvent): Point | null {
    if (!this.#opts.flick) return null;
    const speed = Math.hypot(g.vx, g.vy);
    if (speed < (this.#opts.flickMin ?? 0.25)) return null;
    const r = this.#rect ?? this.#stage.getBoundingClientRect();
    // capped at the stage diagonal: past the edge every extra pixel aims at the same zone,
    // and an uncapped throw off a fast trackpad lands in another postcode
    const reach = Math.min(speed * (this.#opts.flickMs ?? 170), Math.hypot(r.width, r.height));
    return { x: ev.clientX + (g.vx / speed) * reach, y: ev.clientY + (g.vy / speed) * reach };
  }

  /** The debug view of the throw: the vector, and the point it is aimed at. */
  #paintVector(from: PointerEvent | null, to: Point | null): void {
    const svg = this.#vecEl;
    if (!from || !to) {
      svg.toggleAttribute('hidden', true);
      return;
    }
    const r = this.#rect ?? this.#stage.getBoundingClientRect();
    const [x1, y1] = [from.clientX - r.left, from.clientY - r.top];
    const [x2, y2] = [to.x - r.left, to.y - r.top];
    svg.setAttribute('viewBox', `0 0 ${r.width} ${r.height}`);
    svg.innerHTML =
      `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" class="tr-vec-line"/>` +
      `<circle cx="${x2.toFixed(1)}" cy="${y2.toFixed(1)}" r="9" class="tr-vec-dot"/>`;
    svg.toggleAttribute('hidden', false);
  }

  /** Zone being aimed at: the region under the finger; failing a carving, the drag direction. */
  #aim(dx: number, dy: number, x: number, y: number): PlacedZone | null {
    const byRegion = this.zoneAt(x, y);
    if (byRegion) return byRegion;
    const a = angleOf(dx, dy);
    const span = Math.PI / Math.max(this.zones.length, 1) + 0.25;
    return (
      this.zones
        .filter((z) => angleGap(a, z.angle) < span)
        .sort((x, y) => angleGap(a, x.angle) - angleGap(a, y.angle))[0] ?? null
    );
  }

  #highlight(zone: PlacedZone | null, armed: boolean): void {
    // a move that lights nothing new must touch no DOM at all
    const key = zone ? `${zone.index}:${armed}` : '';
    if (key === this.#lit) return;
    this.#lit = key;
    const mark = (el: Element) => {
      const on = zone !== null && Number((el as HTMLElement).dataset.index) === zone.index;
      el.classList.toggle('tr-near', on);
      el.classList.toggle('tr-armed', on && armed);
    };
    for (const el of this.#zonesEl.children) mark(el);
    for (const p of this.#segsEl.children) mark(p);
  }

  // --- keyboard --------------------------------------------------------------

  #onKey(e: KeyboardEvent): void {
    if (e.key === 'Shift') {
      // a repeat must not clear the flag a zone key has just set
      if (!e.repeat) this.#shiftUsed = false;
      return;
    }
    if (this.#busy || e.metaKey || e.ctrlKey || e.altKey) return;
    this.#shiftUsed = true; // whatever it was, this Shift press was not a bare tap
    if (e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      return this.skip();
    }
    if (e.key === 'Backspace') {
      e.preventDefault();
      return void this.undo();
    }
    if (e.key === 'Enter') {
      // a pending stack takes precedence: Enter confirms it
      if (this.#picks.length) {
        e.preventDefault();
        return void this.commitMany();
      }
      // otherwise ↵ accepts the model's suggestion: the most common gesture is the shortest
      if (this.prediction) {
        const z = this.zones.find((x) => x.id === this.prediction!.id);
        if (z) {
          e.preventDefault();
          return void this.commit(z);
        }
      }
    }
    const z = this.zones.find((x) => x.key && x.key === e.key.toLowerCase());
    if (z) {
      e.preventDefault();
      // Shift held down: stack zones instead of filing, and file on release
      if (this.#opts.multi && e.shiftKey && !this.#multi) this.#setMulti('shift');
      void this.commit(z);
    }
  }

  /**
   * Shift released. Three cases, and the source is what tells them apart:
   *
   * - it opened the stack (`shift`) → letting go files it;
   * - it was a **bare tap** → the shortcut: latch the mode, or file what is already stacked;
   * - anything else → not ours.
   */
  #onKeyUp(e: KeyboardEvent): void {
    if (e.key !== 'Shift' || this.#busy) return;
    if (this.#multi === 'shift') {
      if (this.#picks.length) void this.commitMany();
      else this.#clearPicks();
      return;
    }
    if (this.#shiftUsed || !this.#opts.multi) return;
    if (this.#picks.length) return void this.commitMany();
    this.#setMulti(this.#multi ? null : 'latch');
  }

  // --- actions ---------------------------------------------------------------

  /**
   * Files the top card into `zone`. In multi-zone mode, stacks it instead — the filing
   * happens on confirmation.
   *
   * Resolves to whether the card **left**: a free zone, a stack and a busy deck all answer
   * `false`, which is what tells the gesture to bring the card home.
   */
  async commit(zone: PlacedZone, fling?: number): Promise<boolean> {
    if (this.#multi && !zone.empty) {
      this.#togglePick(zone);
      return false;
    }
    // free zone: the host decides what goes there, the card does not move
    if (zone.empty) {
      const item = this.current;
      if (item === undefined) return false;
      this.#emit('assign', { index: zone.index, item });
      this.#opts.onAssign?.(zone.index, item);
      return false;
    }
    return this.#run([zone], fling);
  }

  /** Files the top card into every stacked zone at once. */
  async commitMany(zones: PlacedZone[] = this.picking): Promise<boolean> {
    if (!zones.length) return false;
    return this.#run(zones);
  }

  async #run(zones: PlacedZone[], fling?: number): Promise<boolean> {
    const item = this.current;
    const pile = this.#cardsEl.children[this.#active] as HTMLElement | undefined;
    const el = pile?.querySelector<HTMLElement>('.tr-card:not(.tr-behind):not(.tr-genie)') ?? null;
    const primary = zones[0];
    if (item === undefined || !el || !primary || this.#busy) return false;
    this.#busy = true;
    const predicted = this.prediction?.id ?? null;
    // the card lands in the primary zone; the others acknowledge without stealing the trip
    const to = { x: primary.pos.x - this.#centre.x, y: primary.pos.y - this.#centre.y };
    genie(el, to, fling !== undefined ? fling / 8 : to.x / 60);
    for (const z of zones) catchPulse(this.#tile(z));
    let done = false;
    try {
      await this.#dispatch('sort', item, zones);
      done = true;
      const at = this.items.indexOf(item);
      if (at >= 0) this.items.splice(at, 1);
      this.#lanes[this.#active] = undefined; // this pile draws a new card, the others do not
      this.#history.push({ item, zones });
      // one example per zone: a card filed in three places teaches three times
      for (const z of zones) {
        void this.#tell('record', { item, meta: this.#meta(item), zoneId: z.id, predicted, at: Date.now() });
      }
      this.#emit('sort', { item, zone: primary, zones, predicted, correct: zones.some((z) => z.id === predicted) });
    } catch (error) {
      el.classList.remove('tr-genie');
      el.style.transform = '';
      this.#emit('error', { item, zone: primary, error });
    } finally {
      this.#busy = false;
      this.#clearPicks();
      this.render(done ? 'sort' : undefined);
      this.#stage.focus({ preventScroll: true });
    }
    // the genie took over the card's transform either way: on failure the catch put it back
    return true;
  }

  skip(): void {
    const item = this.current;
    if (item === undefined || this.#busy) return;
    this.#clearPicks();
    const at = this.items.indexOf(item);
    if (at >= 0) this.items.splice(at, 1);
    this.items.push(item); // back of the pile, we will see it again
    this.#lanes[this.#active] = undefined;
    this.#emit('skip', { item });
    this.#opts.onSkip?.(item);
    this.render();
  }

  async undo(): Promise<void> {
    const last = this.#history.pop();
    if (!last || this.#busy) return;
    this.#busy = true;
    let done = false;
    try {
      await this.#dispatch('undo', last.item, last.zones);
      done = true;
      this.items.unshift(last.item);
      this.#lanes[this.#active] = last.item; // it comes back where it left from
      for (const z of last.zones) {
        void this.#tell('forget', { item: last.item, meta: this.#meta(last.item), zoneId: z.id, at: Date.now() });
        catchPulse(this.#tile(z)); // the tile spits the card back out
      }
      this.#emit('undo', { item: last.item, zone: last.zones[0]!, zones: last.zones });
    } catch (error) {
      this.#history.push(last); // the undo failed: keep the history intact
      this.#emit('error', { item: last.item, zone: last.zones[0]!, error });
    } finally {
      this.#busy = false;
      this.render(done ? 'undo' : undefined);
      this.#stage.focus({ preventScroll: true });
    }
  }

  /** Fake fullscreen: a modal, without the Fullscreen API — it would make the page inert
   *  and break the links inside cards. */
  expand(on = true): void {
    this.expanded = Boolean(on);
    this.root.classList.toggle('tr-full', this.expanded);
    document.documentElement.classList.toggle('tr-locked', this.expanded);
    this.root.querySelector('[data-tr="expand"]')?.setAttribute('aria-expanded', String(this.expanded));
    this.#emit('expand', { expanded: this.expanded });
    // the stage changed size, so the zones and their regions must follow
    requestAnimationFrame(() => {
      this.layout(true);
      this.#stage.focus({ preventScroll: true });
    });
  }

  focus(o?: FocusOptions): void {
    this.#stage.focus(o);
  }

  // --- plumbing --------------------------------------------------------------

  /**
   * One zone goes through `onSort`, several through `onSortMany`.
   *
   * ponytail: without `onSortMany`, several zones fall back to sequential `onSort` calls —
   * if the third fails, the first two already happened. Provide `onSortMany` when the filing
   * has to be atomic.
   */
  async #dispatch(hook: 'sort' | 'undo', item: T, zones: PlacedZone[]): Promise<void> {
    const one = hook === 'sort' ? this.#opts.onSort : this.#opts.onUndo;
    const many = hook === 'sort' ? this.#opts.onSortMany : this.#opts.onUndoMany;
    if (zones.length === 1) return void (await one?.(item, zones[0]!));
    if (many) return void (await many(item, zones));
    for (const z of zones) await one?.(item, z);
  }

  /** A failing model must not undo a filing the host has already accepted. */
  async #tell(hook: 'record' | 'forget', r: SortRecord<T>): Promise<void> {
    try {
      await this.#opts.advisor?.[hook]?.(r);
    } catch (error) {
      this.#emit('error', { error });
    }
  }

  #tile(zone: PlacedZone): Element | undefined {
    return [...this.#zonesEl.children].find((e) => Number((e as HTMLElement).dataset.index) === zone.index);
  }

  #label(sel: string, txt: string): void {
    (this.root.querySelector(sel) as HTMLElement).textContent = txt;
  }

  #button(name: string, txt: string, key?: string): void {
    const b = this.root.querySelector(`[data-tr="${name}"]`) as HTMLElement;
    b.textContent = txt;
    if (key) b.insertAdjacentHTML('beforeend', ` <kbd>${key}</kbd>`);
  }

  #emit<K extends keyof DeckEventMap<T>>(name: K, detail: DeckEventMap<T>[K]): void {
    this.root.dispatchEvent(new CustomEvent(`trieur:${name}`, { detail, bubbles: true }));
  }
}

export default Deck;
