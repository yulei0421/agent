const DB_NAME = 'deepseek-agent-demo';
const DB_VERSION = 1;
const stores = ['users', 'sessions', 'messages', 'offlineQueue'];

let dbPromise;

export function openAppDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
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

async function tx(store, mode = 'readonly') {
  const db = await openAppDb();
  return db.transaction(store, mode).objectStore(store);
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getAll(store) {
  return requestToPromise((await tx(store)).getAll());
}

export async function put(store, value) {
  return requestToPromise((await tx(store, 'readwrite')).put(value));
}

export async function remove(store, id) {
  return requestToPromise((await tx(store, 'readwrite')).delete(id));
}

export async function clear(store) {
  return requestToPromise((await tx(store, 'readwrite')).clear());
}

export const now = () => new Date().toISOString();
export const id = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
