// A small dat.GUI-shaped settings panel for the demos.
//
// It lives in the site, not in the library: a sorting deck has no business shipping a
// control panel. But a demo you cannot poke at only shows the defaults, and half the
// questions about this library are "what does `threshold` actually feel like".

import type { Deck } from '@trieur/core';

export type Control =
  | { key: string; label: string; type: 'select'; value: string; options: Array<[string, string]> }
  | { key: string; label: string; type: 'range'; value: number; min: number; max: number; step?: number; unit?: string }
  | { key: string; label: string; type: 'toggle'; value: boolean }
  | { key: string; label: string; type: 'color'; value: string };

export interface Gui {
  el: HTMLElement;
  values: Record<string, string | number | boolean>;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function createGui(controls: Control[], onChange: (values: Gui['values'], key: string) => void): Gui {
  const values: Gui['values'] = Object.fromEntries(controls.map((c) => [c.key, c.value]));

  const el = document.createElement('aside');
  el.className = 'gui';
  // collapsed where the panel would cover the thing it configures
  el.dataset.open = String(window.innerWidth > 900);
  el.innerHTML = `
    <button type="button" class="gui-head" aria-expanded="${el.dataset.open}">
      <span>settings</span><b>${el.dataset.open === 'true' ? '–' : '+'}</b>
    </button>
    <div class="gui-body">
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

  el.querySelector('.gui-head')!.addEventListener('click', () => {
    const open = el.dataset.open !== 'true';
    el.dataset.open = String(open);
    el.querySelector('.gui-head b')!.textContent = open ? '–' : '+';
    el.querySelector('.gui-head')!.setAttribute('aria-expanded', String(open));
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

  document.body.append(el);
  return { el, values };
}

/**
 * The standard panel for a deck demo: every option that changes how the thing feels, plus the
 * two CSS variables that change how it looks.
 */
export function deckGui(deck: Deck): Gui {
  const opts = deck.options;
  const root = deck.root;

  return createGui(
    [
      {
        key: 'layout',
        label: 'layout',
        type: 'select',
        value: String(opts.layout ?? 'circle'),
        options: [
          ['circle', 'circle'],
          ['voronoi', 'voronoi'],
          ['grid', 'grid'],
        ],
      },
      { key: 'segments', label: 'regions', type: 'toggle', value: opts.segments !== false },
      { key: 'multi', label: 'multi-zone', type: 'toggle', value: Boolean(opts.multi) },
      {
        key: 'multiPad',
        label: 'hold pad',
        type: 'select',
        value: String(opts.multiPad ?? 'auto'),
        options: [
          ['auto', 'auto (touch)'],
          ['right', 'right'],
          ['left', 'left'],
          ['off', 'off'],
        ],
      },
      { key: 'holdDelay', label: 'hold delay', type: 'range', value: opts.holdDelay ?? 420, min: 0, max: 1000, step: 20, unit: 'ms' },
      { key: 'threshold', label: 'drop threshold', type: 'range', value: opts.threshold ?? 90, min: 30, max: 200, step: 5, unit: 'px' },
      { key: 'minConfidence', label: 'min confidence', type: 'range', value: opts.minConfidence ?? 0.45, min: 0, max: 1, step: 0.05 },
      { key: 'cardWidth', label: 'card width', type: 'range', value: 260, min: 190, max: 380, step: 10, unit: 'px' },
      { key: 'accent', label: 'accent', type: 'color', value: '#4a54f2' },
      { key: 'multiColor', label: 'multi colour', type: 'color', value: '#f59e0b' },
    ],
    (v) => {
      deck.setOptions({
        layout: v.layout as 'circle',
        segments: Boolean(v.segments),
        multi: Boolean(v.multi),
        multiPad: v.multiPad === 'off' ? false : (v.multiPad as 'auto'),
        holdDelay: Number(v.holdDelay),
        threshold: Number(v.threshold),
        minConfidence: Number(v.minConfidence),
      });
      root.style.setProperty('--tr-card-w', `${v.cardWidth}px`);
      root.style.setProperty('--tr-accent', String(v.accent));
      root.style.setProperty('--tr-multi', String(v.multiColor));
    },
  );
}
