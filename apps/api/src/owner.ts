import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { pool, transaction } from './db';
const email = process.env.OWNER_EMAIL?.trim().toLowerCase(),
  password = process.env.OWNER_PASSWORD;
if (!email || !password || password.length < 12)
  throw new Error('Set OWNER_EMAIL and OWNER_PASSWORD (at least 12 characters).');
await transaction(async (c) => {
  const owner = await c.query(
    'INSERT INTO owners(id,email,password_hash) VALUES($1,$2,$3) ON CONFLICT(email) DO UPDATE SET email=excluded.email RETURNING id',
    [randomUUID(), email, await bcrypt.hash(password, 12)],
  );
  if ((await c.query('SELECT 1 FROM memberships WHERE owner_id=$1', [owner.rows[0].id])).rowCount)
    return;
  const storeId = randomUUID();
  await c.query("SELECT set_config('app.store_id',$1,true)", [storeId]);
  await c.query('INSERT INTO stores(id,name) VALUES($1,$2)', [
    storeId,
    process.env.STORE_NAME || 'Ajith Super Market',
  ]);
  await c.query('INSERT INTO memberships VALUES($1,$2)', [owner.rows[0].id, storeId]);
});
await pool.end();
console.log('Owner and store are ready. Existing passwords are preserved.');
