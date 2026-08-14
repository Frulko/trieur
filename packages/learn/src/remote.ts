// Client HTTP du serveur trieur. Rien d'autre que `fetch` — utilisable dans un onglet,
// une extension, un worker ou Node.

import { routes, type ModelResponse, type PredictRequest, type PredictResponse, type PushRequest, type PushResponse, type SortEvent } from './protocol.js';
import type { Stats } from './types.js';

export interface ClientOptions {
  /** racine du serveur, sans slash final */
  url: string;
  /** identifiant du jeu de cartes : un modèle par deck */
  deck: string;
  token?: string;
  /** délai au-delà duquel on abandonne, en ms */
  timeout?: number;
  /** injectable pour les tests */
  fetch?: typeof fetch;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export class Client {
  readonly url: string;
  readonly deck: string;
  token: string | undefined;
  timeout: number;
  #fetch: typeof fetch;

  constructor(opts: ClientOptions) {
    this.url = opts.url.replace(/\/$/, '');
    this.deck = opts.deck;
    this.token = opts.token;
    this.timeout = opts.timeout ?? 8000;
    this.#fetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async #call<T>(path: string, init?: RequestInit & { timeout?: number }): Promise<T> {
    const res = await this.#fetch(this.url + path, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        ...init?.headers,
      },
      signal: AbortSignal.timeout(init?.timeout ?? this.timeout),
    });
    if (!res.ok) throw new HttpError(res.status, `${init?.method ?? 'GET'} ${path} → ${res.status}`);
    return (await res.json()) as T;
  }

  push(events: SortEvent[]): Promise<PushResponse> {
    return this.#call<PushResponse>(routes.events(this.deck), {
      method: 'POST',
      body: JSON.stringify({ events } satisfies PushRequest),
    });
  }

  model(since = 0): Promise<ModelResponse> {
    return this.#call<ModelResponse>(`${routes.model(this.deck)}?since=${since}`);
  }

  /** Prédiction côté serveur (modèles lourds, embeddings). `timeout` court par défaut :
   *  une carte est déjà sous le doigt, on n'attend pas le réseau. */
  predict(req: PredictRequest, timeout = 400): Promise<PredictResponse> {
    return this.#call<PredictResponse>(routes.predict(this.deck), {
      method: 'POST',
      body: JSON.stringify(req),
      timeout,
    });
  }

  stats(): Promise<Stats> {
    return this.#call<Stats>(routes.stats(this.deck));
  }
}
