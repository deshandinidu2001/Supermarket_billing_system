import { toast } from 'sonner';
import i18n from '../i18n';
import type { Action, Input, Outputs } from '../../shared/contracts';
export async function api<K extends Action>(action: K, input: Input<K>): Promise<Outputs[K]> {
  if (!window.pos) throw new Error(i18n.t('noElectron'));
  const result = await window.pos.invoke(action, input);
  if (!result.ok) {
    if (result.error === 'sessionExpired') window.dispatchEvent(new Event('pos:locked'));
    else
      toast.error(
        i18n.t(result.error),
        result.details ? { description: result.details } : undefined,
      );
    throw new Error(result.error);
  }
  return result.data;
}
