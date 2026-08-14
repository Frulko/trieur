import { expect, test } from 'bun:test';
import type { SortEvent } from './protocol.js';
import { HybridRecommender, LocalRecommender } from './recommender.js';
import { memoryStore } from './store.js';

const card = (domain: string, tag: string) => ({ meta: { domain, tag: [tag] }, zoneId: '' });
const feed = async (r: LocalRecommender | HybridRecommender, domain: string, tag: string, zone: string, n = 1) => {
  for (let i = 0; i < n; i++) await r.record({ ...card(domain, tag), zoneId: zone });
};

test('light mode: learns, suggests, reads itself back from storage', async () => {
  const store = memoryStore();
  const a = new LocalRecommender({ store, key: 'test', saveDelay: 0 });
  await feed(a, 'github.com', 'rust', 'dev', 4);
  await feed(a, 'seriouseats.com', 'bread', 'cooking', 4);
  await a.flush();

  expect((await a.best({ domain: 'github.com', tag: ['rust'] }, ['dev', 'cooking']))?.id).toBe('dev');

  // another tab, another day: the model picks up where it left off
  const b = new LocalRecommender({ store, key: 'test' });
  await b.ready();
  expect((await b.stats()).examples).toBeGreaterThan(0);
  expect((await b.best({ domain: 'github.com', tag: ['rust'] }, ['dev', 'cooking']))?.id).toBe('dev');
});

test('light mode: nothing decisive → nothing suggested', async () => {
  const r = new LocalRecommender({ store: memoryStore(), key: 'k', saveDelay: 0 });
  await feed(r, 'github.com', 'rust', 'dev', 4);
  // a card with no known feature must not trigger a suggestion
  expect(await r.best({ domain: 'unknown.tld', tag: ['gardening'] }, ['dev', 'cooking'])).toBeNull();
});

test('undo unlearns what was just learned', async () => {
  const r = new LocalRecommender({ store: memoryStore(), key: 'k', saveDelay: 0 });
  await feed(r, 'x.com', 'a', 'z1', 3);
  const before = (await r.stats()).examples;
  await r.forget({ ...card('x.com', 'a'), zoneId: 'z1' });
  expect((await r.stats()).examples).toBeLessThan(before);
});

/** Test server: counts events, refuses everything while `offline` is true. */
function fakeServer() {
  const seen = new Map<string, SortEvent>();
  let offline = false;
  let calls = 0;
  const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
    calls++;
    if (offline) throw new Error('offline');
    const body = JSON.parse(String(init?.body ?? '{}'));
    let duplicates = 0;
    for (const e of (body.events ?? []) as SortEvent[]) {
      if (seen.has(e.id)) duplicates++;
      else seen.set(e.id, e);
    }
    return new Response(JSON.stringify({ accepted: seen.size, duplicates, version: seen.size }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return {
    fetch: fetchImpl,
    get events() {
      return [...seen.values()];
    },
    get calls() {
      return calls;
    },
    set offline(v: boolean) {
      offline = v;
    },
  };
}

test('full mode: the local model answers, the server receives', async () => {
  const server = fakeServer();
  const r = new HybridRecommender({
    store: memoryStore(),
    key: 'links',
    saveDelay: 0,
    batch: 2,
    server: { url: 'http://test', fetch: server.fetch },
  });
  await r.ready();
  await feed(r, 'github.com', 'rust', 'dev', 4);
  await r.flush();

  expect(server.events.length).toBe(4);
  expect(server.events[0]!.features).toContain('domain:github.com');
  expect(server.events[0]!.weight).toBe(1);
  expect(r.pending).toBe(0);
});

test('full mode: offline, nothing is lost and nothing is learned twice', async () => {
  const server = fakeServer();
  const store = memoryStore();
  const opts = { store, key: 'links', saveDelay: 0, batch: 99, server: { url: 'http://test', fetch: server.fetch } };
  const r = new HybridRecommender(opts);
  await r.ready();

  server.offline = true;
  await feed(r, 'github.com', 'rust', 'dev', 3);
  await r.flush();
  expect(server.events.length).toBe(0);
  expect(r.pending).toBe(3); // the queue held

  // the local model learned all the same: sorting never waited on the network
  expect((await r.best({ domain: 'github.com', tag: ['rust'] }, ['dev', 'personal']))?.id).toBe('dev');

  server.offline = false;
  await r.flush();
  expect(server.events.length).toBe(3);

  // replaying the same queue (recovery after an outage) adds nothing: ids are deduplicated
  const again = new HybridRecommender(opts);
  await again.ready();
  await again.flush();
  expect(server.events.length).toBe(3);
});

test('full mode: an unreachable server does not break the suggestion', async () => {
  const server = fakeServer();
  server.offline = true;
  const r = new HybridRecommender({
    store: memoryStore(),
    key: 'k',
    saveDelay: 0,
    server: { url: 'http://test', fetch: server.fetch },
    remoteTimeout: 50,
  });
  await r.ready();
  await feed(r, 'github.com', 'rust', 'dev', 4);
  expect((await r.best({ domain: 'github.com', tag: ['rust'] }, ['dev', 'personal']))?.id).toBe('dev');
  // unknown card plus a silent server = no suggestion, and no exception
  expect(await r.best({ domain: 'nowhere.tld', tag: ['zzz'] }, ['dev', 'personal'])).toBeNull();
});
