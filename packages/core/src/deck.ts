// Le deck : une pile de cartes, des zones, un geste.
//
// Agnostique du domaine — la lib ne sait rien de ce qu'elle trie. L'appelant dessine la
// carte (`renderCard`) et exécute le rangement (`onSort`). Zéro dépendance.

import { catchPulse, enterBehind, enterTop, genie, type Enter } from './anim.js';
import { startGesture } from './drag.js';
import { angleGap, angleOf, resolveLayout } from './layouts.js';
import { fr } from './text.js';
import { defaultTile } from './tile.js';
import type { DeckEventMap, DeckOptions, DeckText, PlacedZone, Point, Prediction, SortRecord, Zone } from './types.js';
import { inPolygon, pathOf, voronoi } from './voronoi.js';

// touches de la rangée de repos d'abord, dans l'ordre où l'œil parcourt le cercle
const DEFAULT_KEYS = 'asdfghjklqwertyuiopzxcvbnm';

export class Deck<T = any> {
  readonly root: HTMLElement;
  items: T[];
  zones: PlacedZone[] = [];
  /** ce que le modèle propose pour la carte du dessus, ou null */
  prediction: Prediction | null = null;
  expanded = false;

  #opts: DeckOptions<T>;
  #text: DeckText;
  #stage: HTMLElement;
  #segsEl: SVGSVGElement;
  #zonesEl: HTMLElement;
  #cardsEl: HTMLElement;
  #history: Array<{ item: T; zone: PlacedZone }> = [];
  #busy = false;
  /** jeton de proposition : une réponse tardive ne s'applique pas à la carte suivante */
  #ask = 0;
  #onResize: () => void;
  #onEsc: (e: KeyboardEvent) => void;

