import { readFileSync } from 'node:fs';
import { pool } from './db';
await pool.query(readFileSync(new URL('../sql/001.sql', import.meta.url), 'utf8'));
await pool.end();
console.log('Analytics schema applied.');
