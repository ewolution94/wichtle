// The groups on disk: one SQLite file on the stack's /data volume (node:sqlite, no dependency).
//
// One row per group with the group as JSON (its people, households, draw and log), the hash and salt
// of the host's unseal code, and when it's deleted; and one row per key (the group link, the host
// link, each personal link), so a key finds its group and what it may do. `secure_delete` overwrites
// deleted rows, so a deleted group's names and addresses don't linger in free pages.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY,
    doc TEXT NOT NULL,
    salt TEXT NOT NULL,
    hash TEXT NOT NULL,
    practice INTEGER NOT NULL DEFAULT 0,
    deleteAt INTEGER NOT NULL,
    version INTEGER NOT NULL DEFAULT 0,
    created INTEGER NOT NULL,
    updated INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS groups_delete ON groups (deleteAt);
  CREATE TABLE IF NOT EXISTS keys (
    key TEXT PRIMARY KEY,
    grp INTEGER NOT NULL,
    kind TEXT NOT NULL,
    person TEXT
  ) WITHOUT ROWID;
  CREATE INDEX IF NOT EXISTS keys_group ON keys (grp);
`;

export function openStore(file) {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 2000; PRAGMA synchronous = NORMAL; PRAGMA secure_delete = ON;');
  db.exec(SCHEMA);

  const q = {
    group: db.prepare('SELECT id, doc, salt, hash, practice, deleteAt, version FROM groups WHERE id = ?'),
    key: db.prepare('SELECT key, grp, kind, person FROM keys WHERE key = ?'),
    keysOf: db.prepare('SELECT key, kind, person FROM keys WHERE grp = ?'),
    insert: db.prepare('INSERT INTO groups (doc, salt, hash, practice, deleteAt, version, created, updated) VALUES (?, ?, ?, ?, ?, 0, ?, ?)'),
    save: db.prepare('UPDATE groups SET doc = ?, version = ?, deleteAt = ?, updated = ? WHERE id = ?'),
    code: db.prepare('UPDATE groups SET salt = ?, hash = ? WHERE id = ?'),
    addKey: db.prepare('INSERT INTO keys (key, grp, kind, person) VALUES (?, ?, ?, ?)'),
    dropKey: db.prepare('DELETE FROM keys WHERE key = ?'),
    dropPersonKeys: db.prepare("DELETE FROM keys WHERE grp = ? AND kind = 'p' AND person = ?"),
    dropHostKeys: db.prepare("DELETE FROM keys WHERE grp = ? AND kind = 'h'"),
    dropGroup: db.prepare('DELETE FROM groups WHERE id = ?'),
    dropGroupKeys: db.prepare('DELETE FROM keys WHERE grp = ?'),
    due: db.prepare('SELECT id FROM groups WHERE deleteAt <= ?'),
    practice: db.prepare('SELECT id FROM groups WHERE practice = 1'),
    count: db.prepare('SELECT COUNT(*) AS n FROM groups'),
  };

  const row = (r) =>
    r ? { id: r.id, doc: JSON.parse(r.doc), salt: r.salt, hash: r.hash, practice: !!r.practice, deleteAt: r.deleteAt, version: r.version } : null;

  const tx = (fn) => {
    db.exec('BEGIN');
    try {
      const out = fn();
      db.exec('COMMIT');
      return out;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  };

  return {
    get: (id) => row(q.group.get(id)),
    /** What a key opens: `{ grp, kind: 'g' | 'h' | 'p', person }`, or null. */
    key(key) {
      const r = q.key.get(key);
      return r ? { grp: r.grp, kind: r.kind, person: r.person ?? null } : null;
    },
    keysOf: (id) => q.keysOf.all(id).map((r) => ({ key: r.key, kind: r.kind, person: r.person ?? null })),
    /** A new group with its keys: `[{ key, kind, person? }]`. */
    create(doc, { salt, hash, practice, deleteAt }, keys) {
      return tx(() => {
        const now = Date.now();
        const { lastInsertRowid } = q.insert.run(JSON.stringify(doc), salt, hash, practice ? 1 : 0, deleteAt, now, now);
        const id = Number(lastInsertRowid);
        for (const k of keys) q.addKey.run(k.key, id, k.kind, k.person ?? null);
        return id;
      });
    },
    save: (id, doc, version, deleteAt) => q.save.run(JSON.stringify(doc), version, deleteAt, Date.now(), id),
    setCode: (id, salt, hash) => q.code.run(salt, hash, id),
    addKey: (key, id, kind, person = null) => q.addKey.run(key, id, kind, person),
    dropKey: (key) => q.dropKey.run(key),
    dropPersonKeys: (id, person) => q.dropPersonKeys.run(id, person),
    /** The host link changes: the old one stops working at once. */
    rekeyHost: (id, key) =>
      tx(() => {
        q.dropHostKeys.run(id);
        q.addKey.run(key, id, 'h', null);
      }),
    remove: (id) =>
      tx(() => {
        q.dropGroupKeys.run(id);
        q.dropGroup.run(id);
      }),
    /** Groups whose time is up. */
    due: (now) => q.due.all(now).map((r) => r.id),
    practiceGroups: () => q.practice.all().map((r) => r.id),
    count: () => q.count.get().n,
    /** Gives the deleted groups' pages back to the file system. */
    vacuum: () => db.exec('VACUUM'),
    close: () => db.close(),
  };
}
