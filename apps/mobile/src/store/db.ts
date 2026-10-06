/**
 * OpenRator — expo-sqlite bootstrap. Thin adapter so DAOs stay testable
 * against any SqlDb-compatible fake. The API key NEVER touches SQLite.
 */

import * as SQLite from 'expo-sqlite';
import { SQLITE_DB_NAME } from '../core/config';

export interface SqlDb {
  execAsync(sql: string): Promise<void>;
  runAsync(
    sql: string,
    ...params: (string | number | null)[]
  ): Promise<{ lastInsertRowId?: number; changes?: number }>;
  getAllAsync<T>(sql: string, ...params: (string | number | null)[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, ...params: (string | number | null)[]): Promise<T | null>;
  closeAsync(): Promise<void>;
}

export async function openDb(): Promise<SqlDb> {
  const db = await SQLite.openDatabaseAsync(SQLITE_DB_NAME);
  await db.execAsync('PRAGMA journal_mode = WAL;');
  await db.execAsync('PRAGMA synchronous = NORMAL;');
  const adapter: SqlDb = {
    execAsync: (sql) => db.execAsync(sql),
    runAsync: (sql, ...params) => db.runAsync(sql, ...params),
    getAllAsync: (sql, ...params) => db.getAllAsync(sql, ...params),
    getFirstAsync: (sql, ...params) => db.getFirstAsync(sql, ...params),
    closeAsync: () => db.closeAsync(),
  };
  return adapter;
}