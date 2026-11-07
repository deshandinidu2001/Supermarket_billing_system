import { app } from 'electron';
import assert from 'node:assert/strict';
import { mkdtempSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, today } from '../db/database';
import { seed } from '../db/seed';
import { CloudSync } from '../electron/cloud-sync';
const root = mkdtempSync(join(tmpdir(), 'ajith-cloud-worker-'));
app.setPath('userData', root);
async function run() {
  await app.whenReady();
  let store = new Store(join(root, 'test.db'));
  seed(store, true);
  let cloud = new CloudSync(store);
  const drain = async () => {
    for (let i = 0; i < 500; i++) {
      if (!cloud.status().pending && !cloud.status().busy) break;
      if (!cloud.status().busy) await cloud.tick(true);
      else await new Promise((r) => setTimeout(r, 20));
    }
    assert.equal(cloud.status().pending, 0, JSON.stringify(cloud.status()));
  };
  try {
    await cloud.enroll(process.env.ANALYTICS_URL!, process.env.ANALYTICS_ENROLLMENT!);
    await drain();
    await cloud.tick(true);
    assert.equal(cloud.status().needsRebuild, false, cloud.status().error ?? '');
    const backup = join(root, 'before.db');
    await store.db.backup(backup);
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error('Simulated offline connection');
    };
    store.insert('expenses', { date: today(), amount: 999, note: 'Offline worker test' });
    const pending = cloud.status().pending;
    await cloud.tick(true);
    assert.equal(cloud.status().pending, pending);
    assert.match(cloud.status().error ?? '', /offline/);
    globalThis.fetch = realFetch;
    await drain();
    await cloud.tick(true);
    assert.equal(cloud.status().needsRebuild, false);
    await cloud.stop(true);
    store.close();
    copyFileSync(backup, store.path);
    store = new Store(store.path);
    cloud = new CloudSync(store);
    for (let i = 0; i < 200 && !cloud.status().connected; i++)
      await new Promise((r) => setTimeout(r, 20));
    assert.equal(cloud.status().needsRebuild, true, 'restore pauses synchronization');
    await cloud.rebuild();
    await drain();
    await cloud.tick(true);
    assert.equal(cloud.status().needsRebuild, false, cloud.status().error ?? '');
    const onlineFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ error: 'Device revoked' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    await cloud.tick(true);
    assert.equal(cloud.status().connected, false, 'revocation exposes enrollment again');
    globalThis.fetch = onlineFetch;
    await cloud.disconnect();
    assert.equal(cloud.status().connected, false);
    await cloud.stop();
    store.close();
    console.log(
      'Cloud worker: OS-encrypted enrollment, upload, reconciliation, offline retry, restore pause/rebuild and revocation passed.',
    );
    app.quit();
  } catch (error) {
    console.error(error);
    await cloud.stop();
    if (store.db.open) store.close();
    app.exit(1);
  }
}
void run();
