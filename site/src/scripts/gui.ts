// A small dat.GUI-shaped settings panel for the demos.
//
// It lives in the site, not in the library: a sorting deck has no business shipping a control
// panel. But a demo you cannot poke at only shows the defaults, and half the questions about
// this library are "what does `threshold` actually feel like".
//
// The trigger sits in the deck's own bar, beside Skip and Undo, because that is where the
// controls for a deck belong. The panel is a dropdown that picks its side from the room it
// has, rather than a slab floating over the page.

import { dockLayout, radialLayout, type Deck } from '@trieur/core';

export type Control =
  | { key: string; label: string; type: 'select'; value: string; options: Array<[string, string]> }
  | { key: string; label: string; type: 'range'; value: number; min: number; max: number; step?: number; unit?: string }
  | { key: string; label: string; type: 'toggle'; value: boolean }
  | { key: string; label: string; type: 'color'; value: string };

export interface Gui {
  el: HTMLElement;
  trigger: HTMLButtonElement;
  values: Record<string, string | number | boolean>;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Adds a button to a deck's action bar, styled by the library's own stylesheet. */
export function barButton(deck: Deck, label: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = label;
  btn.className = 'tr-host-btn';
  deck.root.querySelector('.tr-actions')?.prepend(btn);
  return btn;
}

export function createGui(
  controls: Control[],
  onChange: (values: Gui['values'], key: string) => void,
  trigger: HTMLButtonElement,
): Gui {
  const values: Gui['values'] = Object.fromEntries(controls.map((c) => [c.key, c.value]));

  const el = document.createElement('aside');
  el.className = 'gui';
  el.dataset.open = 'false';
  el.innerHTML = `<div class="gui-body">
      ${controls
        .map((c) => {
          const id = `gui-${c.key}`;
          const field =
            c.type === 'select'
              ? `<select id="${id}" data-key="${c.key}">${c.options
                  .map(([v, label]) => `<option value="${esc(v)}"${v === c.value ? ' selected' : ''}>${esc(label)}</option>`)
                  .join('')}</select>`
              : c.type === 'toggle'
                ? `<input id="${id}" data-key="${c.key}" type="checkbox"${c.value ? ' checked' : ''} />`
                : c.type === 'color'
                  ? `<input id="${id}" data-key="${c.key}" type="color" value="${esc(c.value)}" />`
                  : `<input id="${id}" data-key="${c.key}" type="range" min="${c.min}" max="${c.max}" step="${c.step ?? 1}" value="${c.value}" />
                     <output for="${id}">${c.value}${c.unit ?? ''}</output>`;
          return `<label class="gui-row" for="${id}"><span>${esc(c.label)}</span>${field}</label>`;
        })
        .join('')}
    </div>`;
  document.body.append(el);

  /** Below the trigger if there is room, above it otherwise — whichever the scroll allows. */
  const place = () => {
    const r = trigger.getBoundingClientRect();
    const height = el.offsetHeight;
    const below = window.innerHeight - r.bottom - 12;
    const up = below < height && r.top > below;
    el.classList.toggle('gui-up', up);
    el.style.top = up ? `${Math.max(8, r.top - height - 8)}px` : `${r.bottom + 8}px`;
    // on a phone it spans the screen instead of hanging off a 40px-wide button
    if (window.innerWidth < 560) {
      el.style.left = '8px';
      el.style.width = `${window.innerWidth - 16}px`;
      return;
    }
    el.style.width = '';
    el.style.left = `${Math.max(8, Math.min(r.right - el.offsetWidth, window.innerWidth - el.offsetWidth - 8))}px`;
  };

  const setOpen = (open: boolean) => {
    el.dataset.open = String(open);
    trigger.setAttribute('aria-expanded', String(open));
    trigger.classList.toggle('tr-on', open);
    if (open) place();
  };

  trigger.setAttribute('aria-expanded', 'false');
  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    setOpen(el.dataset.open !== 'true');
  });
  // a dropdown follows what it is anchored to, and closes when you look elsewhere
  for (const ev of ['scroll', 'resize']) addEventListener(ev, () => el.dataset.open === 'true' && place(), true);
  addEventListener('click', (e) => {
    if (el.dataset.open === 'true' && !el.contains(e.target as Node)) setOpen(false);
  });
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && el.dataset.open === 'true') setOpen(false);
  });

  el.addEventListener('input', (e) => {
    const input = (e.target as HTMLElement).closest<HTMLInputElement | HTMLSelectElement>('[data-key]');
    if (!input) return;
    const key = input.dataset.key!;
    const value =
      input instanceof HTMLInputElement && input.type === 'checkbox'
        ? input.checked
        : input instanceof HTMLInputElement && input.type === 'range'
          ? Number(input.value)
          : input.value;
    values[key] = value;
    const out = el.querySelector<HTMLOutputElement>(`output[for="gui-${key}"]`);
    if (out) out.textContent = `${value}${(controls.find((c) => c.key === key) as { unit?: string })?.unit ?? ''}`;
    onChange(values, key);
  });

  return { el, trigger, values };
}

export interface DeckGuiOptions {
  /** add the radial arc controls — only worth showing where the layout can be radial */
  radial?: boolean;
  /** add the throw controls: the experimental flick mode, and its debug vector */
  flick?: boolean;
}

