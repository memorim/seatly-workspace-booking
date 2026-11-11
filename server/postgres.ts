import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync } from 'node:fs';
import pg, { type PoolClient, type QueryResultRow } from 'pg';
import { createDatabase } from './db.js';

export function postgresOptions(connectionString: string) {
  const url = new URL(connectionString);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  for (const name of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'ssl'])
    url.searchParams.delete(name);
  return {
    connectionString: url.href,
    ssl: local ? false : { rejectUnauthorized: true },
    max: 4,
    connectionTimeoutMillis: 15000,
    statement_timeout: 15000,
    types: {
      getTypeParser(oid: number) {
        return oid === 20 ? Number : pg.types.getTypeParser(oid);
      },
    },
  };
}

export function postgresStore(connectionString: string) {
  const pool = new pg.Pool(postgresOptions(connectionString));
  const context = new AsyncLocalStorage<PoolClient>();
  pool.on('error', () => console.error({ event: 'database_unavailable' }));
  const store = {
    async query<T extends QueryResultRow = QueryResultRow>(sql: string, values: unknown[] = []) {
      return (context.getStore() || pool).query<T>(sql, values);
    },
    async transaction<T>(fn: () => Promise<T>): Promise<T> {
      if (context.getStore()) return fn();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(73194012)');
        const value = await context.run(client, fn);
        await client.query('COMMIT');
        return value;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
  return store;
}
export type PostgresStore = ReturnType<typeof postgresStore>;

export async function initializePostgres(db: PostgresStore) {
  await db.transaction(async () => {
    await db.query(readFileSync(new URL('./postgres.sql', import.meta.url), 'utf8'));
    const count = await db.query('SELECT COUNT(*) n FROM spaces');
    if (Number(count.rows[0].n) === 0) {
      // Reuse only the public catalog, never local demo accounts or bookings.
      const source = createDatabase(':memory:');
      try {
        for (const row of source.prepare('SELECT * FROM spaces').all()) {
          const keys = Object.keys(row);
          await db.query(
            `INSERT INTO spaces (${keys.join(',')}) VALUES (${keys.map((_, i) => '$' + (i + 1)).join(',')})`,
            Object.values(row),
          );
        }
      } finally {
        source.close();
      }
    }
  });
}
