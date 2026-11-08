// Browser previews keep credentials and cached summaries in this tab's memory.
// Native builds resolve storage.ts and continue using OS SecureStore.
const values = new Map<string, string>();
export const WHEN_UNLOCKED_THIS_DEVICE_ONLY = 0;
export async function getItemAsync(key: string) {
  return values.get(key) ?? null;
}
export async function setItemAsync(key: string, value: string, _options?: unknown) {
  values.set(key, value);
}
export async function deleteItemAsync(key: string) {
  values.delete(key);
}
