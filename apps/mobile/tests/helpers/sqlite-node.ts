/**
 * Test helpers for fixture-driven E2E (M5.4): real SQLite via node:sqlite.
 * Kept separate from the engine tests so scenario suites can share it.
 */

import { DatabaseSync } from 'node:sqlite';
import { SqlDb } from '../../src/store/db';

export class NodeSqlite implements SqlDb {
  private readonly db: DatabaseSync;
  constructor() {
    this.db = new DatabaseSync(':memory:');
  }
  async execAsync(sql: string): Promise<void> {
    this.db.exec(sql);
  }
  async runAsync(
    sql: string,
    ...params: (string | number | null)[]
  ): Promise<{ lastInsertRowId?: number; changes?: number }> {
    const st = this.db.prepare(sql);
    const r = st.run(...params.map((p) => (p === undefined ? null : p)));
    return { lastInsertRowId: r.lastInsertRowid as number | undefined, changes: r.changes as number };
  }
  async getAllAsync<T>(sql: string, ...params: (string | number | null)[]): Promise<T[]> {
    return this.db.prepare(sql).all(...params) as T[];
  }
  async getFirstAsync<T>(sql: string, ...params: (string | number | null)[]): Promise<T | null> {
    const row = this.db.prepare(sql).get(...params);
    return row === undefined ? null : (row as T);
  }
  async closeAsync(): Promise<void> {
    this.db.close();
  }
}

export interface FakeRes {
  status: number;
  headers: { get(name: string): string | null };
  json: () => Promise<unknown>;
}

export const jsonRes = (body: unknown, status = 200): FakeRes => ({
  status,
  headers: { get: () => null },
  json: async () => body,
});
