import pg from 'pg';
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  statement_timeout: 10000,
});
export async function transaction<T>(
  fn: (c: pg.PoolClient) => Promise<T>,
  storeId?: string,
  readOnly = false,
) {
  const c = await pool.connect();
  try {
    await c.query(readOnly ? 'BEGIN READ ONLY' : 'BEGIN');
    if (storeId) await c.query("SELECT set_config('app.store_id',$1,true)", [storeId]);
    const result = await fn(c);
    await c.query('COMMIT');
    return result;
  } catch (error) {
    await c.query('ROLLBACK');
    throw error;
  } finally {
    c.release();
  }
}
