/**
 * PostgreSQL database connection pool
 */
import pg from 'pg';
import { env } from './env.js';
const { Pool } = pg;
export const pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});
pool.on('error', (err) => {
    console.error('Unexpected error on idle client', err);
    process.exit(-1);
});
pool.on('connect', () => {
    console.log('✅ Database connected');
});
export async function closeDatabasePool() {
    await pool.end();
    console.log('🔌 Database pool closed');
}
