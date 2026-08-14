// Ce qu'une app branche : un recommandeur.
//
// C'est la seule chose qu'un hôte manipule. Il expose exactement ce que `@trieur/core`
// attend d'un `Advisor` — donc `deck.options.advisor = recommender` suffit — plus de quoi
// afficher un état (`stats`) et de quoi ne rien perdre à la fermeture (`flush`).
//
// Deux modes, une interface :
//
// - **léger** : tout est local, modèle dans IndexedDB. Aucun serveur, aucune donnée qui
//   sort. C'est le mode par défaut, et pour beaucoup d'apps c'est le seul nécessaire.
// - **complet** : le mode léger *plus* un serveur. Le local continue de répondre — il est
//   instantané et fonctionne hors ligne — le serveur reçoit les événements, entraîne ce
//   qu'un navigateur ne peut pas entraîner (embeddings, corpus complet, plusieurs
//   appareils) et sert de démarrage à chaud sur une nouvelle machine.
//
// **Règle qui ne se négocie pas : la prédiction ne bloque jamais le geste.** La carte est
// déjà sous le doigt. Le local répond tout de suite ; le serveur n'est consulté que
// lorsque le local n'a rien à dire, et avec un délai maximum court.

import type { Extractor } from './features.js';
import { defaultFeatures } from './features.js';
import { defaultModel, modelFromJSON } from './models.js';
import { eventId, type SortEvent } from './protocol.js';
import { Client, type ClientOptions } from './remote.js';
import { autoStore, type Store } from './store.js';
import type { Model, ModelJSON, Prediction, Ranked, SortRecord, Stats } from './types.js';

export interface Recommender {
  /** la meilleure zone si elle se détache, sinon `null` */
  best(meta: unknown, targets: string[], minScore?: number): Promise<Prediction | null>;
  /** le classement complet */
  suggest(meta: unknown, targets: string[]): Promise<Ranked[]>;
  /** un rangement vient d'avoir lieu */
  record(r: SortRecord): Promise<void>;
  /** ce rangement est annulé */
  forget(r: SortRecord): Promise<void>;
  stats(): Promise<Stats>;
  /** écrit tout ce qui est en attente (à appeler avant de fermer la page) */
  flush(): Promise<void>;
  /** écrit, puis retire les écouteurs — à appeler si on remplace le recommandeur */
  destroy(): Promise<void>;
}

/** Écouteur de fenêtre qui sait se retirer. Sans ça, remplacer un recommandeur en laisse
 *  un derrière lui à chaque fois — invisible, jusqu'à ce qu'ils soient cent. */
function listen(event: string, fn: () => void): () => void {
  if (typeof addEventListener !== 'function') return () => {};
  addEventListener(event, fn);
  return () => removeEventListener(event, fn);
}

export interface LocalOptions {
  /** clé de stockage — un modèle par jeu de cartes */
  key?: string;
  model?: Model;
  features?: Extractor;
  store?: Store;
  /** score minimum pour proposer quelque chose */
  minConfidence?: number;
  /** délai avant sauvegarde, en ms : on ne réécrit pas le modèle à chaque carte */
  saveDelay?: number;
}

const MIN_CONFIDENCE = 0.45;

/** Mode léger : modèle local, aucune sortie réseau. */
export class LocalRecommender implements Recommender {
  model: Model;
  readonly features: Extractor;
  readonly store: Store;
  readonly key: string;
  minConfidence: number;
  saveDelay: number;

  #ready: Promise<void>;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #dirty = false;
  #detach: Array<() => void> = [];

  constructor(opts: LocalOptions = {}) {
    this.key = opts.key ?? 'model';
    this.model = opts.model ?? defaultModel();
    this.features = opts.features ?? defaultFeatures;
    this.store = opts.store ?? autoStore();
    this.minConfidence = opts.minConfidence ?? MIN_CONFIDENCE;
    this.saveDelay = opts.saveDelay ?? 800;
    this.#ready = this.#load();
    // fermer l'onglet ne doit pas coûter les derniers rangements
    this.#detach.push(listen('pagehide', () => void this.flush()));
  }

  async destroy(): Promise<void> {
    for (const off of this.#detach) off();
    this.#detach = [];
    await this.flush();
  }

  /** Résolue quand le modèle stocké a fini d'être relu. */
  ready(): Promise<void> {
    return this.#ready;
  }

  async #load(): Promise<void> {
    try {
      const saved = await this.store.load<ModelJSON>(this.key);
      if (saved) this.model = modelFromJSON(saved);
    } catch {
      // stockage indisponible ou modèle illisible : on repart d'un modèle neuf plutôt que
      // de refuser de démarrer
    }
  }

