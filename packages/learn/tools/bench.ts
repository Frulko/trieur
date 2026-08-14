#!/usr/bin/env bun
//
// The bench, as a command line. All the computation lives in `src/bench.ts` (exported as
// `@trieur/learn/bench`); this file only reads the corpus and prints the table.
//
//   bun tools/bench.ts                     # synthetic corpus
//   bun tools/bench.ts corpus.jsonl        # yours: {"meta": {...}, "target": "…"}
//   bun tools/bench.ts corpus.jsonl 500    # the first 500 cards

import { readFileSync } from 'node:fs';
import { Bayes } from '../src/bayes.js';
import { crossed, evaluate, synth, type Card, type Run } from '../src/bench.js';
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
console.log(`\n${cards.length} cards, ${new Set(cards.map((c) => c.target)).size} zones — ${path ?? 'synthetic corpus'}\n`);

const suites: Array<[string, () => Model, Extractor]> = [
  ['bayes', () => new Bayes(), tokens],
  ['bayes + crosses', () => new Bayes(), crossed],
  ['linear', () => new Linear(), tokens],
  ['linear + crosses', () => new Linear(), crossed],
  ['knn', () => new Knn(), tokens],
  ['knn + crosses', () => new Knn(), crossed],
  ['ensemble', () => new Ensemble([new Bayes(), new Linear(), new Knn()]), tokens],
  ['ensemble + crosses', () => new Ensemble([new Bayes(), new Linear(), new Knn()]), crossed],
];

const runs: Run[] = suites.map(([name, make, extract]) => evaluate(name, make(), extract, cards));
const best = Math.max(...runs.map((r) => r.top1));

console.log('model                  top-1     top-3   silent    vocab      ms');
console.log('─'.repeat(68));
for (const r of runs) {
  console.log(
    `${r.name.padEnd(20)} ${pct(r.top1)}   ${pct(r.top3)}   ${pct(r.silent)}  ${String(r.vocab).padStart(6)}  ${String(r.ms).padStart(6)}${r.top1 === best ? ' ←' : ''}`,
  );
}
console.log();
