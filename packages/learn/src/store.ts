// Où vit le modèle en mode léger.
//
// Trois implémentations, une interface. `autoStore()` prend la meilleure disponible.
//
// Pourquoi IndexedDB par défaut plutôt que localStorage : localStorage plafonne autour de
// 5 Mo, et surtout il est **synchrone** — chaque écriture bloque le fil principal, en
// plein tri. Un corpus kNN de quinze cents cartes plus un vocabulaire croisé passe
// largement la limite. localStorage reste parfait pour un modèle Bayes seul.

export interface Store {
  load<T>(key: string): Promise<T | null>;
  save(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
}

export function memoryStore(): Store {
  const map = new Map<string, string>();
  return {
    async load<T>(key: string) {
      const raw = map.get(key);
      return raw ? (JSON.parse(raw) as T) : null;
    },
    async save(key, value) {
      map.set(key, JSON.stringify(value));
    },
    async remove(key) {
      map.delete(key);
    },
  };
}

export function localStore(prefix = 'trieur:'): Store {
  return {
    async load<T>(key: string) {
      const raw = localStorage.getItem(prefix + key);
      return raw ? (JSON.parse(raw) as T) : null;
    },
    async save(key, value) {
      localStorage.setItem(prefix + key, JSON.stringify(value));
    },
    async remove(key) {
      localStorage.removeItem(prefix + key);
    },
  };
}

export function idbStore(dbName = 'trieur', storeName = 'models'): Store {
  let opening: Promise<IDBDatabase> | null = null;
  const db = () =>
    (opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(dbName, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(storeName);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }));

  const run = async <T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> => {
    const d = await db();
    return new Promise<T>((resolve, reject) => {
      const tx = d.transaction(storeName, mode);
      const req = fn(tx.objectStore(storeName));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => reject(req.error);
    });
  };

  return {
    async load<T>(key: string) {
      return (await run<T | undefined>('readonly', (s) => s.get(key))) ?? null;
    },
    async save(key, value) {
      // IndexedDB stocke la structure telle quelle (structured clone) : pas de JSON.stringify,
      // donc pas de copie texte de plusieurs mégaoctets à chaque sauvegarde
      await run('readwrite', (s) => s.put(value, key));
    },
    async remove(key) {
      await run('readwrite', (s) => s.delete(key));
    },
  };
}

/** IndexedDB si disponible, sinon localStorage, sinon la mémoire. */
export function autoStore(): Store {
  try {
    if (typeof indexedDB !== 'undefined') return idbStore();
    if (typeof localStorage !== 'undefined') return localStore();
  } catch {
    // navigation privée, contexte sans origine, extension sans permission…
  }
  return memoryStore();
}
