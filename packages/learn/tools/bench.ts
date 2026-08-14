#!/usr/bin/env bun
//
// Le banc d'essai en ligne de commande. Tout le calcul vit dans `src/bench.ts` (exporté
// sous `@trieur/learn/bench`) : ici il n'y a que la lecture du fichier et le tableau.
//
//   bun tools/bench.ts                     # corpus synthétique
//   bun tools/bench.ts corpus.jsonl        # ton corpus : {"meta": {...}, "target": "…"}
//   bun tools/bench.ts corpus.jsonl 500    # les 500 premières cartes

import { readFileSync } from 'node:fs';
import { crossed, evaluate, synth, type Card, type Run } from '../src/bench.js';
import { Bayes } from '../src/bayes.js';
import { Ensemble } from '../src/ensemble.js';
import { tokens, type Extractor } from '../src/features.js';
import { Knn } from '../src/knn.js';
import { Linear } from '../src/linear.js';
import type { Model } from '../src/types.js';

function load(path: string | undefined, limit: number): Card[] {
  if (!path) return synth(limit || 2000);
  const cards = readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Card)
    .filter((c) => c?.meta && c?.target);
  return limit ? cards.slice(0, limit) : cards;
}

const pct = (x: number) => `${(x * 100).toFixed(1)} %`.padStart(7);

const [, , path, limitArg] = process.argv;
const cards = load(path, Number(limitArg ?? 0));
console.log(`\n${cards.length} cartes, ${new Set(cards.map((c) => c.target)).size} zones — ${path ?? 'corpus synthétique'}\n`);

const suites: Array<[string, () => Model, Extractor]> = [
  ['bayes', () => new Bayes(), tokens],
  ['bayes + croisés', () => new Bayes(), crossed],
  ['linéaire', () => new Linear(), tokens],
  ['linéaire + croisés', () => new Linear(), crossed],
  ['kNN', () => new Knn(), tokens],
  ['kNN + croisés', () => new Knn(), crossed],
  ['ensemble', () => new Ensemble([new Bayes(), new Linear(), new Knn()]), tokens],
  ['ensemble + croisés', () => new Ensemble([new Bayes(), new Linear(), new Knn()]), crossed],
];

const runs: Run[] = suites.map(([name, make, extract]) => evaluate(name, make(), extract, cards));
const best = Math.max(...runs.map((r) => r.top1));

console.log('modèle                 top-1     top-3     muet    vocab      ms');
console.log('─'.repeat(68));
for (const r of runs) {
  console.log(
    `${r.name.padEnd(20)} ${pct(r.top1)}   ${pct(r.top3)}   ${pct(r.silent)}  ${String(r.vocab).padStart(6)}  ${String(r.ms).padStart(6)}${r.top1 === best ? ' ←' : ''}`,
  );
}
console.log();
