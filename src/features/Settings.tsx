import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Database, Download, FolderOpen, KeyRound, RotateCcw, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { displayDate, safe } from '../lib/utils';
import { useStore } from '../store';
import type { Input } from '../../shared/contracts';
import { Button } from '../components/ui/button';
import { Modal } from '../components/ui/dialog';
import { PageTitle } from '../components/common';
import { field, RecordForm, type Field } from '../components/forms';
export default function Settings() {
  const { t } = useTranslation();
  const data = useStore((s) => s.bootstrap)!;
  const [password, setPassword] = useState(false),
    [busy, setBusy] = useState(false);
  const s = data.settings;
  const sections: { title: string; fields: Field[] }[] = [
    {
      title: 'shopDetails',
      fields: [
        field('shop_name', { required: true }),
        field('phone'),
        field('address', { full: true }),
        field('footer_en', { full: true }),
        field('footer_si', { full: true }),
        field('logo', { type: 'image', full: true }),
      ],
    },
    {
      title: 'billingSettings',
      fields: [
        field('counter_id', { required: true }),
        field('receipt_width', {
          type: 'select',
          required: true,
          options: [
            { value: '80', label: '80 ' + t('mm') },
            { value: '58', label: '58 ' + t('mm') },
          ],
        }),
        field('rounding', {
          type: 'select',
          required: true,
          options: [
            { value: 'none', label: t('none') },
            { value: '1', label: t('round1') },
            { value: '5', label: t('round5') },
          ],
        }),
        field('max_discount', { type: 'number', required: true, min: 0, max: 100 }),
        field('bag_price', { required: true, min: 0 }),
        field('loyalty_earn', { type: 'number', required: true, min: 0 }),
        field('loyalty_value', { type: 'money', required: true, min: 0 }),
      ],
    },
    {
      title: 'safetySettings',
      fields: [
        field('idle_minutes', { type: 'number', required: true, min: 1, max: 240 }),
        field('expiry_days', { type: 'number', required: true, min: 1, max: 365 }),
        field('dead_stock_days', { type: 'number', required: true, min: 1 }),
        field('allow_negative', { type: 'checkbox', full: true, hint: 'negativeStockHint' }),
      ],
    },
    {
      title: 'scaleSettings',
      fields: [
        field('scale_enabled', { type: 'checkbox', full: true }),
        field('scale_prefix', { required: true }),
        field('scale_mode', {
          type: 'select',
          required: true,
          options: [
            { value: 'weight', label: t('weight') },
            { value: 'price', label: t('scalePrice') },
          ],
        }),
        field('scale_item_digits', { type: 'number', required: true, min: 1, max: 8 }),
        field('scale_value_digits', { type: 'number', required: true, min: 1, max: 8 }),
        field('scale_decimals', { type: 'number', required: true, min: 0, max: 4 }),
      ],
    },
  ];
  const save = async (v: Record<string, unknown>) => {
    await api('settings', {
      ...s,
      ...v,
      receipt_width: Number(v.receipt_width ?? s.receipt_width),
    } as Input<'settings'>);
    await useStore.getState().boot();
    toast.success(t('saved'));
  };
  const backup = (choose_folder: boolean) =>
    safe(async () => {
      setBusy(true);
      try {
        const result = await api('backup', { choose_folder });
        if (result) toast.success(t('backupSaved'));
        await useStore.getState().boot();
      } finally {
        setBusy(false);
      }
    });
  return (
    <>
      <PageTitle
        title={t('nav.settings')}
        hint={t('settingsHint')}
        actions={
          <Button variant="outline" onClick={() => setPassword(true)}>
            <KeyRound size={16} />
            {t('changePassword')}
          </Button>
        }
      />
      <div className="settings-layout">
        <div className="settings-sections">
          {sections.map((section) => (
            <section className="panel settings-section" key={section.title}>
              <h2>{t(section.title)}</h2>
              <RecordForm
                key={`${section.title}-${JSON.stringify(s)}`}
                fields={section.fields}
                initial={s as unknown as Record<string, unknown>}
                onSave={save}
              />
            </section>
          ))}
        </div>
        <aside className="panel backup-panel">
          <span className="stat-icon" style={{ marginBottom: 16 }}>
            <Database size={20} />
          </span>
          <h2>{t('backupSettings')}</h2>
          {data.alerts.backup_overdue && (
            <span className="badge badge-amber">{t('backupOverdue')}</span>
          )}
          <p>{t('backupHint')}</p>
          <div className="backup-status">
            <small>{t('last_backup')}</small>
            {s.last_backup ? displayDate(s.last_backup, true) : t('noBackup')}
            <small style={{ marginTop: 12 }}>{t('backup_folder')}</small>
            {s.backup_folder || '—'}
          </div>
          <Button onClick={() => backup(false)} disabled={busy}>
            <Download size={16} />
            {t('backupNow')}
          </Button>
          <Button variant="outline" onClick={() => backup(true)} disabled={busy}>
            <FolderOpen size={16} />
            {t('chooseBackup')}
          </Button>
          <RecordForm
            fields={[field('backup_keep', { type: 'number', required: true, min: 1, max: 365 })]}
            initial={{ backup_keep: s.backup_keep }}
            onSave={save}
          />
          <p>{t('dailyAutoBackup')}</p>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              safe(async () => {
                const integrity = await api('integrity', {});
                toast[integrity === 'ok' ? 'success' : 'error'](
                  t(integrity === 'ok' ? 'integrityOk' : 'integrityFailed'),
                );
              })
            }
          >
            <ShieldCheck size={16} />
            {t('checkIntegrity')}
          </Button>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() =>
              safe(async () => {
                setBusy(true);
                try {
                  if (await api('restore', {})) {
                    useStore.getState().reset();
                    toast.success(t('restored'));
                  }
                } finally {
                  setBusy(false);
                }
              })
            }
          >
            <RotateCcw size={16} />
            {t('restore')}
          </Button>
        </aside>
      </div>
      <Modal open={password} onClose={() => setPassword(false)} title={t('changePassword')}>
        <RecordForm
          fields={[
            field('current', { type: 'password', required: true }),
            field('newPassword', { type: 'password', required: true }),
            field('pin', { type: 'password' }),
          ]}
          onCancel={() => setPassword(false)}
          onSave={async (v) => {
            await api('changePassword', {
              current: String(v.current),
              password: String(v.newPassword),
              pin: v.pin ? String(v.pin) : undefined,
            });
            setPassword(false);
            toast.success(t('saved'));
          }}
        />
      </Modal>
    </>
  );
}
