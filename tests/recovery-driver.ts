import { app } from 'electron';
import { Store } from '../db/database';
import { seed } from '../db/seed';
import { authenticateBackupOwner } from '../electron/recovery';
import { join } from 'node:path';
app
  .whenReady()
  .then(async () => {
    const path = join(process.env.POS_DATA_DIR!, 'backup.db');
    const store = new Store(path);
    seed(store, true);
    store.close();
    const allowed = await authenticateBackupOwner(path);
    if (!allowed) throw new Error('recoveryRejected');
    app.quit();
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
