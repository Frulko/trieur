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

const tick = () => new Promise((r) => setTimeout(r, 0));
const badges = () => [...root.querySelectorAll('.tr-zone.tr-picked')].map((el) => (el as HTMLElement).dataset.pick);

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

  expect(btn.textContent).toContain('2');
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

test('removing a zone drops it from the stack instead of filing into nowhere', () => {
  const d = new Deck(root, { items: [...ITEMS], zones: ZONES, multi: true, onSortMany: () => {} });
  press(d, 'A', true);
  press(d, 'S', true);
  d.setZones([{ id: 'dev' }, { id: 'home' }]);
  expect(d.picking.map((z) => z.id)).toEqual(['dev']);
});
