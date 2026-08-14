// Le protocole entre une app et un serveur trieur.
//
// Un seul fichier, importé des deux côtés : le client (`remote.ts`) et le serveur
// (`@trieur/server`) ne peuvent pas diverger sans que TypeScript le dise.
//
// Deux décisions structurantes :
//
// - **Un événement porte un `id`.** Le client peut rejouer sa file après une coupure
//   réseau sans risquer d'apprendre deux fois le même rangement : le serveur ignore un id
//   déjà vu. Sans ça, une seule reconnexion malheureuse fausse durablement le modèle.
// - **Un événement porte les traits *et* le texte.** Les traits suffisent aux modèles
//   creux ; le texte ne sert qu'aux embeddings, côté serveur. Le transporter dès
//   maintenant évite d'avoir à changer le protocole le jour où on branche un modèle
//   vectoriel — et il reste facultatif.

import type { Feature, ModelJSON, Ranked, Stats } from './types.js';

export const API_VERSION = 'v1';

export interface SortEvent {
  /** identifiant unique, généré par le client — c'est lui qui rend le rejeu inoffensif */
  id: string;
  features: Feature[];
  target: string;
  /** négatif = annulation */
  weight: number;
  at: number;
  /** ce que le modèle avait proposé, pour mesurer sa justesse côté serveur */
  predicted?: string | null;
  /** texte brut de la carte, pour les embeddings ; facultatif */
  text?: string;
}

export interface PushRequest {
  events: SortEvent[];
}
export interface PushResponse {
  accepted: number;
  /** ignorés parce que déjà vus */
  duplicates: number;
  version: number;
}

export interface ModelResponse {
  version: number;
  /** null quand le client est déjà à jour (`?since=`) */
  model: ModelJSON | null;
  stats: Stats;
}

export interface PredictRequest {
  features: Feature[];
  targets: string[];
  text?: string;
}
export interface PredictResponse {
  ranked: Ranked[];
  /** quels modèles ont voté : `linear+knn+embed` */
  source: string;
}

export interface ErrorResponse {
  error: string;
}

/** Les routes, construites au même endroit des deux côtés. */
export const routes = {
  events: (deck: string) => `/${API_VERSION}/decks/${encodeURIComponent(deck)}/events`,
  model: (deck: string) => `/${API_VERSION}/decks/${encodeURIComponent(deck)}/model`,
  predict: (deck: string) => `/${API_VERSION}/decks/${encodeURIComponent(deck)}/predict`,
  stats: (deck: string) => `/${API_VERSION}/decks/${encodeURIComponent(deck)}/stats`,
};

/** Identifiant d'événement. `crypto.randomUUID` partout où il existe, repli sinon. */
export function eventId(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
