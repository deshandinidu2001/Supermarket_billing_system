import * as SecureStore from 'expo-secure-store';
import { ownerCache } from '../../../packages/analytics/secure-cache';
const options = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const cache = ownerCache({
  get: SecureStore.getItemAsync,
  set: (key, value) => SecureStore.setItemAsync(key, value, options),
  remove: SecureStore.deleteItemAsync,
});
export const writeCache = cache.write,
  readCache = cache.read,
  clearCache = cache.clear;
