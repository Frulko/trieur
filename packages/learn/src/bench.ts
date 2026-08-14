// Mesurer, plutôt que croire.
//
// Protocole : **prequential**, autrement dit tester-puis-apprendre. Chaque carte est
// d'abord soumise au modèle, qui ne l'a jamais vue ; on note s'il avait raison ; ensuite
// seulement il l'apprend. Aucune séparation train/test à bricoler, aucune fuite possible,
// et le chiffre obtenu est exactement ce que vit l'utilisateur : la justesse d'un modèle
// qui découvre le corpus au fil de l'eau.
//
// Les zones proposées sont celles **déjà rencontrées** — on ne demande pas au modèle de
// deviner un dossier qui n'existe pas encore.
//
// C'est exporté (`@trieur/learn/bench`) et pas seulement dans un script : le jour où tu
// hésites entre deux extracteurs de traits, la réponse doit venir de ton corpus, pas d'un
// tableau dans un README.

import { crosses, tokens, type Extractor } from './features.js';
import type { Model } from './types.js';

export interface Card {
  meta: unknown;
  target: string;
}

export interface Run {
  name: string;
  /** justesse de la première proposition */
  top1: number;
  /** la bonne zone est dans les trois premières */
  top3: number;
  /** proportion de cartes où le modèle a préféré se taire */
  silent: number;
  vocab: number;
  ms: number;
  asked: number;
}

/** L'extracteur avec croisements, celui de `defaultFeatures`. */
export const crossed: Extractor = (meta) =>
  crosses([
    ['domain', 'tag'],
    ['author', 'tag'],
    ['host', 'tag'],
  ])(tokens(meta));

export function evaluate(name: string, model: Model, extract: Extractor, cards: Card[]): Run {
  const seen = new Set<string>();
  let hit1 = 0;
  let hit3 = 0;
  let silent = 0;
  let asked = 0;
  const t0 = Date.now();

  for (const card of cards) {
    const features = extract(card.meta);
    // on ne juge le modèle que lorsqu'il a au moins deux zones où se tromper
    if (seen.size > 1) {
      asked++;
      const ranked = model.predict(features, [...seen]);
      if (!ranked.length) silent++;
      else {
        if (ranked[0]!.id === card.target) hit1++;
        if (ranked.slice(0, 3).some((r) => r.id === card.target)) hit3++;
      }
    }
    model.learn(features, card.target);
    seen.add(card.target);
  }

  return {
    name,
    top1: asked ? hit1 / asked : 0,
    top3: asked ? hit3 / asked : 0,
    silent: asked ? silent / asked : 0,
    vocab: (model as Model & { vocabSize?: number }).vocabSize ?? 0,
    ms: Date.now() - t0,
    asked,
  };
}

// --- corpus synthétique -------------------------------------------------------
//
// Fabriqué pour ressembler à un vrai flux de rangement, avec les trois régimes qu'on
// rencontre : des domaines qui partent toujours au même endroit (signal marginal), des
// couples domaine × tag qui décident sans que rien ne le laisse deviner trait par trait
// (interaction), et un tirage sur dix qui part ailleurs (bruit). Sans le régime
// d'interaction, tous les modèles se valent et le banc ne prouve rien.

export interface SynthCard extends Card {
  meta: { domain: string; tag: string[]; title: string };
}

/** PRNG déterministe : deux exécutions donnent le même corpus, donc des chiffres comparables. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DOMAINS = ['github.com', 'x.com', 'youtube.com', 'medium.com', 'reddit.com', 'arxiv.org'];
const TAGS = ['rust', 'js', 'css', 'ml', 'cuisine', 'photo', 'diy', 'finance', 'jeux', 'vélo', 'jardin', 'droit'];
const ZONES = ['dev', 'ia', 'design', 'perso', 'maison', 'veille', 'à-lire', 'archive'];
const WORDS = 'guide tutoriel retour outil rapide comparatif introduction avancé pratique note fiche méthode astuce panorama'.split(' ');

export function synth(n = 2000, seed = 7): SynthCard[] {
  const rnd = mulberry32(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;

  const table = new Map<string, string>();
  for (const d of DOMAINS) for (const t of TAGS) table.set(`${d}|${t}`, pick(ZONES));
  const marginal = new Map<string, string>([
    ['arxiv.org', 'ia'],
    ['reddit.com', 'veille'],
  ]);

  return Array.from({ length: n }, () => {
    const domain = pick(DOMAINS);
    const tag = pick(TAGS);
    const truth = marginal.get(domain) ?? table.get(`${domain}|${tag}`)!;
    const target = rnd() < 0.1 ? pick(ZONES) : truth;
    // le titre parle du sujet, jamais de la zone : y glisser la réponse rendrait le banc
    // flatteur et inutile
    const title = [tag, ...Array.from({ length: 4 }, () => pick(WORDS))].join(' ');
    return { meta: { domain, tag: [tag, pick(TAGS)], title }, target };
  });
}
