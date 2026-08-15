import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register();

const { expect, test, beforeEach } = await import('bun:test');
const { Deck } = await import('./deck.js');
type DeckType = InstanceType<typeof Deck>;

const ZONES = [{ id: 'dev' }, { id: 'ia' }, { id: 'home' }];
const ITEMS = [{ t: 'a' }, { t: 'b' }, { t: 'c' }];

let root: HTMLElement;
beforeEach(() => {
  document.body.innerHTML = '<div id="deck"></div>';
  root = document.querySelector('#deck')!;
});

const press = (deck: DeckType, key: string, shift = false) =>
  root.querySelector('.tr-stage')!.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey: shift, bubbles: true }));

const release = (key: string) =>
  root.querySelector('.tr-stage')!.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));

/** Press and release, with nothing in between — what "tapping Shift" means. */
const tap = (key: string) => {
  root.querySelector('.tr-stage')!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  release(key);
};

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const badges = () => [...root.querySelectorAll('.tr-zone.tr-picked')].map((el) => (el as HTMLElement).dataset.pick);

/** Pointer events, minus the parts happy-dom does not implement. */
const pointer = (type: string, x = 0, y = 0, id = 1) => {
  const e = new Event(type, { bubbles: true, cancelable: true }) as Event & Record<string, unknown>;
  Object.assign(e, { pointerId: id, clientX: x, clientY: y, button: 0 });
  return e as never;
};
const card = () => root.querySelector<HTMLElement>('.tr-card:not(.tr-behind)')!;
/** One drag, in as many steps as there are points. Each move waits a frame, like the real one. */
const drag = async (
  steps: Array<[number, number]>,
  end: 'pointerup' | 'pointercancel' = 'pointerup',
  step = 24,
) => {
  const el = card();
  el.dispatchEvent(pointer('pointerdown', 0, 0));
  for (const [x, y] of steps) {
    el.dispatchEvent(pointer('pointermove', x, y));
    await tick(step);
  }
  const last = steps[steps.length - 1] ?? [0, 0];
  el.dispatchEvent(pointer(end, last[0], last[1]));
  await tick();
};

test('a zone key files the top card', async () => {
  const filed: string[] = [];
  const d = new Deck(root, { items: [...ITEMS], zones: ZONES, onSort: (_i, z) => void filed.push(z.id) });
  press(d, 'a');
  await tick();
  expect(filed).toEqual(['dev']);
  expect(d.items.length).toBe(2);
});

test('multi off: Shift changes nothing', async () => {
  const filed: string[] = [];
  const d = new Deck(root, { items: [...ITEMS], zones: ZONES, onSort: (_i, z) => void filed.push(z.id) });
  press(d, 'A', true);
  await tick();
  expect(filed).toEqual(['dev']); // filed straight away, no stack
  expect(d.picking).toEqual([]);
});

test('Shift stacks several zones, releasing Shift files them all at once', async () => {
  const calls: string[][] = [];
  const d = new Deck(root, {
    items: [...ITEMS],
    zones: ZONES,
    multi: true,
    onSortMany: (_i, zones) => void calls.push(zones.map((z) => z.id)),
  });

  press(d, 'A', true);
  press(d, 'S', true);
  press(d, 'D', true);
  expect(d.picking.map((z) => z.id)).toEqual(['dev', 'ia', 'home']);
  expect(badges()).toEqual(['1', '2', '3']); // the rank is visible, and rank 1 is the primary
  expect(root.classList.contains('tr-multi')).toBe(true);
  expect(d.items.length).toBe(3); // nothing filed yet

  release('Shift');
  await tick();
  expect(calls).toEqual([['dev', 'ia', 'home']]);
  expect(d.items.length).toBe(2);
  expect(d.picking).toEqual([]);
  expect(root.classList.contains('tr-multi')).toBe(false);
});

