// Storage: SQLite, one database per server, one model per deck.
//
// What the server keeps, and why:
//
// - **the events**, not just the model. An online model cannot be retrained backwards: if you
//   change feature extractor, model or hyperparameter, the only way to benefit on past data is
//   to **replay** the events. That is what keeps the ladder climbable afterwards instead of
//   being a one-way decision.
// - **the serialised model**, so we do not replay on every boot.
// - **the vectors**, so we do not pay twice for an embedding call already made.

import type { SortEvent } from '@trieur/learn';
import { Database } from 'bun:sqlite';

export interface StoredEvent extends SortEvent {
  deck: string;
}

export function openDb(path = 'trieur.sqlite'): Database {
  const db = new Database(path, { create: true });
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id        TEXT PRIMARY KEY,
      deck      TEXT NOT NULL,
      features  TEXT NOT NULL,
      target    TEXT NOT NULL,
      weight    REAL NOT NULL DEFAULT 1,
      at        INTEGER NOT NULL,
      predicted TEXT,
      text      TEXT,
      seq       INTEGER
    );
    CREATE INDEX IF NOT EXISTS events_deck ON events(deck, seq);

    CREATE TABLE IF NOT EXISTS models (
      deck      TEXT PRIMARY KEY,
      version   INTEGER NOT NULL DEFAULT 0,
      json      TEXT NOT NULL,
      updatedAt INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS vectors (
      deck   TEXT NOT NULL,
      hash   TEXT NOT NULL,
      target TEXT NOT NULL,
      vec    BLOB NOT NULL,
      at     INTEGER NOT NULL,
      PRIMARY KEY (deck, hash)
    );
  `);
  return db;
}

export function insertEvent(db: Database, deck: string, e: SortEvent): boolean {
  // INSERT OR IGNORE: replaying a queue after a network outage learns nothing twice. This is
  // the only protection that matters — an event learned twice skews the model permanently and
  // silently.
  const res = db
    .query(
      `INSERT OR IGNORE INTO events (id, deck, features, target, weight, at, predicted, text, seq)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM events WHERE deck = ?))`,
    )
    .run(e.id, deck, JSON.stringify(e.features), e.target, e.weight, e.at, e.predicted ?? null, e.text ?? null, deck);
  return res.changes > 0;
}

/** A deck's events, in the order they were filed — order matters for an online model. */
export function readEvents(db: Database, deck: string): SortEvent[] {
  const rows = db
    .query(`SELECT id, features, target, weight, at, predicted, text FROM events WHERE deck = ? ORDER BY seq, at`)
    .all(deck) as Array<{
    id: string;
    features: string;
    target: string;
    weight: number;
    at: number;
    predicted: string | null;
    text: string | null;
  }>;
  return rows.map((r) => ({
    id: r.id,
    features: JSON.parse(r.features) as string[],
    target: r.target,
    weight: r.weight,
    at: r.at,
    predicted: r.predicted,
    ...(r.text ? { text: r.text } : {}),
  }));
}

export function readModel(db: Database, deck: string): { version: number; json: unknown } | null {
  const row = db.query(`SELECT version, json FROM models WHERE deck = ?`).get(deck) as
    | { version: number; json: string }
    | undefined;
  return row ? { version: row.version, json: JSON.parse(row.json) } : null;
}

export function writeModel(db: Database, deck: string, version: number, json: unknown): void {
  db.query(
    `INSERT INTO models (deck, version, json, updatedAt) VALUES (?, ?, ?, ?)
     ON CONFLICT(deck) DO UPDATE SET version = excluded.version, json = excluded.json, updatedAt = excluded.updatedAt`,
  ).run(deck, version, JSON.stringify(json), Date.now());
}

export function decks(db: Database): string[] {
  return (db.query(`SELECT DISTINCT deck FROM events`).all() as Array<{ deck: string }>).map((r) => r.deck);
}
