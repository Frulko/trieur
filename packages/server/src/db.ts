// Le stockage : SQLite, une base par serveur, un modèle par deck.
//
// Ce que le serveur garde, et pourquoi :
//
// - **les événements**, pas seulement le modèle. Un modèle en ligne ne se ré-entraîne pas
//   à l'envers : si on change d'extracteur de traits, de modèle ou d'hyperparamètre, la
//   seule façon d'en profiter sur l'historique est de **rejouer** les événements. C'est ce
//   qui rend l'échelle franchissable après coup au lieu d'être un choix définitif.
// - **le modèle sérialisé**, pour ne pas rejouer à chaque démarrage.
// - **les vecteurs**, pour ne pas repayer un appel d'embedding déjà fait.

import { Database } from 'bun:sqlite';
import type { SortEvent } from '@trieur/learn';

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
  // INSERT OR IGNORE : rejouer une file après une coupure réseau n'apprend rien deux fois.
  // C'est la seule protection qui compte — un événement appris en double fausse le modèle
  // durablement et silencieusement.
  const res = db
    .query(
      `INSERT OR IGNORE INTO events (id, deck, features, target, weight, at, predicted, text, seq)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM events WHERE deck = ?))`,
    )
    .run(e.id, deck, JSON.stringify(e.features), e.target, e.weight, e.at, e.predicted ?? null, e.text ?? null, deck);
  return res.changes > 0;
}

/** Les événements d'un deck, dans l'ordre où ils ont été rangés — l'ordre compte pour un
 *  modèle en ligne. */
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