test('pressing the same zone twice removes it from the stack', async () => {
  const d = new Deck(root, { items: [...ITEMS], zones: ZONES, multi: true, onSortMany: () => {} });
  press(d, 'A', true);
  press(d, 'S', true);
  press(d, 'A', true);
  expect(d.picking.map((z) => z.id)).toEqual(['ia']);
  expect(badges()).toEqual(['1']);
});

test('Escape drops the stack without filing anything', async () => {
  let filed = 0;
  const d = new Deck(root, { items: [...ITEMS], zones: ZONES, multi: true, onSortMany: () => void filed++ });
  press(d, 'A', true);
  press(d, 'S', true);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await tick();
  expect(filed).toBe(0);
  expect(d.picking).toEqual([]);
  expect(d.items.length).toBe(3);
});

test('the bar button latches the mode, and Shift release does not file it', async () => {
  const calls: string[][] = [];
  const d = new Deck(root, {
    items: [...ITEMS],
    zones: ZONES,
    multi: true,
    onSortMany: (_i, zones) => void calls.push(zones.map((z) => z.id)),
  });
  const btn = root.querySelector<HTMLButtonElement>('[data-tr="multi"]')!;
  expect(btn.hidden).toBe(false);

  btn.click();
  expect(d.multi).toBe(true);
  press(d, 'a'); // no Shift needed once latched
  press(d, 'd');
  expect(d.picking.map((z) => z.id)).toEqual(['dev', 'home']);

  release('Shift'); // a stray Shift release must not file a latched stack
  await tick();
  expect(calls).toEqual([]);

  expect(btn.textContent).toContain('2 zones');
  btn.click(); // the same button confirms
  await tick();
  expect(calls).toEqual([['dev', 'home']]);
});

test('in latched mode, tapping a tile stacks it', async () => {
  const d = new Deck(root, { items: [...ITEMS], zones: ZONES, multi: true, onSortMany: () => {} });
  root.querySelector<HTMLButtonElement>('[data-tr="multi"]')!.click();
  root.querySelector<HTMLElement>('.tr-zone[data-id="ia"]')!.click();
  expect(d.picking.map((z) => z.id)).toEqual(['ia']);
});

test('the model learns one example per zone, and undo forgets each one', async () => {
  const learned: string[] = [];
  const forgotten: string[] = [];
  const d = new Deck(root, {
    items: [...ITEMS],
    zones: ZONES,
    multi: true,
    onSortMany: () => {},
    onUndoMany: () => {},
    advisor: {
      best: () => null,
      record: (r) => void learned.push(r.zoneId),
      forget: (r) => void forgotten.push(r.zoneId),
    },
  });
  press(d, 'A', true);
  press(d, 'S', true);
  release('Shift');
  await tick();
  expect(learned).toEqual(['dev', 'ia']);

  await d.undo();
  await tick();
  expect(forgotten).toEqual(['dev', 'ia']);
  expect(d.items.length).toBe(3); // the card is back on top
  expect(d.items[0]).toBe(ITEMS[0] as never);
});

test('without onSortMany, several zones fall back to onSort called once per zone', async () => {
  const filed: string[] = [];
  const d = new Deck(root, { items: [...ITEMS], zones: ZONES, multi: true, onSort: (_i, z) => void filed.push(z.id) });
  press(d, 'A', true);
  press(d, 'D', true);
  release('Shift');
  await tick();
  expect(filed).toEqual(['dev', 'home']);
});

test('a rejected filing keeps the card and the stack', async () => {
  const d = new Deck(root, {
    items: [...ITEMS],
    zones: ZONES,
    multi: true,
    onSortMany: () => Promise.reject(new Error('nope')),
  });
  press(d, 'A', true);
  press(d, 'S', true);
  release('Shift');
  await tick();
  expect(d.items.length).toBe(3); // nothing was filed
});

test('a bare Shift tap latches the mode, and taps again to leave it', () => {
  const d = new Deck(root, { items: [...ITEMS], zones: ZONES, multi: true, onSortMany: () => {} });
  tap('Shift');
  expect(d.multi).toBe(true);
  tap('Shift');
  expect(d.multi).toBe(false);
});

