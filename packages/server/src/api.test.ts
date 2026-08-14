import { expect, test } from 'bun:test';
import { eventId, routes, tokens, type SortEvent } from '@trieur/learn';
import { createApi } from './api.js';
import { openDb } from './db.js';

const api = (token?: string) => createApi({ db: openDb(':memory:'), token });

const event = (domain: string, tag: string, target: string): SortEvent => ({
  id: eventId(),
  features: tokens({ domain, tag: [tag] }),
  target,
  weight: 1,
  at: Date.now(),
});

const post = (path: string, body: unknown, token?: string) =>
  new Request(`http://x${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });

test('pousser des événements, puis récupérer le modèle', async () => {
  const { handle } = api();
  const events = [
    ...Array.from({ length: 4 }, () => event('github.com', 'rust', 'dev')),
    ...Array.from({ length: 4 }, () => event('marmiton.org', 'pain', 'cuisine')),
  ];
  const push = await (await handle(post(routes.events('liens'), { events }))).json();
  expect(push.accepted).toBe(8);
  expect(push.duplicates).toBe(0);

  const model = await (await handle(new Request(`http://x${routes.model('liens')}?since=0`))).json();
  expect(model.version).toBe(8);
  expect(model.model.kind).toBe('ensemble');
  expect(model.stats.examples).toBe(8);

  // le client est déjà à jour : on ne renvoie pas l'instantané pour rien
  const same = await (await handle(new Request(`http://x${routes.model('liens')}?since=8`))).json();
  expect(same.model).toBeNull();
});

test('un événement rejoué n\'est pas appris deux fois', async () => {
  const { handle } = api();
  const events = Array.from({ length: 3 }, () => event('github.com', 'rust', 'dev'));
  await handle(post(routes.events('liens'), { events }));
  const again = await (await handle(post(routes.events('liens'), { events }))).json();
  expect(again.accepted).toBe(0);
  expect(again.duplicates).toBe(3);
  expect((await (await handle(new Request(`http://x${routes.stats('liens')}`))).json()).examples).toBe(3);
});

test('prédiction côté serveur', async () => {
  const { handle } = api();
  const events = [
    ...Array.from({ length: 5 }, () => event('github.com', 'rust', 'dev')),
    ...Array.from({ length: 5 }, () => event('marmiton.org', 'pain', 'cuisine')),
  ];
  await handle(post(routes.events('liens'), { events }));
  const res = await (
    await handle(post(routes.predict('liens'), { features: tokens({ domain: 'github.com', tag: ['rust'] }), targets: ['dev', 'cuisine'] }))
  ).json();
  expect(res.ranked[0].id).toBe('dev');
  expect(res.source).toBe('creux'); // pas d'embeddings configurés ici
});

test('les decks sont étanches', async () => {
  const { handle } = api();
  await handle(post(routes.events('a'), { events: [event('github.com', 'rust', 'dev')] }));
  expect((await (await handle(new Request(`http://x${routes.stats('b')}`))).json()).examples).toBe(0);
});

test('le modèle survit au redémarrage par rejeu des événements', async () => {
  const db = openDb(':memory:');
  const first = createApi({ db });
  const events = [
    ...Array.from({ length: 5 }, () => event('github.com', 'rust', 'dev')),
    ...Array.from({ length: 5 }, () => event('marmiton.org', 'pain', 'cuisine')),
  ];
  await first.handle(post(routes.events('liens'), { events }));

  // même base, processus neuf, aucun instantané écrit (saveEvery non atteint)
  const second = createApi({ db });
  const res = await (
    await second.handle(post(routes.predict('liens'), { features: tokens({ domain: 'github.com', tag: ['rust'] }), targets: ['dev', 'cuisine'] }))
  ).json();
  expect(res.ranked[0].id).toBe('dev');
  expect(second.stats('liens').examples).toBe(10);
});

test('token exigé quand il est configuré', async () => {
  const { handle } = api('secret');
  expect((await handle(new Request(`http://x${routes.stats('liens')}`))).status).toBe(401);
  expect((await handle(post(routes.events('liens'), { events: [] }, 'secret'))).status).toBe(200);
  expect((await handle(new Request('http://x/health'))).status).toBe(200); // /health reste ouvert
});
