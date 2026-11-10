import { dayKey, defaultProfile } from './domain.js';

export class LocalDB {
  constructor(name = `ritm-v1:${new URL('.', location.href).pathname}`) { this.name = name; }
  async open() {
    if (!globalThis.indexedDB) throw new Error('IndexedDB недоступен. Откройте приложение в обычном Safari, не в приватной вкладке.');
    this.db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(this.name, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore('settings', { keyPath: 'key' });
        const sessions = db.createObjectStore('sessions', { keyPath: 'id' });
        sessions.createIndex('started', 'started');
        const diary = db.createObjectStore('diary', { keyPath: 'id' });
        diary.createIndex('dayKey', 'dayKey', { unique: true });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Закройте другие вкладки «Ритма» и повторите открытие.'));
    });
    this.db.onversionchange = () => { this.db.close(); this.onVersionChange?.(); };
    const current = await this.read();
    if (!current.profile) await this.commit({ profile: defaultProfile() });
    return this;
  }
  async read() {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['settings', 'sessions', 'diary'], 'readonly');
      const p = tx.objectStore('settings').get('profile');
      const s = tx.objectStore('sessions').getAll();
      const d = tx.objectStore('diary').getAll();
      tx.oncomplete = () => {
        const profile = p.result ? { ...p.result } : null; if (profile) delete profile.key;
        resolve({ profile, sessions: s.result.sort((a, b) => b.started.localeCompare(a.started)), diary: d.result.sort((a, b) => b.day.localeCompare(a.day)) });
      };
      tx.onerror = tx.onabort = () => reject(tx.error || new Error('Не удалось прочитать локальную базу.'));
    });
  }
  async commit({ profile, sessions = [], diary = [] }) {
    return new Promise((resolve, reject) => {
      let tx;
      try { tx = this.db.transaction(['settings', 'sessions', 'diary'], 'readwrite', { durability: 'strict' }); }
      catch { tx = this.db.transaction(['settings', 'sessions', 'diary'], 'readwrite'); }
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(tx.error || new Error('Сохранение не выполнено. Проверьте свободное место.'));
      try {
        if (profile) tx.objectStore('settings').put({ ...profile, key: 'profile' });
        for (const s of sessions) tx.objectStore('sessions').put(s);
        for (const d of diary) tx.objectStore('diary').put({ ...d, dayKey: dayKey(d.day) });
      } catch (error) { tx.abort(); reject(error); }
    });
  }
  close() { this.db?.close(); }
}
