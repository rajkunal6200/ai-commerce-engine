import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.ts';

declare global {
  var _postgresPool: Pool | undefined;
}

export const createPool = () => {
  if (!global._postgresPool) {
    global._postgresPool = new Pool({
      host: process.env.SQL_HOST,
      user: process.env.SQL_USER,
      password: process.env.SQL_PASSWORD,
      database: process.env.SQL_DB_NAME,
      max: 10,
      min: 0,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 5000,
      allowExitOnIdle: true
    });

    global._postgresPool.on('error', (err: any) => {
      const errMsg = err?.message || String(err);
      const isIdleTermination =
        err?.code === '57P01' ||
        errMsg.includes('terminating connection due to administrator command') ||
        err?.code === 'ECONNRESET' ||
        err?.code === 'EPIPE';

      if (isIdleTermination) {
        // Expected lifecycle event in serverless / scale-to-zero Cloud SQL environments.
        // Node-pg automatically cleans up the closed connection and provisions fresh ones on subsequent queries.
        console.log(`[SQL Pool] Idle connection released (${err?.code || 'server closed idle connection'}). New connections will initialize on demand.`);
        return;
      }
      console.warn('[SQL Pool] Notice on pool client:', errMsg);
    });
  }
  return global._postgresPool;
};

const pool = createPool();

export const db = drizzle(pool, { schema });
