import { expect, test } from 'bun:test';
import { Bayes } from './bayes.js';
import { Ensemble } from './ensemble.js';
import { crosses, tokens } from './features.js';
import { Knn } from './knn.js';
import { Linear } from './linear.js';
import { modelFromJSON } from './models.js';
import type { Feature, Model, Ranked } from './types.js';

const ZONES = ['z1', 'z2'];

/** Jeu de données à interaction pure : la zone dépend de la *combinaison*, jamais d'un
 *  trait pris seul. Chaque trait isolé apparaît autant de fois dans les deux zones. */
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

test('Bayes : apprend, propose, explique', () => {
  const b = new Bayes({ minExamples: 3 });
  expect(b.predict(tokens({ tag: ['react'] }), ['dev', 'cuisine'])).toEqual([]); // trop tôt pour parler

  b.learn(tokens({ tag: ['react'], domain: 'github.com' }), 'dev');
  b.learn(tokens({ tag: ['hooks'], domain: 'github.com' }), 'dev');
  b.learn(tokens({ tag: ['recette'], domain: 'marmiton.org' }), 'cuisine');
  b.learn(tokens({ tag: ['recette', 'four'], domain: 'marmiton.org' }), 'cuisine');

  const [top] = b.predict(tokens({ tag: ['react'], domain: 'github.com' }), ['dev', 'cuisine']);
  expect(top!.id).toBe('dev');
  expect(top!.score).toBeGreaterThan(0.9);
  expect(top!.why).toContain('domain:github.com'); // la proposition est justifiable
});

test('un trait jamais vu ne fait pas gagner une zone vierge', () => {
  for (const model of [new Bayes({ minExamples: 3 }), new Linear({ minExamples: 3 })] as Model[]) {
    for (let i = 0; i < 4; i++) model.learn(tokens({ tag: ['x'], domain: 'x.com', title: `tweet ${i}` }), 'keep');
    const zones = ['keep', 'ui', 'jamais-servi'];
    // titre entièrement nouveau, seul le domaine est connu : ça doit suffire
    const [top] = model.predict(tokens({ tag: ['x'], domain: 'x.com', title: 'un intitulé inédit' }), zones);
    expect(top!.id).toBe('keep');
    // aucune correspondance du tout → le modèle se tait au lieu d'inventer
    expect(model.predict(tokens({ tag: ['jardin'], domain: 'rustica.fr' }), zones)).toEqual([]);
  }
});

test('interaction : ni Bayes ni le linéaire ne s\'en sortent sur les traits bruts', () => {
  for (const model of [new Bayes(), new Linear()] as Model[]) {
    const trained = train(model, tokens);
    const [top] = trained.predict(tokens({ domain: 'a.com', tag: ['x'] }), ZONES);
    // chaque trait isolé vote exactement pareil des deux côtés : c'est un pile ou face
    expect(top!.score).toBeLessThan(0.75);
  }
});

test('interaction : le croisement de traits la rend visible, sans changer de modèle', () => {
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

test('kNN : répond dès la première carte, là où Bayes se tait encore', () => {
  const knn = new Knn();
  const bayes = new Bayes({ minExamples: 3 });
  const meta = tokens({ domain: 'github.com', tag: ['rust'] });
  knn.learn(meta, 'dev');
  bayes.learn(meta, 'dev');
  expect(bayes.predict(meta, ['dev', 'perso'])).toEqual([]);
  const [top] = knn.predict(tokens({ domain: 'github.com', tag: ['rust', 'cli'] }), ['dev', 'perso']);
  expect(top!.id).toBe('dev');
  expect(top!.why.length).toBeGreaterThan(0); // il montre ce qu'il a reconnu
});

test('kNN : le tampon circulaire borne la mémoire', () => {
  const knn = new Knn({ capacity: 10 });
  for (let i = 0; i < 50; i++) knn.learn([`tag:t${i}`], 'z');
  expect((knn.toJSON().rows as unknown[]).length).toBe(10);
  expect(knn.predict(['tag:t0'], ['z'])).toEqual([]); // sorti du tampon, oublié
  expect(knn.predict(['tag:t49'], ['z'])[0]?.id).toBe('z');
});

test('annuler un rangement le désapprend', () => {
  for (const model of [new Bayes({ minExamples: 1 }), new Knn()] as Model[]) {
    model.learn(['tag:x'], 'a');
    model.learn(['tag:x'], 'a');
    const before = model.predict(['tag:x'], ['a', 'b'])[0]!.score;
    model.learn(['tag:x'], 'a', -1);
    const after = model.predict(['tag:x'], ['a', 'b'])[0]?.score ?? 0;
    expect(after).toBeLessThanOrEqual(before);
  }
});

test('ensemble : le poids suit la justesse mesurée', () => {
  /** Un membre volontairement idiot : il vote toujours pour la première zone. */
  class Idiot implements Model {
    readonly kind = 'idiot';
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
  const e = new Ensemble([bayes, new Idiot()]);
  // un flux où la première zone est presque toujours la mauvaise réponse
  for (let i = 0; i < 30; i++) e.learn(tokens({ tag: ['b'] }), 'zb');
  for (let i = 0; i < 5; i++) e.learn(tokens({ tag: ['a'] }), 'za');
  expect(e.weights.bayes).toBeGreaterThan(e.weights.idiot!);
  expect(e.stats().members!.bayes).toBeGreaterThan(0.5);
});

test('aller-retour JSON pour chaque modèle', () => {
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