  constructor(root: HTMLElement, opts: DeckOptions<T> = {}) {
    this.root = root;
    this.#opts = { threshold: 90, ...opts };
    this.#text = { ...fr, ...opts.text };
    this.items = [...(opts.items ?? [])];

    const t = this.#text;
    root.classList.add('tr');
    root.innerHTML = `
      <div class="tr-stage" tabindex="0" role="application" aria-roledescription="tri de cartes">
        <svg class="tr-segments" aria-hidden="true"></svg>
        <div class="tr-zones"></div>
        <div class="tr-cards"></div>
        <p class="tr-nothing" hidden></p>
      </div>
      <div class="tr-bar">
        <span class="tr-count" aria-live="polite"></span>
        <span class="tr-actions">
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
    this.#button('skip', t.skip, 'espace');
    this.#button('undo', t.undo, '⌫');
    this.#button('expand', t.expand);
    root.querySelector('[data-tr="collapse"]')!.setAttribute('title', t.close);

    this.#stage.addEventListener('keydown', (e) => this.#onKey(e));
    root.addEventListener('click', (e) => {
      const b = (e.target as Element).closest<HTMLElement>('[data-tr]');
      switch (b?.dataset.tr) {
        case 'skip':
          return this.skip();
        case 'undo':
          return void this.undo();
        case 'expand':
          return this.expand(!this.expanded);
        case 'collapse':
          return this.expand(false);
      }
    });
    // Échap ferme le plein écran depuis n'importe où : le focus peut être sur une carte
    this.#onEsc = (e) => {
      if (e.key === 'Escape' && this.expanded) {
        e.preventDefault();
        this.expand(false);
      }
    };
    document.addEventListener('keydown', this.#onEsc);
    // le resize déplace les zones, donc les régions de dépôt
    this.#onResize = () => this.layout();
    window.addEventListener('resize', this.#onResize);

    this.setZones(opts.zones ?? []);
    this.render();
  }

  destroy(): void {
    window.removeEventListener('resize', this.#onResize);
    document.removeEventListener('keydown', this.#onEsc);
    document.documentElement.classList.remove('tr-locked');
    this.root.classList.remove('tr', 'tr-full');
    this.root.innerHTML = '';
  }

  // --- données ---------------------------------------------------------------

  setItems(items: T[]): void {
    this.items = [...items];
    this.render();
  }

  /**
   * Définit les zones. Une zone est un emplacement fixe, avec sa touche ; ce qu'on y range
   * peut changer sans que la touche bouge — c'est ce qui rend le geste mémorisable.
   * `null` = zone libre : y déposer une carte déclenche `onAssign(index)` au lieu de `onSort`.
   */
  setZones(zones: Array<Zone | null>): void {
    const keys = this.#opts.keys ?? DEFAULT_KEYS;
    this.zones = zones.map((z, i) => ({
      ...(z ?? {}),
      id: z?.id ?? '',
      index: i,
      empty: !z?.id,
      // touche par position, pas par libellé : elle survit au changement de contenu
      key: (z?.key ?? keys[i] ?? '').toLowerCase(),
      angle: 0,
      pos: { x: 0, y: 0 },
      cell: null,
    }));
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

  // --- rendu -----------------------------------------------------------------

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
  }

  /** Place les zones et mémorise la direction de chacune (elle sert à viser au glisser). */
  layout(): void {
    const els = [...this.#zonesEl.children] as HTMLElement[];
    if (!els.length) return;
    const card = this.#cardsEl.firstElementChild as HTMLElement | null;
    // les zones doivent dégager la carte, sinon elles passent dessous (+ la demi-tuile)
    const clear = Math.hypot((card?.offsetWidth ?? 260) / 2, (card?.offsetHeight ?? 300) / 2) + 60;
    const w = this.#stage.clientWidth;
    const h = this.#stage.clientHeight;
    const pts = resolveLayout(this.#opts.layout)(els.length, { w, h, clear });
    els.forEach((el, i) => {
      const p = pts[i] ?? { x: 0, y: 0 };
      const z = this.zones[i]!;
      z.angle = angleOf(p.x, p.y); // direction visuelle réelle
      z.pos = p; // point d'arrivée de l'animation « génie »
      el.style.left = `calc(50% + ${p.x}px)`;
      el.style.top = `calc(50% + ${p.y}px)`;
    });
    this.#paintSegments(pts, w, h);
  }

  /**
   * Dessine le découpage de la scène. Ce n'est pas qu'un dessin : **le dépôt vise la région
   * sous le doigt**, pas un angle approximatif. Ce qu'on voit est ce qu'on touche.
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
  }

  /** Zone sous un point de la scène (coordonnées écran). */
  zoneAt(clientX: number, clientY: number): PlacedZone | null {
    const r = this.#stage.getBoundingClientRect();
    const [x, y] = [clientX - r.left, clientY - r.top];
    return this.zones.find((z) => z.cell && inPolygon(z.cell, x, y)) ?? null;
  }

  render(enter?: Enter): void {
    const [top, next] = this.items;
    // Une carte en vol survit au rendu suivant, et surtout on ne la *touche pas* : la
    // réinsérer dans le DOM annule sa transition et la fait sauter à l'arrivée.
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
    this.layout(); // la taille de la carte dépend de son contenu
    this.#label('.tr-count', this.items.length ? this.#text.count(this.items.length) : '');
    (this.root.querySelector('[data-tr="undo"]') as HTMLButtonElement).disabled = !this.#history.length;
    void this.suggest();
    if (top === undefined) {
      this.#emit('empty', {});
      this.#opts.onEmpty?.();
    }
  }

  /**
   * Marque la zone que le modèle propose pour la carte du dessus.
   *
   * `best()` peut répondre de façon asynchrone (un serveur, par exemple) : on jette la
   * réponse si la carte a changé entre-temps. La prédiction ne bloque jamais le geste —
   * la carte est déjà sous le doigt.
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
    if (ask !== this.#ask || !top) return; // la carte a changé pendant l'attente
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
    // sans ça le navigateur démarre son propre glisser d'image et vole le geste
    for (const img of el.querySelectorAll('img')) img.draggable = false;
    if (!behind) el.addEventListener('pointerdown', (e) => this.#startDrag(e, el));
    return el;
  }

  // --- geste -----------------------------------------------------------------

  #startDrag(e: PointerEvent, el: HTMLElement): void {
    if (this.#busy) return;
    const threshold = this.#opts.threshold!;
    startGesture(el, e, {
      onMove: (g, ev) => {
        // plus on s'approche d'une zone, plus la carte rétrécit : elle « rentre » dedans
        const k = Math.min(g.dist / (threshold * 2), 1);
        el.style.transform = `translate(${g.dx}px, ${g.dy}px) rotate(${g.dx / 22}deg) scale(${(1 - 0.42 * k).toFixed(3)})`;
        const near = g.dist > 30 ? this.#aim(g.dx, g.dy, ev) : null;
        this.#highlight(near, g.dist > threshold);
      },
      onEnd: (g, ev) => {
        const zone = g.dist > threshold ? this.#aim(g.dx, g.dy, ev) : null;
        this.#highlight(null, false);
        if (zone) void this.commit(zone, g.dx);
        else el.style.transform = ''; // rien de visé : la carte revient en place
      },
    });
  }

  /** Zone visée : la région sous le doigt ; à défaut de découpage, la direction du glisser. */
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

  // --- clavier ---------------------------------------------------------------

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
    // ↵ accepte la proposition du modèle : le geste le plus courant devient le plus court
    if (e.key === 'Enter' && this.prediction) {
      const z = this.zones.find((x) => x.id === this.prediction!.id);
      if (z) {
        e.preventDefault();
        return void this.commit(z);
      }
    }
    const z = this.zones.find((x) => x.key && x.key === e.key.toLowerCase());
    if (z) {
      e.preventDefault();
      void this.commit(z);
    }
  }

  // --- actions ---------------------------------------------------------------

  /** Range la carte du dessus dans `zone`. Si `onSort` échoue, la carte revient. */
  async commit(zone: PlacedZone, fling?: number): Promise<void> {
    const item = this.current;
    const el = this.#cardsEl.lastElementChild as HTMLElement | null;
    if (item === undefined || !el || this.#busy) return;
    // zone libre : c'est à l'hôte de décider ce qu'on y met, la carte ne bouge pas
    if (zone.empty) {
      this.#emit('assign', { index: zone.index, item });
      this.#opts.onAssign?.(zone.index, item);
      return;
    }
    this.#busy = true;
    const predicted = this.prediction?.id ?? null;
    genie(el, zone.pos, fling !== undefined ? fling / 8 : zone.pos.x / 60);
    catchPulse(this.#tile(zone));
    let done = false;
    try {
      await this.#opts.onSort?.(item, zone);
      done = true;
      this.items.shift();
      this.#history.push({ item, zone });
      // le modèle apprend du geste réel, y compris quand il s'était trompé
      void this.#tell('record', { item, meta: this.#meta(item), zoneId: zone.id, predicted, at: Date.now() });
      this.#emit('sort', { item, zone, predicted, correct: predicted === zone.id });
    } catch (error) {
      el.classList.remove('tr-genie');
      el.style.transform = '';
      this.#emit('error', { item, zone, error });
    } finally {
      this.#busy = false;
      this.render(done ? 'sort' : undefined);
      this.#stage.focus({ preventScroll: true });
    }
  }

  skip(): void {
    const item = this.current;
    if (item === undefined || this.#busy) return;
    this.items.push(this.items.shift()!); // en fin de pile, on la reverra
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
      await this.#opts.onUndo?.(last.item, last.zone);
      done = true;
      this.items.unshift(last.item);
      void this.#tell('forget', {
        item: last.item,
        meta: this.#meta(last.item),
        zoneId: last.zone.id,
        at: Date.now(),
      });
      catchPulse(this.#tile(last.zone)); // la tuile « recrache » la carte
      this.#emit('undo', last);
    } catch (error) {
      this.#history.push(last); // l'annulation a échoué : on garde l'historique intact
      this.#emit('error', { ...last, error });
    } finally {
      this.#busy = false;
      this.render(done ? 'undo' : undefined);
      this.#stage.focus({ preventScroll: true });
    }
  }

  /** Plein écran « faux » : une modale, sans l'API Fullscreen — elle rendrait la page
   *  inerte et casserait les liens des cartes. */
  expand(on = true): void {
    this.expanded = Boolean(on);
    this.root.classList.toggle('tr-full', this.expanded);
    document.documentElement.classList.toggle('tr-locked', this.expanded);
    this.root.querySelector('[data-tr="expand"]')?.setAttribute('aria-expanded', String(this.expanded));
    this.#emit('expand', { expanded: this.expanded });
    // la scène a changé de taille : les zones et leurs régions doivent suivre
    requestAnimationFrame(() => {
      this.layout();
      this.#stage.focus({ preventScroll: true });
    });
  }

  focus(o?: FocusOptions): void {
    this.#stage.focus(o);
  }

  // --- plomberie -------------------------------------------------------------

  /** Un modèle qui échoue ne doit pas défaire un rangement déjà accepté par l'hôte. */
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