test('Shift held over a zone key is not a tap', async () => {
  const filed: string[] = [];
  const d = new Deck(root, { items: [...ITEMS], zones: ZONES, multi: true, onSort: (_i, z) => void filed.push(z.id) });
  root.querySelector('.tr-stage')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', bubbles: true }));
  press(d, 'A', true);
  release('Shift');
  await tick();
  expect(filed).toEqual(['dev']); // the stack was filed, the mode did not stay latched
  expect(d.multi).toBe(false);
  expect(d.picking).toEqual([]);
});

test('a Shift tap over a pending stack files it', async () => {
  const calls: string[][] = [];
  const d = new Deck(root, {
    items: [...ITEMS],
    zones: ZONES,
    multi: true,
    onSortMany: (_i, zones) => void calls.push(zones.map((z) => z.id)),
  });
  root.querySelector<HTMLButtonElement>('[data-tr="multi"]')!.click();
  press(d, 'a');
  press(d, 's');
  tap('Shift'); // a tap, so: down then up, with nothing pressed in between
  await tick();
  expect(calls).toEqual([['dev', 'ia']]);
});

test('a drag past the threshold files, and a cancelled pointer does not', async () => {
  const filed: string[] = [];
  const d = new Deck(root, { items: [...ITEMS], zones: ZONES, onSort: (_i, z) => void filed.push(z.id) });
  await drag([
    [40, 0],
    [220, 0],
  ]);
  expect(filed.length).toBe(1);
  expect(d.items.length).toBe(2);

  // the system takes the touch back mid-drag: the card comes home, nothing is filed
  await drag(
    [
      [40, 0],
      [220, 0],
    ],
    'pointercancel',
  );
  expect(filed.length).toBe(1);
  expect(d.items.length).toBe(2);
  expect(card().style.transform).toBe('');
});

test('in multi mode a sweep stacks every region it reaches', async () => {
  const d = new Deck(root, { items: [...ITEMS], zones: ZONES, multi: true, onSortMany: () => {} });
  root.querySelector<HTMLButtonElement>('[data-tr="multi"]')!.click();
  await drag([
    [220, 0], // one direction
    [-220, 160], // another
    [0, 0], // back to the middle
  ]);
  expect(d.picking.length).toBe(2);
  expect(d.items.length).toBe(3); // latched: the sweep stacks, it does not file
  expect(card().style.transform).toBe(''); // and the card came back to the centre
});

test('holding the card opens the stack, and letting go files it', async () => {
  const calls: string[][] = [];
  const d = new Deck(root, {
    items: [...ITEMS],
    zones: ZONES,
    multi: true,
    holdDelay: 20,
    onSortMany: (_i, zones) => void calls.push(zones.map((z) => z.id)),
  });
  const el = card();
  el.dispatchEvent(pointer('pointerdown', 0, 0));
  await tick(60); // the finger rests
  expect(d.multi).toBe(true);
  // the same finger sweeps two regions, then lets go
  for (const [x, y] of [
    [220, 0],
    [-220, 160],
  ] as const) {
    el.dispatchEvent(pointer('pointermove', x, y));
    await tick(24);
  }
  expect(d.picking.length).toBe(2);
  el.dispatchEvent(pointer('pointerup', -220, 160));
  await tick();
  expect(calls.length).toBe(1);
  expect(calls[0]!.length).toBe(2);
  expect(d.multi).toBe(false);
});

test('the pad holds the mode, and its release files the stack', async () => {
  const calls: string[][] = [];
  const d = new Deck(root, {
    items: [...ITEMS],
    zones: ZONES,
    multi: true,
    multiPad: 'right',
    onSortMany: (_i, zones) => void calls.push(zones.map((z) => z.id)),
  });
  const pad = root.querySelector<HTMLElement>('.tr-pad')!;
  expect(pad.hidden).toBe(false);

  pad.dispatchEvent(pointer('pointerdown', 0, 0, 2));
  expect(d.multi).toBe(true);
  press(d, 'a');
  press(d, 's');
  expect(d.picking.length).toBe(2);
  pad.dispatchEvent(pointer('pointerup', 0, 0, 2));
  await tick();
  expect(calls).toEqual([['dev', 'ia']]);
  expect(d.multi).toBe(false);
});