/**
 * The standard panel for a deck demo: every option that changes how the thing feels, plus the
 * two CSS variables that change how it looks.
 */
export function deckGui(deck: Deck, opts: DeckGuiOptions = {}): Gui {
  const root = deck.root;
  const o = deck.options;

  const controls: Control[] = [
    {
      key: 'layout',
      label: 'layout',
      type: 'select',
      value: typeof o.layout === 'string' ? o.layout : 'auto',
      options: [
        ['auto', 'auto'],
        ['circle', 'circle'],
        ['radial', 'radial'],
        ['voronoi', 'mosaic'],
        ['grid', 'grid'],
        ['dock', 'dock'],
        ['dock-split', 'dock · split'],
      ],
    },
    ...(opts.radial
      ? ([
          { key: 'sweep', label: 'radial sweep', type: 'range', value: 360, min: 60, max: 360, step: 15, unit: '°' },
          { key: 'start', label: 'radial start', type: 'range', value: -90, min: -180, max: 180, step: 15, unit: '°' },
          { key: 'ringGap', label: 'ring gap', type: 'range', value: 3, min: 0, max: 24, step: 1, unit: 'px' },
        ] as Control[])
      : []),
    ...(opts.flick
      ? ([
          { key: 'flick', label: 'throw', type: 'toggle', value: Boolean(o.flick) },
          { key: 'flickMs', label: 'throw reach', type: 'range', value: o.flickMs ?? 170, min: 0, max: 500, step: 10, unit: 'ms' },
          { key: 'flickMin', label: 'throw floor', type: 'range', value: o.flickMin ?? 0.25, min: 0.05, max: 1.5, step: 0.05 },
          { key: 'flickBias', label: 'model pull', type: 'range', value: o.flickBias ?? 0.5, min: 0, max: 1.5, step: 0.05 },
          { key: 'flickDebug', label: 'show vector', type: 'toggle', value: o.flickDebug !== false },
        ] as Control[])
      : []),
    { key: 'segments', label: 'regions', type: 'toggle', value: o.segments !== false },
    { key: 'zonePull', label: 'gather', type: 'range', value: o.zonePull ?? 0.18, min: 0, max: 0.6, step: 0.02 },
    { key: 'zonePadding', label: 'edge margin', type: 'range', value: o.zonePadding ?? 12, min: 0, max: 60, step: 2, unit: 'px' },
    { key: 'multi', label: 'multi-zone', type: 'toggle', value: Boolean(o.multi) },
    {
      key: 'multiPad',
      label: 'hold pad',
      type: 'select',
      value: String(o.multiPad ?? 'auto'),
      options: [
        ['auto', 'auto (touch)'],
        ['dynamic', 'dynamic'],
        ['right', 'right'],
        ['left', 'left'],
        ['off', 'off'],
      ],
    },
    { key: 'holdDelay', label: 'hold delay', type: 'range', value: o.holdDelay ?? 420, min: 0, max: 1000, step: 20, unit: 'ms' },
    { key: 'threshold', label: 'drop threshold', type: 'range', value: o.threshold ?? 90, min: 30, max: 200, step: 5, unit: 'px' },
    { key: 'deadZone', label: 'dead zone', type: 'range', value: o.deadZone ?? 0, min: -60, max: 120, step: 5, unit: 'px' },
    { key: 'minConfidence', label: 'min confidence', type: 'range', value: o.minConfidence ?? 0.45, min: 0, max: 1, step: 0.05 },
    { key: 'cardWidth', label: 'card width', type: 'range', value: 260, min: 190, max: 380, step: 10, unit: 'px' },
    { key: 'accent', label: 'accent', type: 'color', value: '#4a54f2' },
    { key: 'multiColor', label: 'multi colour', type: 'color', value: '#f59e0b' },
  ];

  return createGui(
    controls,
    (v) => {
      const name = String(v.layout);
      const layout =
        name === 'dock-split'
          ? dockLayout({ split: true })
          : name === 'radial' && opts.radial
            ? radialLayout({
                sweep: (Number(v.sweep) * Math.PI) / 180,
                start: (Number(v.start) * Math.PI) / 180,
                ringGap: Number(v.ringGap),
              })
            : (name as 'circle');
      deck.setOptions({
        layout,
        ...(opts.flick
          ? {
              flick: Boolean(v.flick),
              flickMs: Number(v.flickMs),
              flickMin: Number(v.flickMin),
              flickBias: Number(v.flickBias),
              flickDebug: Boolean(v.flickDebug),
            }
          : {}),
        segments: Boolean(v.segments),
        zonePull: Number(v.zonePull),
        zonePadding: Number(v.zonePadding),
        multi: Boolean(v.multi),
        multiPad: v.multiPad === 'off' ? false : (v.multiPad as 'auto'),
        holdDelay: Number(v.holdDelay),
        threshold: Number(v.threshold),
        deadZone: Number(v.deadZone),
        minConfidence: Number(v.minConfidence),
      });
      root.style.setProperty('--tr-card-w', `${v.cardWidth}px`);
      root.style.setProperty('--tr-accent', String(v.accent));
      root.style.setProperty('--tr-multi', String(v.multiColor));
    },
    barButton(deck, 'Settings'),
  );
}