  async suggest(meta: unknown, targets: string[]): Promise<Ranked[]> {
    await this.#ready;
    return this.model.predict(this.features(meta), targets);
  }

  async best(meta: unknown, targets: string[], minScore = this.minConfidence): Promise<Prediction | null> {
    const [top] = await this.suggest(meta, targets);
    return top && top.score >= minScore ? top : null;
  }

  async record(r: SortRecord): Promise<void> {
    await this.#ready;
    this.model.learn(this.features(r.meta), r.zoneId, 1);
    this.#save();
  }

  async forget(r: SortRecord): Promise<void> {
    await this.#ready;
    this.model.learn(this.features(r.meta), r.zoneId, -1);
    this.#save();
  }

  async stats(): Promise<Stats> {
    await this.#ready;
    const m = this.model as Model & { stats?: () => Stats; vocabSize?: number; targets?: string[] };
    return (
      m.stats?.() ?? {
        examples: m.examples,
        targets: m.targets?.length ?? 0,
        vocab: m.vocabSize ?? 0,
        accuracy: 0,
      }
    );
  }

  #save(): void {
    this.#dirty = true;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => void this.flush(), this.saveDelay);
  }

  async flush(): Promise<void> {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    if (!this.#dirty) return;
    this.#dirty = false;
    await this.store.save(this.key, this.model.toJSON());
  }
}

export interface HybridOptions extends LocalOptions {
  server: Omit<ClientOptions, 'deck'> & { deck?: string };
  /** identifiant du jeu de cartes côté serveur (défaut : `key`) */
  deck?: string;
  /** nombre d'événements avant envoi immédiat */
  batch?: number;
  /** délai d'envoi, en ms */
  pushDelay?: number;
  /** temps maximum accordé au serveur pour une prédiction, en ms */
  remoteTimeout?: number;
}

/**
 * Mode complet : le local plus un serveur.
 *
 * La file d'événements est **persistée** : un tri fait hors ligne part au retour du
 * réseau, et chaque événement porte un id, donc un renvoi n'apprend rien deux fois.
 */
export class HybridRecommender implements Recommender {
  readonly local: LocalRecommender;
  readonly client: Client;
  batch: number;
  pushDelay: number;
  remoteTimeout: number;

  #queue: SortEvent[] = [];
  #queueKey: string;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #sending: Promise<void> | null = null;
  #ready: Promise<void>;
  #detach: Array<() => void> = [];

  constructor(opts: HybridOptions) {
    this.local = new LocalRecommender(opts);
    this.client = new Client({ ...opts.server, deck: opts.deck ?? opts.server.deck ?? this.local.key });
    this.batch = opts.batch ?? 20;
    this.pushDelay = opts.pushDelay ?? 3000;
    this.remoteTimeout = opts.remoteTimeout ?? 400;
    this.#queueKey = `${this.local.key}:queue`;
    this.#ready = this.#boot();
    this.#detach.push(
      listen('online', () => void this.flush()),
      listen('pagehide', () => void this.#persistQueue()),
    );
  }