test('the pad stays away unless multi is on', () => {
  const d = new Deck(root, { items: [...ITEMS], zones: ZONES, multiPad: 'right' });
  expect(root.querySelector<HTMLElement>('.tr-pad')!.hidden).toBe(true);
  d.setOptions({ multi: true });
  expect(root.querySelector<HTMLElement>('.tr-pad')!.hidden).toBe(false);
});

test('removing a zone drops it from the stack instead of filing into nowhere', () => {
  const d = new Deck(root, { items: [...ITEMS], zones: ZONES, multi: true, onSortMany: () => {} });
  press(d, 'A', true);
  press(d, 'S', true);
  d.setZones([{ id: 'dev' }, { id: 'home' }]);
  expect(d.picking.map((z) => z.id)).toEqual(['dev']);
});

test('a plugin decides where a release goes, and only when it wants to', async () => {
  const filed: string[] = [];
  const seen: string[] = [];
  const d = new Deck(root, {
    items: [...ITEMS],
    zones: ZONES,
    threshold: 300, // nothing would file on its own
    onSort: (_i, z) => void filed.push(z.id),
    plugins: [
      {
        name: 'test',
        setup: () => {
          seen.push('setup');
          return () => seen.push('teardown');
        },
        // fast enough to be deliberate: file into the second zone, whatever the distance
        aim: (ctx, deck) => (Math.hypot(ctx.v.x, ctx.v.y) > 0.4 ? (deck.zones[1] ?? null) : undefined),
      },
    ],
  });
  expect(seen).toEqual(['setup']);

  await drag([
    [30, 0],
    [60, 0],
    [90, 0],
  ]);
  expect(filed).toEqual(['ia']); // the plugin's answer, not the deck's

  // …and a slow drag leaves the decision alone: short of the threshold, nothing is filed
  await drag(
    [
      [30, 0],
      [60, 0],
      [90, 0],
    ],
    'pointerup',
    200,
  );
  expect(filed).toEqual(['ia']);

  d.destroy();
  expect(seen).toEqual(['setup', 'teardown']);
});

test('the card behind is promoted, not rebuilt', async () => {
  const d = new Deck(root, { items: [...ITEMS], zones: ZONES, renderCard: (i, el) => (el.textContent = String(i.t)) });
  const behind = root.querySelector('.tr-card.tr-behind')!;
  press(d, 'a');
  await tick();
  const top = [...root.querySelectorAll('.tr-card:not(.tr-genie)')].at(-1);
  // the same element, or every image it holds reloads — and a reload is a blink
  expect(top).toBe(behind);
  expect(behind.classList.contains('tr-behind')).toBe(false);
});

test('two piles share the zones, and filing one leaves the other alone', async () => {
  const filed: Array<[string, string]> = [];
  const d = new Deck(root, {
    items: [...ITEMS],
    zones: ZONES,
    piles: 2,
    renderCard: (i, el) => (el.textContent = String(i.t)),
    onSort: (item, z) => void filed.push([String((item as { t: string }).t), z.id]),
  });
  const piles = [...root.querySelectorAll('.tr-pile')];
  expect(piles.length).toBe(2);
  const tops = () => piles.map((p) => p.querySelector('.tr-card:not(.tr-behind):not(.tr-genie)')!.textContent);
  expect(tops()).toEqual(['a', 'b']); // two different cards, one per hand

  // the second pile is the active one, and the keyboard files *its* card
  const right = piles[1]!.querySelector('.tr-card:not(.tr-behind)')!;
  const el = right as HTMLElement;
  el.dispatchEvent(pointer('pointerdown', 0, 0));
  el.dispatchEvent(pointer('pointerup', 0, 0));
  expect(d.active).toBe(1);
  press(d, 'a');
  await tick();
  expect(filed).toEqual([['b', 'dev']]);
  // the left pile did not move: same card, same element
  expect(piles[0]!.querySelector('.tr-card:not(.tr-behind)')!.textContent).toBe('a');
  expect(d.items).toHaveLength(2);
});

