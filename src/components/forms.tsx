import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useState } from 'react';
import { Button } from './ui/button';
import { moneyFields } from './common';
export interface Field {
  key: string;
  type?:
    | 'text'
    | 'number'
    | 'money'
    | 'date'
    | 'password'
    | 'select'
    | 'checkbox'
    | 'textarea'
    | 'image';
  required?: boolean;
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  full?: boolean;
  hint?: string;
}
export function RecordForm({
  fields,
  initial = {},
  onSave,
  onCancel,
  submit = 'save',
}: {
  fields: Field[];
  initial?: Record<string, unknown>;
  onSave: (values: Record<string, unknown>) => Promise<unknown>;
  onCancel?: () => void;
  submit?: string;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const schema = z.object(
    Object.fromEntries(
      fields.map((f) => [
        f.key,
        f.type === 'checkbox'
          ? z.boolean()
          : z
              .string()
              .refine((v) => !f.required || v.trim().length > 0, 'validation')
              .refine(
                (v) =>
                  !v ||
                  !['number', 'money'].includes(f.type ?? '') ||
                  (Number.isFinite(Number(v)) &&
                    (f.min === undefined || Number(v) >= f.min) &&
                    (f.max === undefined || Number(v) <= f.max)),
                'validation',
              ),
      ]),
    ),
  );
  const defaults = Object.fromEntries(
    fields.map((f) => {
      const value = initial[f.key];
      return [
        f.key,
        f.type === 'checkbox'
          ? Boolean(value ?? false)
          : f.type === 'money'
            ? value == null
              ? ''
              : String(Number(value) / 100)
            : String(value ?? ''),
      ];
    }),
  );
  const {
    register,
    handleSubmit,
    formState: { errors },
    watch,
    setValue,
  } = useForm<Record<string, string | boolean>>({
    resolver: zodResolver(schema),
    defaultValues: defaults,
  });
  async function save(values: Record<string, string | boolean>) {
    setBusy(true);
    try {
      const parsed = Object.fromEntries(
        fields.map((f) => {
          const v = values[f.key];
          return [
            f.key,
            f.type === 'money'
              ? v === ''
                ? null
                : Math.round(Number(v) * 100)
              : f.type === 'number'
                ? v === ''
                  ? null
                  : Number(v)
                : v,
          ];
        }),
      );
      await onSave(parsed);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      onSubmit={(e) => {
        void handleSubmit(save, () => toast.error(t('validation')))(e).catch(() => {});
      }}
      className="record-form"
    >
      <div className="form-grid">
        {fields.map((f) => (
          <label
            key={f.key}
            className={`field ${f.full ? 'field-full' : ''} ${f.type === 'checkbox' ? 'field-check' : ''}`}
          >
            <span>
              {t(f.key)}
              {f.required ? ' *' : ''}
            </span>
            {f.type === 'select' ? (
              <select aria-label={t(f.key)} {...register(f.key)} aria-invalid={!!errors[f.key]}>
                <option value="">—</option>
                {f.options?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : f.type === 'textarea' ? (
              <textarea aria-label={t(f.key)} rows={3} {...register(f.key)} />
            ) : f.type === 'checkbox' ? (
              <input aria-label={t(f.key)} type="checkbox" {...register(f.key)} />
            ) : f.type === 'image' ? (
              <div className="image-input">
                {watch(f.key) && <img alt={t(f.key)} src={String(watch(f.key))} />}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (file.size > 1500000) {
                      toast.error(t('validation'));
                      return;
                    }
                    const reader = new FileReader();
                    reader.onload = () => setValue(f.key, String(reader.result));
                    reader.readAsDataURL(file);
                  }}
                />
                {watch(f.key) && (
                  <Button type="button" variant="ghost" onClick={() => setValue(f.key, '')}>
                    {t('clearImage')}
                  </Button>
                )}
              </div>
            ) : (
              <div className={f.type === 'money' ? 'money-input' : ''}>
                {f.type === 'money' && <span>Rs.</span>}
                <input
                  aria-label={t(f.key)}
                  type={f.type === 'money' ? 'number' : (f.type ?? 'text')}
                  step={f.type === 'money' ? '.01' : f.type === 'number' ? '.001' : undefined}
                  min={f.min}
                  max={f.max}
                  {...register(f.key)}
                  aria-invalid={!!errors[f.key]}
                  autoComplete={f.type === 'password' ? 'new-password' : 'off'}
                />
              </div>
            )}
            {f.hint && <small>{t(f.hint)}</small>}
            {errors[f.key] && <small className="error-text">{t('validation')}</small>}
          </label>
        ))}
      </div>
      {fields.some((f) => f.key === 'selling_price') &&
        Number(watch('mrp')) > 0 &&
        Number(watch('selling_price')) > Number(watch('mrp')) && (
          <div className="notice notice-amber">{t('aboveMrp')}</div>
        )}
      <div className="modal-actions">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            {t('cancel')}
          </Button>
        )}
        <Button disabled={busy}>{t(submit)}</Button>
      </div>
    </form>
  );
}
export function field(key: string, extras: Partial<Field> = {}): Field {
  return { key, type: moneyFields.has(key) ? 'money' : 'text', ...extras };
}
