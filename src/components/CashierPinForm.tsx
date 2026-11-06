import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../store';
import { api } from '../lib/api';
import { safe } from '../lib/utils';
import { Button } from './ui/button';
import { ErrorState, Loading, useLoad } from './common';

export default function CashierPinForm({ onSuccess }: { onSuccess?: () => void }) {
  const { t } = useTranslation();
  const accounts = useLoad(() => api('cashierAccounts', {}));
  const [id, setId] = useState(''),
    [pin, setPin] = useState(''),
    [busy, setBusy] = useState(false);
  if (accounts.error) return <ErrorState retry={accounts.reload} />;
  if (!accounts.data) return <Loading />;
  if (!accounts.data.length) return <p className="record-description">{t('noCashierPins')}</p>;
  return (
    <form
      className="cashier-pin-form"
      onSubmit={(e) => {
        e.preventDefault();
        safe(async () => {
          setBusy(true);
          try {
            await useStore.getState().pinLogin(id, pin);
            onSuccess?.();
          } finally {
            setBusy(false);
          }
        });
      }}
    >
      <label className="field">
        <span>{t('cashier')}</span>
        <select
          aria-label={t('cashier')}
          required
          value={id}
          onChange={(e) => setId(e.target.value)}
        >
          <option value="">{t('chooseCashier')}</option>
          {accounts.data.map((account) => (
            <option key={String(account.id)} value={String(account.id)}>
              {account.display_name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>{t('cashierPin')}</span>
        <input
          type="password"
          inputMode="numeric"
          autoComplete="off"
          required
          pattern="[0-9]{4,6}"
          minLength={4}
          maxLength={6}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
        />
      </label>
      <Button disabled={busy || !id || pin.length < 4}>{t(busy ? 'loading' : 'signIn')}</Button>
    </form>
  );
}
