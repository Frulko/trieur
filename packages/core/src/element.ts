// <trieur-deck> et <trieur-zone> — l'API déclarative.
//
// Light DOM assumé : l'hôte dessine les cartes et doit pouvoir les styler depuis sa propre
// feuille. Un shadow root encapsulerait le CSS de la lib mais couperait `renderCard` du
// reste de la page, ce qui coûte plus qu'il ne rapporte ici.
//
// Deux façons de s'en servir, mélangeables :
//   1. en JS      → deck.options = { items, zones, renderCard, onSort }
//   2. en markup  → <trieur-deck><trieur-zone value="dev">Dev</trieur-zone>…</trieur-deck>
// Une propriété posée en JS l'emporte toujours sur le markup : c'est le cas d'un hôte qui
// construit ses zones à partir de données.

import { Deck } from './deck.js';
import type { DeckOptions, Prediction, Zone } from './types.js';

/** Une zone déclarée en markup. N'affiche rien : c'est de la configuration. */
export class TrieurZoneElement extends HTMLElement {
  static observedAttributes = ['value', 'key', 'label', 'color', 'icon', 'image'];

  attributeChangedCallback(): void {
    this.#deck()?.zonesChanged();
  }
  connectedCallback(): void {
    this.hidden = true; // au cas où la feuille de la lib ne serait pas chargée
    this.#deck()?.zonesChanged();
  }
  disconnectedCallback(): void {
    this.parentElement?.closest<TrieurDeckElement>('trieur-deck')?.zonesChanged();
  }

  #deck(): TrieurDeckElement | null {
    return this.closest('trieur-deck');
  }

  /** Objet zone passé au deck. `value` absent = zone libre (déclenche `onAssign`). */
  get zone(): Zone | null {
    const id = this.getAttribute('value') ?? '';
    if (!id) return null;
    const attr = (n: string) => this.getAttribute(n) ?? undefined;
    return {
      id,
      // ?? et || ne se mélangent pas sans parenthèses
      label: attr('label') ?? (this.textContent?.trim() || id),
      key: attr('key'),
      color: attr('color'),
      icon: attr('icon'),
      image: attr('image'),
    };
  }
}

export class TrieurDeckElement extends HTMLElement {
  static observedAttributes = ['layout', 'threshold', 'keys', 'min-confidence', 'segments', 'lang'];

  #deck: Deck | null = null;
  #opts: DeckOptions = {};
  #host: HTMLElement | null = null;
  #obs: MutationObserver | null = null;
  #queued = false;
  /** une pile posée par l'hôte remplace celle en cours, elle ne fusionne pas */
  #freshPile = false;

  connectedCallback(): void {
    // les <trieur-zone> peuvent arriver après nous (frameworks, innerHTML) : on observe
    this.#obs = new MutationObserver(() => this.zonesChanged());
    this.#obs.observe(this, { childList: true });
    this.#schedule();
  }

  disconnectedCallback(): void {
    this.#obs?.disconnect();
    this.#deck?.destroy();
    this.#deck = null;
    this.#host = null;
  }

  attributeChangedCallback(): void {
    this.#schedule();
  }

