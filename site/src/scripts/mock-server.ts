// A trieur server simulated inside the tab.
//
// It implements the same protocol as `@trieur/server` — same routes, same deduplication by
// event id — so the demo can show the real back and forth without anything to host. The real
// server adds what a tab cannot do: SQLite, replaying history, and embeddings.

import { defaultModel, routes, type PushRequest, type SortEvent } from '@trieur/learn';

export interface MockServer {
  fetch: typeof fetch;
  events: SortEvent[];
  version: number;
  offline: boolean;
  latency: number;
  log: string[];
  onchange?: () => void;
}

export function mockServer(): MockServer {
  const seen = new Map<string, SortEvent>();
  const model = defaultModel();

  const state: MockServer = {
    fetch: null as unknown as typeof fetch,
    get events() {
      return [...seen.values()];
    },
    version: 0,
    offline: false,
    latency: 180,
    log: [],
  };

  const note = (line: string) => {
    state.log.unshift(line);
    state.log.length = Math.min(state.log.length, 12);
    state.onchange?.();
  };

  const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });

  state.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    await new Promise((r) => setTimeout(r, state.latency));
    if (state.offline) {
      note('✗ network unreachable');
      throw new TypeError('Failed to fetch');
    }

    if (url.pathname === routes.events('demo')) {
      const body = JSON.parse(String(init?.body ?? '{}')) as PushRequest;
      let accepted = 0;
      let duplicates = 0;
      for (const e of body.events ?? []) {
        if (seen.has(e.id)) {
          duplicates++;
          continue;
        }
        seen.set(e.id, e);
        model.learn(e.features, e.target, e.weight);
        state.version++;
        accepted++;
      }
      note(`↑ ${accepted} event(s) accepted${duplicates ? `, ${duplicates} duplicate(s) ignored` : ''}`);
      return json({ accepted, duplicates, version: state.version });
    }

    if (url.pathname === routes.model('demo')) {
      const since = Number(url.searchParams.get('since') ?? 0);
      note(`↓ model requested (since v${since}) → v${state.version}`);
      return json({
        version: state.version,
        model: state.version > since ? model.toJSON() : null,
        stats: { examples: model.examples, targets: 0, vocab: 0, accuracy: 0 },
      });
    }

    if (url.pathname === routes.predict('demo')) {
      const body = JSON.parse(String(init?.body ?? '{}'));
      note('? prediction asked of the server (the local model stayed silent)');
      return json({ ranked: model.predict(body.features ?? [], body.targets ?? []), source: 'sparse' });
    }

    return json({ error: 'unknown route' });
  }) as typeof fetch;

  return state;
}
