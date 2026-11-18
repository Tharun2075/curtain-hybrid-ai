// Key map store: placeholder -> original value, per thread, in this browser's
// IndexedDB only. It is never sent to Firestore or to any model.
// Copyright 2026 Agri Group. Licensed under the Apache License, Version 2.0.
import type { KeyMap } from './masker';

const DB_NAME = 'curtain-keymaps';
const STORE = 'maps';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'threadId' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        t.oncomplete = () => {
          db.close();
          resolve(req.result);
        };
        t.onerror = () => reject(t.error);
      }),
  );
}

export async function loadMap(threadId: string): Promise<KeyMap> {
  const row = (await tx('readonly', (s) => s.get(threadId))) as { map: KeyMap } | undefined;
  return row?.map ?? {};
}

export async function saveMap(threadId: string, map: KeyMap): Promise<void> {
  await tx('readwrite', (s) => s.put({ threadId, map, updatedAt: Date.now() }));
}

export async function clearAllMaps(): Promise<void> {
  await tx('readwrite', (s) => s.clear());
}

export async function countMaps(): Promise<number> {
  return tx('readonly', (s) => s.count());
}