  /**
   * Appelé par les <trieur-zone> quand elles apparaissent, changent ou disparaissent.
   * On met à jour les zones **sans remonter** : la pile en cours et l'historique
   * d'annulation survivent.
   */
  zonesChanged(): void {
    const zones = this.#zonesFromMarkup();
    if (this.#deck && zones) return this.#deck.setZones(zones);
    this.#schedule();
  }

  /** Configuration complète (mêmes clés que `new Deck(el, opts)`). Remonte la pile. */
  set options(o: DeckOptions) {
    this.#opts = { ...o };
    this.#freshPile = 'items' in o;
    this.#schedule();
  }
  get options(): DeckOptions {
    return this.#opts;
  }

  set items(v: unknown[]) {
    this.#opts.items = v;
    this.#deck ? this.#deck.setItems(v) : this.#schedule();
  }
  get items(): unknown[] {
    return this.#deck?.items ?? this.#opts.items ?? [];
  }

  set zones(v: Array<Zone | null>) {
    this.#opts.zones = v;
    this.#deck ? this.#deck.setZones(v) : this.#schedule();
  }
  get zones(): Array<Zone | null> {
    return this.#deck?.zones ?? this.#opts.zones ?? [];
  }

  get deck(): Deck | null {
    return this.#deck;
  }
  get current(): unknown {
    return this.#deck?.current;
  }
  get prediction(): Prediction | null {
    return this.#deck?.prediction ?? null;
  }

  skip(): void {
    this.#deck?.skip();
  }
  undo(): Promise<void> | undefined {
    return this.#deck?.undo();
  }
  override focus(o?: FocusOptions): void {
    this.#deck?.focus(o);
  }

  // --- interne ---------------------------------------------------------------

  /** Un seul remontage par tick : trois <trieur-zone> ajoutées d'affilée ne le font pas trois fois. */
  #schedule(): void {
    if (this.#queued || !this.isConnected) return;
    this.#queued = true;
    queueMicrotask(() => {
      this.#queued = false;
      if (this.isConnected) this.#mount();
    });
  }

  #zonesFromMarkup(): Array<Zone | null> | null {
    const zones = [...this.children].filter((el): el is TrieurZoneElement => el.tagName === 'TRIEUR-ZONE');
    return zones.length ? zones.map((el) => el.zone) : null;
  }

  /** Gabarit de carte déclaré en markup : <template data-card> avec des [data-field]. */
  #renderFromTemplate(tpl: HTMLTemplateElement) {
    return (item: any, el: HTMLElement) => {
      el.append(tpl.content.cloneNode(true));
      for (const node of el.querySelectorAll<HTMLElement>('[data-field]')) {
        const v = item?.[node.dataset.field!];
        if (v == null) node.remove();
        else if (node.dataset.attr) node.setAttribute(node.dataset.attr, String(v));
        else node.textContent = String(v);
      }
    };
  }

  #mount(): void {
    // la scène vit dans un enfant à nous : Deck réécrit son conteneur, et on ne veut pas
    // qu'il efface les <trieur-zone> et le <template> qui sont notre configuration
    if (!this.#host || !this.#host.isConnected) {
      this.#host = document.createElement('div');
      this.#host.className = 'tr-host';
      this.append(this.#host);
    }
    const num = (n: string) => (this.hasAttribute(n) ? Number(this.getAttribute(n)) : undefined);
    const tpl = this.querySelector<HTMLTemplateElement>(':scope > template[data-card]');
    const opts: DeckOptions = {
      layout: (this.getAttribute('layout') as DeckOptions['layout']) ?? undefined,
      keys: this.getAttribute('keys') ?? undefined,
      threshold: num('threshold'),
      minConfidence: num('min-confidence'),
      segments: this.getAttribute('segments') === 'false' ? false : undefined,
      zones: this.#zonesFromMarkup() ?? undefined,
      renderCard: tpl ? this.#renderFromTemplate(tpl) : undefined,
      // le JS l'emporte sur le markup : un hôte piloté par les données garde la main
      ...Object.fromEntries(Object.entries(this.#opts).filter(([, v]) => v !== undefined)),
    };
    for (const k of Object.keys(opts) as Array<keyof DeckOptions>) if (opts[k] === undefined) delete opts[k];
    // remonter en cours de tri ne doit pas faire réapparaître les cartes déjà rangées
    const left = this.#deck?.items;
    if (left?.length && !this.#freshPile) opts.items = left;
    this.#freshPile = false;
    this.#deck?.destroy();
    this.#deck = new Deck(this.#host, opts);
  }
}

if (!customElements.get('trieur-zone')) customElements.define('trieur-zone', TrieurZoneElement);
if (!customElements.get('trieur-deck')) customElements.define('trieur-deck', TrieurDeckElement);

declare global {
  interface HTMLElementTagNameMap {
    'trieur-deck': TrieurDeckElement;
    'trieur-zone': TrieurZoneElement;
  }
}

export default TrieurDeckElement;
