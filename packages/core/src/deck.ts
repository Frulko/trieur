// The deck: a pile of cards, zones around it, one gesture per card.
//
// Domain-agnostic — the library knows nothing about what it sorts. The host draws the card
// (`renderCard`) and performs the filing (`onSort`). No dependencies.

import { catchPulse, enterBehind, enterTop, genie, type Enter } from './anim.js';
import { startGesture } from './drag.js';
import { angleGap, angleOf, resolveLayout } from './layouts.js';
import { en } from './text.js';
import { defaultTile } from './tile.js';
import type { DeckEventMap, DeckOptions, DeckText, PlacedZone, Point, Prediction, SortRecord, Zone } from './types.js';
import { inPolygon, pathOf, voronoi } from './voronoi.js';

// home-row keys first, in the order the eye travels around the circle
const DEFAULT_KEYS = 'asdfghjklqwertyuiopzxcvbnm';

/** How the multi-zone selection was started — it decides how it ends. */
type MultiSource = 'shift' | 'latch';

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
  #zonesEl: HTMLElement;
  #cardsEl: HTMLElement;
  #history: Array<{ item: T; zones: PlacedZone[] }> = [];
  #busy = false;
  /** zones stacked up for the current card, in the order they were picked */
  #picks: PlacedZone[] = [];
  #multi: MultiSource | null = null;
  /** suggestion token: a late answer must not apply to the next card */
  #ask = 0;
  #onResize: () => void;
  #onEsc: (e: KeyboardEvent) => void;

  constructor(root: HTMLElement, opts: DeckOptions<T> = {}) {
    this.root = root;
    this.#opts = { threshold: 90, ...opts };
    this.#text = { ...en, ...opts.text };
    this.items = [...(opts.items ?? [])];

    const t = this.#text;
    root.classList.add('tr');
    root.innerHTML = `
      <div class="tr-stage" tabindex="0" role="application" aria-roledescription="card sorter">
        <svg class="tr-segments" aria-hidden="true"></svg>
        <div class="tr-zones"></div>
        <div class="tr-cards"></div>
        <p class="tr-nothing" hidden></p>
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
      <button type="button" class="tr-close" data-tr="collapse" aria-label="${t.close}">✕</button>`;
    this.#stage = root.querySelector('.tr-stage')!;
    this.#segsEl = root.querySelector('.tr-segments')!;
    this.#zonesEl = root.querySelector('.tr-zones')!;
    this.#cardsEl = root.querySelector('.tr-cards')!;
    this.#label('.tr-nothing', t.empty);
    this.#button('skip', t.skip, t.space);
    this.#button('undo', t.undo, '⌫');
    this.#button('expand', t.expand);
    root.querySelector('[data-tr="collapse"]')!.setAttribute('title', t.close);

    this.#stage.addEventListener('keydown', (e) => this.#onKey(e));
    // Holding Shift is a transient mode: releasing it files the card into everything picked.
    this.#stage.addEventListener('keyup', (e) => {
      if (e.key !== 'Shift' || this.#multi !== 'shift') return;
      if (this.#picks.length) void this.commitMany();
      else this.#clearPicks();
    });
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
    this.#onResize = () => this.layout();
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
    this.render();
  }

  get current(): T | undefined {
    return this.items[0];
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
    this.layout();
    this.#paintPicks();
  }

  /** Places the zones and remembers each one's direction (used for aiming while dragging). */
  layout(): void {
    const els = [...this.#zonesEl.children] as HTMLElement[];
    if (!els.length) return;
    const card = this.#cardsEl.firstElementChild as HTMLElement | null;
    // zones must clear the card, or they end up underneath it (+ half a tile)
    const clear = Math.hypot((card?.offsetWidth ?? 260) / 2, (card?.offsetHeight ?? 300) / 2) + 60;
    const w = this.#stage.clientWidth;
    const h = this.#stage.clientHeight;
    const pts = resolveLayout(this.#opts.layout)(els.length, { w, h, clear });
    els.forEach((el, i) => {
      const p = pts[i] ?? { x: 0, y: 0 };
      const z = this.zones[i]!;
      z.angle = angleOf(p.x, p.y); // the actual visual direction
      z.pos = p; // where the genie animation lands
      el.style.left = `calc(50% + ${p.x}px)`;
      el.style.top = `calc(50% + ${p.y}px)`;
    });
    this.#paintSegments(pts, w, h);
  }

  /**
   * Draws the carving. It is not only a drawing: **the drop aims at the region under the
   * finger**, not at an approximate angle. What you see is what you touch.
   */
  #paintSegments(pts: Point[], w: number, h: number): void {
    if (this.#opts.segments === false || pts.length < 2) {
      this.#segsEl.replaceChildren();
      for (const z of this.zones) z.cell = null;
      return;
    }
    const abs = pts.map((p) => ({ x: w / 2 + p.x, y: h / 2 + p.y }));
    const cells = voronoi(abs, w, h);
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
    this.#paintPicks();
  }

  /** Zone under a point of the stage (screen coordinates). */
  zoneAt(clientX: number, clientY: number): PlacedZone | null {
    const r = this.#stage.getBoundingClientRect();
    const [x, y] = [clientX - r.left, clientY - r.top];
    return this.zones.find((z) => z.cell && inPolygon(z.cell, x, y)) ?? null;
  }

  render(enter?: Enter): void {
    const [top, next] = this.items;
    // A card in flight survives the next render, and above all we do not *touch* it:
    // reinserting it in the DOM cancels its transition and snaps it to the end state.
    for (const c of [...this.#cardsEl.children]) if (!c.classList.contains('tr-genie')) c.remove();
    (this.root.querySelector('.tr-nothing') as HTMLElement).hidden = top !== undefined;
    if (next !== undefined) {
      const el = this.#buildCard(next, true);
      this.#cardsEl.append(el);
      if (enter) enterBehind(el);
    }
    if (top !== undefined) {
      const el = this.#buildCard(top, false);
      this.#cardsEl.append(el);
      if (enter) enterTop(el, enter);
    }
    this.layout(); // the card's size depends on its content
    this.#label('.tr-count', this.items.length ? this.#text.count(this.items.length) : '');
    (this.root.querySelector('[data-tr="undo"]') as HTMLButtonElement).disabled = !this.#history.length;
    (this.root.querySelector('[data-tr="multi"]') as HTMLButtonElement).hidden = !this.#opts.multi;
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

  #buildCard(item: T, behind: boolean): HTMLElement {
    const el = document.createElement('article');
    el.className = 'tr-card' + (behind ? ' tr-behind' : '');
    this.#opts.renderCard?.(item, el);
    // without this the browser starts its own image drag and steals the gesture
    for (const img of el.querySelectorAll('img')) img.draggable = false;
    if (!behind) el.addEventListener('pointerdown', (e) => this.#startDrag(e, el));
    return el;
  }

  // --- multi-zone selection --------------------------------------------------

  #setMulti(source: MultiSource | null): void {
    this.#multi = source;
    this.root.classList.toggle('tr-multi', source !== null);
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

  #clearPicks(): void {
    this.#picks = [];
    this.#setMulti(null);
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

  // --- gesture ---------------------------------------------------------------

  #startDrag(e: PointerEvent, el: HTMLElement): void {
    if (this.#busy) return;
    const threshold = this.#opts.threshold!;
    startGesture(el, e, {
      onMove: (g, ev) => {
        // the closer to a zone, the smaller the card: it "enters" the zone before release
        const k = Math.min(g.dist / (threshold * 2), 1);
        el.style.transform = `translate(${g.dx}px, ${g.dy}px) rotate(${g.dx / 22}deg) scale(${(1 - 0.42 * k).toFixed(3)})`;
        const near = g.dist > 30 ? this.#aim(g.dx, g.dy, ev) : null;
        this.#highlight(near, g.dist > threshold);
      },
      onEnd: (g, ev) => {
        const zone = g.dist > threshold ? this.#aim(g.dx, g.dy, ev) : null;
        this.#highlight(null, false);
        if (zone) void this.commit(zone, g.dx);
        // in multi mode the card is only being pointed at zones, so it comes back to centre
        if (!zone || this.#multi) el.style.transform = '';
      },
    });
  }

  /** Zone being aimed at: the region under the finger; failing a carving, the drag direction. */
  #aim(dx: number, dy: number, ev: PointerEvent): PlacedZone | null {
    const byRegion = this.zoneAt(ev.clientX, ev.clientY);
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
    if (this.#busy || e.metaKey || e.ctrlKey || e.altKey) return;
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

  // --- actions ---------------------------------------------------------------

  /**
   * Files the top card into `zone`. In multi-zone mode, stacks it instead — the filing
   * happens on confirmation.
   */
  async commit(zone: PlacedZone, fling?: number): Promise<void> {
    if (this.#multi && !zone.empty) return this.#togglePick(zone);
    // free zone: the host decides what goes there, the card does not move
    if (zone.empty) {
      const item = this.current;
      if (item === undefined) return;
      this.#emit('assign', { index: zone.index, item });
      this.#opts.onAssign?.(zone.index, item);
      return;
    }
    return this.#run([zone], fling);
  }

  /** Files the top card into every stacked zone at once. */
  async commitMany(zones: PlacedZone[] = this.picking): Promise<void> {
    if (!zones.length) return;
    return this.#run(zones);
  }

  async #run(zones: PlacedZone[], fling?: number): Promise<void> {
    const item = this.current;
    const el = this.#cardsEl.lastElementChild as HTMLElement | null;
    const primary = zones[0];
    if (item === undefined || !el || !primary || this.#busy) return;
    this.#busy = true;
    const predicted = this.prediction?.id ?? null;
    // the card lands in the primary zone; the others acknowledge without stealing the trip
    genie(el, primary.pos, fling !== undefined ? fling / 8 : primary.pos.x / 60);
    for (const z of zones) catchPulse(this.#tile(z));
    let done = false;
    try {
      await this.#dispatch('sort', item, zones);
      done = true;
      this.items.shift();
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
  }

  skip(): void {
    const item = this.current;
    if (item === undefined || this.#busy) return;
    this.#clearPicks();
    this.items.push(this.items.shift()!); // back of the pile, we will see it again
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
      this.layout();
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
