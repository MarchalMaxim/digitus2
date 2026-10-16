import { isLocalScoreRecord, type LocalScoreRecord } from './records.js';

const DATABASE = 'digitus2.my-scores';
const TABLE = 'scores';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(TABLE, { keyPath: 'id' });
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Storage is busy in another tab.'));
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}

export class LocalScoreDatabase {
  private connection = open();

  async read(): Promise<LocalScoreRecord[]> {
    const db = await this.connection;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(TABLE, 'readonly');
      const request = transaction.objectStore(TABLE).getAll();
      transaction.oncomplete = () =>
        resolve((request.result as unknown[]).filter(isLocalScoreRecord));
      transaction.onerror = transaction.onabort = () => reject(transaction.error);
    });
  }

  async write(record: LocalScoreRecord | string): Promise<void> {
    const db = await this.connection;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(TABLE, 'readwrite');
      const table = transaction.objectStore(TABLE);
      if (typeof record === 'string') table.delete(record);
      else table.put(record);
      transaction.oncomplete = () => resolve();
      transaction.onerror = transaction.onabort = () => reject(transaction.error);
    });
  }
}