  async destroy(): Promise<void> {
    for (const off of this.#detach) off();
    this.#detach = [];
    await this.#persistQueue();
    await this.local.destroy();
  }

  ready(): Promise<void> {
    return this.#ready;
  }

  async #boot(): Promise<void> {
    await this.local.ready();
    this.#queue = (await this.local.store.load<SortEvent[]>(this.#queueKey).catch(() => null)) ?? [];
    await this.warm();
    if (this.#queue.length) void this.flush();
  }

  /**
   * Démarrage à chaud : on récupère le modèle du serveur **uniquement si le local en sait
   * moins**. C'est le cas d'un nouvel appareil, ou d'un premier lancement.
   *
   * ponytail: remplacement, pas fusion. Fusionner deux modèles en ligne divergents demande
   * de rejouer les événements des deux côtés ; le jour où deux appareils trient vraiment en
   * parallèle, la bonne réponse est de faire rejouer le serveur et de tirer son modèle.
   */
  async warm(): Promise<boolean> {
    try {
      const res = await this.client.model(0);
      if (res.model && res.stats.examples > this.local.model.examples) {
        this.local.model = modelFromJSON(res.model);
        return true;
      }
    } catch {
      // hors ligne, serveur absent, token invalide : le mode léger suffit à travailler
    }
    return false;
  }

  async suggest(meta: unknown, targets: string[]): Promise<Ranked[]> {
    const local = await this.local.suggest(meta, targets);
    if (local.length) return local;
    return (await this.#remote(meta, targets))?.ranked ?? [];
  }

  /**
   * Le local d'abord. Le serveur n'est appelé que si le local se tait — typiquement les
   * premières cartes, ou une carte dont aucun trait n'est connu. C'est exactement là que
   * les embeddings servent, et le seul moment où attendre le réseau se justifie.
   */
  async best(meta: unknown, targets: string[], minScore?: number): Promise<Prediction | null> {
    const local = await this.local.best(meta, targets, minScore);
    if (local) return local;
    const remote = await this.#remote(meta, targets);
    const top = remote?.ranked[0];
    return top && top.score >= (minScore ?? this.local.minConfidence) ? top : null;
  }

  async #remote(meta: unknown, targets: string[]) {
    try {
      return await this.client.predict(
        { features: this.local.features(meta), targets, text: metaText(meta) },
        this.remoteTimeout,
      );
    } catch {
      return null; // le serveur est un bonus, jamais une dépendance du geste
    }
  }

  async record(r: SortRecord): Promise<void> {
    await this.local.record(r);
    this.#enqueue(r, 1);
  }

  async forget(r: SortRecord): Promise<void> {
    await this.local.forget(r);
    this.#enqueue(r, -1);
  }

  #enqueue(r: SortRecord, weight: number): void {
    const text = r.text ?? metaText(r.meta);
    this.#queue.push({
      id: eventId(),
      features: this.local.features(r.meta),
      target: r.zoneId,
      weight,
      at: r.at ?? Date.now(),
      predicted: r.predicted ?? null,
      ...(text ? { text } : {}),
    });
    if (this.#queue.length >= this.batch) return void this.flush();
    if (!this.#timer) this.#timer = setTimeout(() => void this.flush(), this.pushDelay);
  }

  async stats(): Promise<Stats> {
    return this.local.stats();
  }

  /** Stats du serveur, qui voit tous les appareils. `null` s'il est injoignable. */
  async serverStats(): Promise<Stats | null> {
    return this.client.stats().catch(() => null);
  }

  async flush(): Promise<void> {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    await this.local.flush();
    if (this.#sending) return this.#sending; // un seul envoi à la fois, sinon on double
    if (!this.#queue.length) return;
    this.#sending = this.#send().finally(() => (this.#sending = null));
    return this.#sending;
  }

  async #send(): Promise<void> {
    const batch = this.#queue.slice(0, Math.max(this.batch, 50));
    try {
      await this.client.push(batch);
      const sent = new Set(batch.map((e) => e.id));
      this.#queue = this.#queue.filter((e) => !sent.has(e.id));
      await this.#persistQueue();
      if (this.#queue.length) await this.#send(); // il en reste : on continue
    } catch {
      // échec réseau : la file reste sur le disque et repartira au prochain flush
      await this.#persistQueue();
    }
  }

  async #persistQueue(): Promise<void> {
    await this.local.store.save(this.#queueKey, this.#queue).catch(() => {});
  }

  /** Nombre d'événements pas encore acceptés par le serveur. */
  get pending(): number {
    return this.#queue.length;
  }
}

/** Texte brut d'une métadonnée, pour les embeddings côté serveur. */
function metaText(meta: unknown): string | undefined {
  if (typeof meta === 'string') return meta;
  if (!meta || typeof meta !== 'object') return undefined;
  const m = meta as Record<string, unknown>;
  const parts = [m.title, m.text, m.description, m.excerpt].filter((v): v is string => typeof v === 'string');
  return parts.length ? parts.join('\n').slice(0, 4000) : undefined;
}

export interface RecommenderConfig extends LocalOptions {
  /** absent = mode léger ; présent = mode complet */
  server?: HybridOptions['server'];
  deck?: string;
  batch?: number;
  pushDelay?: number;
  remoteTimeout?: number;
}

/**
 * Le point d'entrée d'une app.
 *
 * ```js
 * const brain = createRecommender({ key: 'liens' });                       // léger
 * const brain = createRecommender({ key: 'liens', server: { url, token } }); // complet
 * deck.setOptions({ advisor: brain });
 * ```
 *
 * Passer du léger au complet, c'est ajouter `server` — rien d'autre ne change dans l'app.
 */
export function createRecommender(config: RecommenderConfig = {}): Recommender {
  return config.server ? new HybridRecommender(config as HybridOptions) : new LocalRecommender(config);
}
