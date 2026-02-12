#!/usr/bin/env node
/**
 * Simple SQL migration runner
 */
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import dotenv from 'dotenv';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Load environment variables
dotenv.config({ path: join(__dirname, '../../.env') });
const { Pool } = pg;
async function runMigrations() {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
    });
    try {
        console.log('🔄 Running migrations...');
        // Create migrations tracking table if it doesn't exist
        await pool.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        applied_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
        // Get already applied migrations
        const appliedResult = await pool.query('SELECT name FROM migrations ORDER BY name');
        const appliedMigrations = new Set(appliedResult.rows.map(r => r.name));
        // Read migration files
        const migrationsDir = join(__dirname, '../../migrations');
        const files = readdirSync(migrationsDir)
            .filter(f => f.endsWith('.sql'))
            .sort();
        let appliedCount = 0;
        for (const file of files) {
            if (appliedMigrations.has(file)) {
                console.log(`✓ ${file} (already applied)`);
                continue;
            }
            console.log(`📝 Applying ${file}...`);
            const sql = readFileSync(join(migrationsDir, file), 'utf-8');
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                await client.query(sql);
                await client.query('INSERT INTO migrations (name) VALUES ($1)', [file]);
                await client.query('COMMIT');
                console.log(`✅ ${file} applied successfully`);
                appliedCount++;
            }
            catch (error) {
                await client.query('ROLLBACK');
                throw error;
            }
            finally {
                client.release();
            }
        }
        if (appliedCount === 0) {
            console.log('✨ All migrations up to date!');
        }
        else {
            console.log(`✨ Applied ${appliedCount} migration(s)`);
        }
    }
    catch (error) {
        console.error('❌ Migration failed:', error);
        process.exit(1);
    }
    finally {
        await pool.end();
    }
}
runMigrations();
