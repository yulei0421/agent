const DB_NAME = 'deepseek-agent-demo';
const DB_VERSION = 1;
const stores = ['users', 'sessions', 'messages', 'offlineQueue'];
export type AppStore = typeof stores[number];

let dbPromise: Promise<IDBDatabase> | undefined;

export function openAppDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of stores) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

async function tx(store: AppStore, mode: IDBTransactionMode = 'readonly'): Promise<IDBObjectStore> {
  const db = await openAppDb();
  return db.transaction(store, mode).objectStore(store);
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getAll<T>(store: AppStore): Promise<T[]> {
  return requestToPromise((await tx(store)).getAll() as IDBRequest<T[]>);
}

export async function put<T>(store: AppStore, value: T): Promise<IDBValidKey> {
  return requestToPromise((await tx(store, 'readwrite')).put(value));
}

export async function remove(store: AppStore, id: IDBValidKey): Promise<undefined> {
  return requestToPromise((await tx(store, 'readwrite')).delete(id));
}

export async function clear(store: AppStore): Promise<undefined> {
  return requestToPromise((await tx(store, 'readwrite')).clear());
}

export const now = () => new Date().toISOString();
export const id = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
