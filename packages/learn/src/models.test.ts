import { expect, test } from 'bun:test';
import { Bayes } from './bayes.js';
import { Ensemble } from './ensemble.js';
import { crosses, tokens } from './features.js';
import { Knn } from './knn.js';
import { Linear } from './linear.js';
import { modelFromJSON } from './models.js';
import type { Feature, Model, Ranked } from './types.js';

const ZONES = ['z1', 'z2'];

/** A pure interaction dataset: the zone depends on the *combination*, never on a feature
 *  taken alone. Each isolated feature appears just as often in both zones. */
const XOR: Array<[Record<string, unknown>, string]> = [];
for (let i = 0; i < 5; i++) {
  XOR.push([{ domain: 'a.com', tag: ['x'] }, 'z1']);
  XOR.push([{ domain: 'a.com', tag: ['y'] }, 'z2']);
  XOR.push([{ domain: 'b.com', tag: ['x'] }, 'z2']);
  XOR.push([{ domain: 'b.com', tag: ['y'] }, 'z1']);
}

const train = (model: Model, extract: (m: unknown) => Feature[], passes = 3) => {
  for (let p = 0; p < passes; p++) for (const [meta, target] of XOR) model.learn(extract(meta), target);
  return model;
};

test('Bayes: learns, suggests, explains', () => {
  const b = new Bayes({ minExamples: 3 });
  expect(b.predict(tokens({ tag: ['react'] }), ['dev', 'cooking'])).toEqual([]); // too early to speak

  b.learn(tokens({ tag: ['react'], domain: 'github.com' }), 'dev');
  b.learn(tokens({ tag: ['hooks'], domain: 'github.com' }), 'dev');
  b.learn(tokens({ tag: ['recipe'], domain: 'seriouseats.com' }), 'cooking');
  b.learn(tokens({ tag: ['recipe', 'oven'], domain: 'seriouseats.com' }), 'cooking');

  const [top] = b.predict(tokens({ tag: ['react'], domain: 'github.com' }), ['dev', 'cooking']);
  expect(top!.id).toBe('dev');
  expect(top!.score).toBeGreaterThan(0.9);
  expect(top!.why).toContain('domain:github.com'); // the suggestion can be justified
});

test('a feature never seen must not hand the win to an untouched zone', () => {
  for (const model of [new Bayes({ minExamples: 3 }), new Linear({ minExamples: 3 })] as Model[]) {
    for (let i = 0; i < 4; i++) model.learn(tokens({ tag: ['x'], domain: 'x.com', title: `post ${i}` }), 'keep');
    const zones = ['keep', 'ui', 'never-used'];
    // a brand new title, only the domain is known: that has to be enough
    const [top] = model.predict(tokens({ tag: ['x'], domain: 'x.com', title: 'a wholly unseen headline' }), zones);
    expect(top!.id).toBe('keep');
    // no match at all → the model says nothing rather than inventing
    expect(model.predict(tokens({ tag: ['garden'], domain: 'gardenersworld.com' }), zones)).toEqual([]);
  }
});

test('interaction: neither Bayes nor the linear model cope on raw features', () => {
  for (const model of [new Bayes(), new Linear()] as Model[]) {
    const trained = train(model, tokens);
    const [top] = trained.predict(tokens({ domain: 'a.com', tag: ['x'] }), ZONES);
    // each isolated feature votes exactly the same on both sides: it is a coin flip
    expect(top!.score).toBeLessThan(0.75);
  }
});

test('interaction: crossing features exposes it, without changing model', () => {
  const extract = (m: unknown) => crosses([['domain', 'tag']])(tokens(m));
  for (const model of [new Bayes(), new Linear(), new Knn()] as Model[]) {
    const trained = train(model, extract);
    const [top] = trained.predict(extract({ domain: 'a.com', tag: ['x'] }), ZONES);
    expect(top!.id).toBe('z1');
    expect(top!.score).toBeGreaterThan(0.75);
    const [other] = trained.predict(extract({ domain: 'b.com', tag: ['x'] }), ZONES);
    expect(other!.id).toBe('z2');
  }
});

test('kNN: answers from the first card, where Bayes is still silent', () => {
  const knn = new Knn();
  const bayes = new Bayes({ minExamples: 3 });
  const meta = tokens({ domain: 'github.com', tag: ['rust'] });
  knn.learn(meta, 'dev');
  bayes.learn(meta, 'dev');
  expect(bayes.predict(meta, ['dev', 'personal'])).toEqual([]);
  const [top] = knn.predict(tokens({ domain: 'github.com', tag: ['rust', 'cli'] }), ['dev', 'personal']);
  expect(top!.id).toBe('dev');
  expect(top!.why.length).toBeGreaterThan(0); // it shows what it recognised
});

test('kNN: the ring buffer bounds the memory', () => {
  const knn = new Knn({ capacity: 10 });
  for (let i = 0; i < 50; i++) knn.learn([`tag:t${i}`], 'z');
  expect((knn.toJSON().rows as unknown[]).length).toBe(10);
  expect(knn.predict(['tag:t0'], ['z'])).toEqual([]); // out of the buffer, forgotten
  expect(knn.predict(['tag:t49'], ['z'])[0]?.id).toBe('z');
});

test('undoing a filing unlearns it', () => {
  for (const model of [new Bayes({ minExamples: 1 }), new Knn()] as Model[]) {
    model.learn(['tag:x'], 'a');
    model.learn(['tag:x'], 'a');
    const before = model.predict(['tag:x'], ['a', 'b'])[0]!.score;
    model.learn(['tag:x'], 'a', -1);
    const after = model.predict(['tag:x'], ['a', 'b'])[0]?.score ?? 0;
    expect(after).toBeLessThanOrEqual(before);
  }
});

test('ensemble: weight follows measured accuracy', () => {
  /** A deliberately useless member: it always votes for the first zone. */
  class Dunce implements Model {
    readonly kind = 'dunce';
    examples = 0;
    learn(): void {
      this.examples++;
    }
    predict(_f: Feature[], targets: string[]): Ranked[] {
      return targets.map((id, i) => ({ id, score: i === 0 ? 1 : 0, why: [] }));
    }
    toJSON() {
      return { kind: this.kind, v: 1 };
    }
  }
  const bayes = new Bayes({ minExamples: 1 });
  const e = new Ensemble([bayes, new Dunce()]);
  // a stream where the first zone is almost always the wrong answer
  for (let i = 0; i < 30; i++) e.learn(tokens({ tag: ['b'] }), 'zb');
  for (let i = 0; i < 5; i++) e.learn(tokens({ tag: ['a'] }), 'za');
  expect(e.weights.bayes).toBeGreaterThan(e.weights.dunce!);
  expect(e.stats().members!.bayes).toBeGreaterThan(0.5);
});

test('JSON round trip for every model', () => {
  const extract = (m: unknown) => crosses([['domain', 'tag']])(tokens(m));
  for (const model of [new Bayes(), new Linear(), new Knn(), new Ensemble([new Bayes(), new Linear(), new Knn()])]) {
    train(model, extract);
    const query = extract({ domain: 'a.com', tag: ['x'] });
    const before = model.predict(query, ZONES);
    const after = modelFromJSON(JSON.parse(JSON.stringify(model.toJSON()))).predict(query, ZONES);
    expect(after.map((r) => r.id)).toEqual(before.map((r) => r.id));
    expect(after[0]!.score).toBeCloseTo(before[0]!.score, 6);
  }
});
