import { eventId, routes, tokens, type SortEvent } from '@trieur/learn';
import { expect, test } from 'bun:test';
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

test('push events, then fetch the model', async () => {
  const { handle } = api();
  const events = [
    ...Array.from({ length: 4 }, () => event('github.com', 'rust', 'dev')),
    ...Array.from({ length: 4 }, () => event('seriouseats.com', 'bread', 'cooking')),
  ];
  const push = await (await handle(post(routes.events('links'), { events }))).json();
  expect(push.accepted).toBe(8);
  expect(push.duplicates).toBe(0);

  const model = await (await handle(new Request(`http://x${routes.model('links')}?since=0`))).json();
  expect(model.version).toBe(8);
  expect(model.model.kind).toBe('ensemble');
  expect(model.stats.examples).toBe(8);

  // the client is already up to date: no point shipping the snapshot again
  const same = await (await handle(new Request(`http://x${routes.model('links')}?since=8`))).json();
  expect(same.model).toBeNull();
});

test('a replayed event is not learned twice', async () => {
  const { handle } = api();
  const events = Array.from({ length: 3 }, () => event('github.com', 'rust', 'dev'));
  await handle(post(routes.events('links'), { events }));
  const again = await (await handle(post(routes.events('links'), { events }))).json();
  expect(again.accepted).toBe(0);
  expect(again.duplicates).toBe(3);
  expect((await (await handle(new Request(`http://x${routes.stats('links')}`))).json()).examples).toBe(3);
});

test('server-side prediction', async () => {
  const { handle } = api();
  const events = [
    ...Array.from({ length: 5 }, () => event('github.com', 'rust', 'dev')),
    ...Array.from({ length: 5 }, () => event('seriouseats.com', 'bread', 'cooking')),
  ];
  await handle(post(routes.events('links'), { events }));
  const res = await (
    await handle(post(routes.predict('links'), { features: tokens({ domain: 'github.com', tag: ['rust'] }), targets: ['dev', 'cooking'] }))
  ).json();
  expect(res.ranked[0].id).toBe('dev');
  expect(res.source).toBe('sparse'); // no embeddings configured here
});

test('decks are isolated from one another', async () => {
  const { handle } = api();
  await handle(post(routes.events('a'), { events: [event('github.com', 'rust', 'dev')] }));
  expect((await (await handle(new Request(`http://x${routes.stats('b')}`))).json()).examples).toBe(0);
});

test('the model survives a restart by replaying the events', async () => {
  const db = openDb(':memory:');
  const first = createApi({ db });
  const events = [
    ...Array.from({ length: 5 }, () => event('github.com', 'rust', 'dev')),
    ...Array.from({ length: 5 }, () => event('seriouseats.com', 'bread', 'cooking')),
  ];
  await first.handle(post(routes.events('links'), { events }));

  // same database, fresh process, no snapshot written yet (saveEvery not reached)
  const second = createApi({ db });
  const res = await (
    await second.handle(post(routes.predict('links'), { features: tokens({ domain: 'github.com', tag: ['rust'] }), targets: ['dev', 'cooking'] }))
  ).json();
  expect(res.ranked[0].id).toBe('dev');
  expect(second.stats('links').examples).toBe(10);
});

test('a token is required once configured', async () => {
  const { handle } = api('secret');
  expect((await handle(new Request(`http://x${routes.stats('links')}`))).status).toBe(401);
  expect((await handle(post(routes.events('links'), { events: [] }, 'secret'))).status).toBe(200);
  expect((await handle(new Request('http://x/health'))).status).toBe(200); // /health stays open
});
