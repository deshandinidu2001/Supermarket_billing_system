import { contextBridge, ipcRenderer } from 'electron';
import type { Action, Bridge, Input } from '../shared/contracts';
const actions = new Set([
  'login',
  'logout',
  'activity',
  'bootstrap',
  'changePassword',
  'language',
  'products',
  'saveProduct',
  'productDetails',
  'adjustStock',
  'batches',
  'list',
  'saveEntity',
  'deleteEntity',
  'purchase',
  'supplierPayment',
  'customerPayment',
  'customerHistory',
  'saveUser',
  'loadCart',
  'cartProducts',
  'saveCart',
  'holdCart',
  'resumeCart',
  'deleteHeld',
  'checkout',
  'receipt',
  'returnSale',
  'shift',
  'dashboard',
  'report',
  'settings',
  'backup',
  'restore',
  'export',
  'productFile',
  'printReceipt',
  'printCustomerPayment',
  'integrity',
]);
const bridge: Bridge = {
  invoke: <K extends Action>(action: K, input: Input<K>) => {
    if (!actions.has(action)) return Promise.resolve({ ok: false as const, error: 'forbidden' });
    return ipcRenderer.invoke('pos:invoke', action, input);
  },
};
contextBridge.exposeInMainWorld('pos', Object.freeze(bridge));
