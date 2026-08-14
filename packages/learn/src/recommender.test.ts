import { expect, test } from 'bun:test';
import { HybridRecommender, LocalRecommender } from './recommender.js';
import { memoryStore } from './store.js';
import type { SortEvent } from './protocol.js';

const card = (domain: string, tag: string) => ({ meta: { domain, tag: [tag] }, zoneId: '' });
const feed = async (r: LocalRecommender | HybridRecommender, domain: string, tag: string, zone: string, n = 1) => {
  for (let i = 0; i < n; i++) await r.record({ ...card(domain, tag), zoneId: zone });
};

test('mode léger : apprend, propose, se relit depuis le stockage', async () => {
  const store = memoryStore();
  const a = new LocalRecommender({ store, key: 'test', saveDelay: 0 });
  await feed(a, 'github.com', 'rust', 'dev', 4);
  await feed(a, 'marmiton.org', 'pain', 'cuisine', 4);
  await a.flush();

  expect((await a.best({ domain: 'github.com', tag: ['rust'] }, ['dev', 'cuisine']))?.id).toBe('dev');

  // un autre onglet, un autre jour : le modèle repart là où il s'était arrêté
  const b = new LocalRecommender({ store, key: 'test' });
  await b.ready();
  expect((await b.stats()).examples).toBeGreaterThan(0);
  expect((await b.best({ domain: 'github.com', tag: ['rust'] }, ['dev', 'cuisine']))?.id).toBe('dev');
});

test('mode léger : rien de tranché → rien de proposé', async () => {
  const r = new LocalRecommender({ store: memoryStore(), key: 'k', saveDelay: 0 });
  await feed(r, 'github.com', 'rust', 'dev', 4);
  // une carte dont aucun trait n'est connu ne doit pas déclencher de proposition
  expect(await r.best({ domain: 'inconnu.fr', tag: ['jardinage'] }, ['dev', 'cuisine'])).toBeNull();
});

test('annuler défait ce qui vient d\'être appris', async () => {
  const r = new LocalRecommender({ store: memoryStore(), key: 'k', saveDelay: 0 });
  await feed(r, 'x.com', 'a', 'z1', 3);
  const before = (await r.stats()).examples;
  await r.forget({ ...card('x.com', 'a'), zoneId: 'z1' });
  expect((await r.stats()).examples).toBeLessThan(before);
});

/** Serveur de test : compte les événements, rejette tant qu'`offline` est vrai. */
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

test('mode complet : le local répond, le serveur reçoit', async () => {
  const server = fakeServer();
  const r = new HybridRecommender({
    store: memoryStore(),
    key: 'liens',
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

test('mode complet : hors ligne, rien n\'est perdu et rien n\'est appris deux fois', async () => {
  const server = fakeServer();
  const store = memoryStore();
  const opts = { store, key: 'liens', saveDelay: 0, batch: 99, server: { url: 'http://test', fetch: server.fetch } };
  const r = new HybridRecommender(opts);
  await r.ready();

  server.offline = true;
  await feed(r, 'github.com', 'rust', 'dev', 3);
  await r.flush();
  expect(server.events.length).toBe(0);
  expect(r.pending).toBe(3); // la file a tenu

  // le modèle local, lui, a appris quand même : le tri n'a jamais attendu le réseau
  expect((await r.best({ domain: 'github.com', tag: ['rust'] }, ['dev', 'perso']))?.id).toBe('dev');

  server.offline = false;
  await r.flush();
  expect(server.events.length).toBe(3);

  // renvoyer la même file (reprise après coupure) n'ajoute rien : les ids sont dédupliqués
  const again = new HybridRecommender(opts);
  await again.ready();
  await again.flush();
  expect(server.events.length).toBe(3);
});

test('mode complet : un serveur injoignable ne casse pas la proposition', async () => {
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
  expect((await r.best({ domain: 'github.com', tag: ['rust'] }, ['dev', 'perso']))?.id).toBe('dev');
  // carte inconnue + serveur muet = pas de proposition, pas d'exception
  expect(await r.best({ domain: 'nulle-part.fr', tag: ['zzz'] }, ['dev', 'perso'])).toBeNull();
});