test('the small scale follows the stage, not the window', () => {
  const d = new Deck(root, { items: [...ITEMS], zones: ZONES });
  const stage = root.querySelector('.tr-stage')!;
  const width = (v: number) => Object.defineProperty(stage, 'clientWidth', { value: v, configurable: true });

  width(380); // a phone, or a 380px panel on a 1440px screen — the same problem
  d.layout(true);
  expect(root.classList.contains('tr-sm')).toBe(true);
  expect(root.classList.contains('tr-xs')).toBe(true);

  width(900);
  d.layout(true);
  expect(root.classList.contains('tr-sm')).toBe(false);
  expect(root.classList.contains('tr-xs')).toBe(false);
});

test('a drag away from a zone does not file into it, however wide its region', async () => {
  const filed: string[] = [];
  const d = new Deck(root, { items: [...ITEMS], zones: ZONES, onSort: (_i, z) => void filed.push(z.id) });
  // the dock's home column: the zone below the card owns the region the card sits in
  const home = d.zones[0]!;
  home.pos = { x: 0, y: 300 }; // its tile sits straight below the card
  home.angle = Math.PI / 2;
  home.cell = [
    [-1e4, -1e4],
    [1e4, -1e4],
    [1e4, 1e4],
    [-1e4, 1e4],
  ];
  for (const other of d.zones.slice(1)) other.cell = null;

  await drag([[0, -220]]); // dragged straight up: away from the only zone there is
  expect(filed).toEqual([]);

  await drag([[0, 220]]); // and towards it
  expect(filed).toEqual(['dev']);
});

test('a tap on a tile files the card, and still picks in multi mode', async () => {
  const filed: string[] = [];
  const d = new Deck(root, {
    items: [...ITEMS],
    zones: ZONES,
    multi: true,
    onSort: (_i, z) => void filed.push(z.id),
    onSortMany: () => {},
  });
  const tile = (i: number) => root.querySelectorAll('.tr-zone')[i] as HTMLElement;

  tile(1).click();
  await tick();
  expect(filed).toEqual(['ia']);

  // multi mode latched: the same tap picks instead of filing
  tap('Shift');
  tile(0).click();
  expect(d.picking.map((z) => z.id)).toEqual(['dev']);
  expect(filed).toEqual(['ia']);
});

test('a disabled zone keeps its place and refuses the card', async () => {
  const filed: string[] = [];
  const d = new Deck(root, {
    items: [...ITEMS],
    zones: [{ id: 'dev' }, { id: 'ia', disabled: true }, { id: 'home' }],
    onSort: (_i, z) => void filed.push(z.id),
  });
  const tiles = [...root.querySelectorAll('.tr-zone')] as HTMLElement[];
  expect(tiles[1]!.classList.contains('tr-off')).toBe(true);
  expect(tiles.length).toBe(3); // still there: removing it would move the other two

  tiles[1]!.click(); // a tap does nothing
  press(d, 's'); //    and so does its key
  await tick();
  expect(filed).toEqual([]);
  expect(d.items.length).toBe(3);

  tiles[0]!.click();
  await tick();
  expect(filed).toEqual(['dev']);
});

test('tapZones: false gives the click back to the host', async () => {
  const filed: string[] = [];
  const d = new Deck(root, { items: [...ITEMS], zones: ZONES, tapZones: false, onSort: (_i, z) => void filed.push(z.id) });
  (root.querySelectorAll('.tr-zone')[0] as HTMLElement).click();
  await tick();
  expect(filed).toEqual([]);
  expect(d.items.length).toBe(3);
});
