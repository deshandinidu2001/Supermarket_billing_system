import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Check, Inbox, LoaderCircle, Search, X } from 'lucide-react';
import { Button } from './ui/button';
import { Modal } from './ui/dialog';
import { displayDate, money, rangeFor } from '../lib/utils';
import type { Row } from '../../shared/types';
export function PageTitle({
  title,
  hint,
  actions,
}: {
  title: string;
  hint?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-title">
      <div>
        <h1>{title}</h1>
        {hint && <p>{hint}</p>}
      </div>
      <div className="page-actions">{actions}</div>
    </div>
  );
}
export function Empty({ text, children }: { text?: string; children?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="empty-state">
      <Inbox size={34} />
      <h3>{text ?? t('empty')}</h3>
      {children}
    </div>
  );
}
export function Loading() {
  const { t } = useTranslation();
  return (
    <div className="loading">
      <LoaderCircle className="spin" size={22} />
      {t('loading')}
    </div>
  );
}
export function ErrorState({ retry }: { retry: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="empty-state">
      <AlertCircle size={28} />
      <p>{t('unknownError')}</p>
      <Button variant="outline" onClick={retry}>
        {t('retry')}
      </Button>
    </div>
  );
}
export function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="search-box">
      <Search size={18} />
      <input
        aria-label={placeholder ?? t('search')}
        placeholder={placeholder ?? t('search')}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button aria-label={t('clear')} onClick={() => onChange('')}>
          <X size={16} />
        </button>
      )}
    </div>
  );
}
export const moneyFields = new Set([
  'total',
  'amount',
  'unit_price',
  'unit_cost',
  'cost_price',
  'selling_price',
  'mrp',
  'revenue',
  'profit',
  'gross_profit',
  'net_profit',
  'value',
  'cost',
  'balance',
  'credit_limit',
  'paid',
  'purchases',
  'line_discount',
  'bill_discount',
  'loyalty_discount',
  'discount',
  'refunds',
  'bag_price',
]);
export function DataTable({
  rows,
  columns,
  actions,
  onRow,
}: {
  rows: Row[];
  columns: string[];
  actions?: (row: Row) => ReactNode;
  onRow?: (row: Row) => void;
}) {
  const { t } = useTranslation();
  function cell(key: string, row: Row) {
    const value = row[key];
    if (value == null || value === '') return '—';
    if (moneyFields.has(key)) return money(Number(value));
    if (['created_at', 'updated_at', 'start_time', 'end_time', 'last_sale'].includes(key))
      return displayDate(String(value), true);
    if (['date', 'expiry_date', 'received_date', 'due_date', 'join_date'].includes(key))
      return displayDate(String(value));
    if (['active', 'quick_access', 'is_void'].includes(key))
      return (
        <span className={`badge ${value ? 'badge-green' : 'badge-neutral'}`}>
          {value ? <Check size={12} /> : null}
          {t(value ? 'yes' : 'no')}
        </span>
      );
    if (['status', 'role', 'method', 'reason'].includes(key))
      return (
        <span
          className={`badge badge-${value === 'pending' ? 'amber' : value === 'returned' || value === 'void' ? 'red' : 'green'}`}
        >
          {t(String(value))}
        </span>
      );
    if (key === 'note' && ['earned', 'redeemed', 'returned'].includes(String(value)))
      return t(String(value));
    if (key === 'unit') return t(`units.${value}`);
    if (key === 'action') return t(`audit.${value}`);
    return typeof value === 'number'
      ? Number(value.toFixed(3)).toLocaleString('en-LK')
      : String(value);
  }
  if (!rows.length) return <Empty />;
  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c} className={moneyFields.has(c) ? 'numeric' : ''}>
                {t(c)}
              </th>
            ))}
            {actions && <th className="actions-cell">{t('actions')}</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={String(row.id ?? index)}
              onClick={() => onRow?.(row)}
              className={onRow ? 'clickable' : ''}
            >
              {columns.map((c) => (
                <td key={c} className={moneyFields.has(c) ? 'numeric' : ''}>
                  {cell(c, row)}
                </td>
              ))}
              {actions && (
                <td className="actions-cell" onClick={(e) => e.stopPropagation()}>
                  {actions(row)}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function Confirm({
  title,
  onConfirm,
  onClose,
}: {
  title: string;
  onConfirm: () => Promise<unknown>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  return (
    <Modal open onClose={onClose} title={title}>
      <div className="modal-actions">
        <Button variant="outline" onClick={onClose}>
          {t('cancel')}
        </Button>
        <Button
          variant="destructive"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void onConfirm()
              .then(onClose)
              .catch(() => {})
              .finally(() => setBusy(false));
          }}
        >
          {busy ? <LoaderCircle size={18} className="spin" /> : null}
          {t('confirm')}
        </Button>
      </div>
    </Modal>
  );
}
export function RangeFilter({
  value,
  onChange,
}: {
  value: { from: string; to: string };
  onChange: (v: { from: string; to: string }) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="range-filter">
      <div className="segmented">
        {['today', 'week', 'month'].map((p) => (
          <button
            key={p}
            className={JSON.stringify(rangeFor(p)) === JSON.stringify(value) ? 'selected' : ''}
            onClick={() => onChange(rangeFor(p))}
          >
            {t(p)}
          </button>
        ))}
      </div>
      <label>
        <span className="sr-only">{t('from')}</span>
        <input
          type="date"
          value={value.from}
          max={value.to}
          onChange={(e) => e.target.value && onChange({ ...value, from: e.target.value })}
        />
      </label>
      <span className="muted">–</span>
      <label>
        <span className="sr-only">{t('to')}</span>
        <input
          type="date"
          value={value.to}
          min={value.from}
          onChange={(e) => e.target.value && onChange({ ...value, to: e.target.value })}
        />
      </label>
    </div>
  );
}
export function useLoad<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(false),
    [version, setVersion] = useState(0);
  useEffect(() => {
    let live = true;
    setError(false);
    load()
      .then((v) => {
        if (live) setData(v);
      })
      .catch(() => {
        if (live) setError(true);
      });
    return () => {
      live = false;
    };
  }, [...deps, version]);
  return { data, error, reload: () => setVersion((v) => v + 1), setData };
}
