import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { dateString, money, safe } from '../lib/utils';
import { useStore } from '../store';
import type { Product } from '../../shared/types';
import { Button } from '../components/ui/button';
import { Modal } from '../components/ui/dialog';
import { DataTable, ErrorState, Loading, PageTitle, useLoad } from '../components/common';
import ProductPicker from '../components/ProductPicker';
interface Line {
  key: string;
  product: Product | null;
  qty: string;
  cost: string;
  expiry: string;
}
const line = (): Line => ({
  key: crypto.randomUUID(),
  product: null,
  qty: '1',
  cost: '',
  expiry: '',
});
export default function Purchases() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false),
    [supplier, setSupplier] = useState(''),
    [invoice, setInvoice] = useState(''),
    [date, setDate] = useState(dateString()),
    [lines, setLines] = useState<Line[]>([line()]),
    [busy, setBusy] = useState(false);
  const { data, error, reload } = useLoad(() => api('list', { entity: 'purchases' }));
  const suppliers = useLoad(() => api('list', { entity: 'suppliers' })).data ?? [];
  const edit = (key: string, patch: Partial<Line>) =>
    setLines((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  async function save() {
    setBusy(true);
    try {
      await api('purchase', {
        supplier_id: supplier,
        invoice_no: invoice,
        date,
        items: lines.map((l) => ({
          product_id: l.product?.id ?? '',
          qty: Number(l.qty),
          cost_price: Math.round(Number(l.cost) * 100),
          expiry_date: l.expiry || null,
        })),
      });
      setOpen(false);
      setLines([line()]);
      setInvoice('');
      reload();
      await useStore.getState().boot();
      toast.success(t('purchaseSaved'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageTitle
        title={t('nav.purchases')}
        hint={t('purchaseHint')}
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus size={17} />
            {t('newPurchase')}
          </Button>
        }
      />
      <section className="panel">
        {error ? (
          <ErrorState retry={reload} />
        ) : !data ? (
          <Loading />
        ) : (
          <DataTable rows={data} columns={['invoice_no', 'supplier', 'date', 'total']} />
        )}
      </section>
      <Modal open={open} onClose={() => setOpen(false)} title={t('newPurchase')} wide>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            safe(save);
          }}
        >
          <div className="form-grid">
            <label className="field">
              <span>{t('supplier')}</span>
              <select value={supplier} required onChange={(e) => setSupplier(e.target.value)}>
                <option value="">—</option>
                {suppliers.map((r) => (
                  <option value={String(r.id)} key={String(r.id)}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t('invoice_no')}</span>
              <input value={invoice} onChange={(e) => setInvoice(e.target.value)} required />
            </label>
            <label className="field">
              <span>{t('date')}</span>
              <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
          </div>
          {lines.map((l) => (
            <div className="purchase-line" key={l.key}>
              <label className="field">
                <span>{t('item')}</span>
                <ProductPicker
                  value={l.product}
                  onSelect={(p) =>
                    edit(l.key, { product: p, cost: String((p.cost_price ?? 0) / 100) })
                  }
                />
              </label>
              <label className="field">
                <span>{t('qty')}</span>
                <input
                  type="number"
                  min=".001"
                  step=".001"
                  required
                  value={l.qty}
                  onChange={(e) => edit(l.key, { qty: e.target.value })}
                />
              </label>
              <label className="field">
                <span>{t('cost_price')}</span>
                <input
                  type="number"
                  min="0"
                  step=".01"
                  required
                  value={l.cost}
                  onChange={(e) => edit(l.key, { cost: e.target.value })}
                />
              </label>
              <label className="field">
                <span>{t('expiry_date')}</span>
                <input
                  type="date"
                  value={l.expiry}
                  onChange={(e) => edit(l.key, { expiry: e.target.value })}
                />
              </label>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t('remove')}
                disabled={lines.length === 1}
                onClick={() => setLines((rows) => rows.filter((r) => r.key !== l.key))}
              >
                <X size={16} />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            onClick={() => setLines((rows) => [...rows, line()])}
          >
            <Plus size={16} />
            {t('addLine')}
          </Button>
          <div className="purchase-totals">
            {money(
              lines.reduce(
                (s, l) => s + Math.round(Number(l.cost || 0) * 100 * Number(l.qty || 0)),
                0,
              ),
            )}
          </div>
          <div className="modal-actions">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t('cancel')}
            </Button>
            <Button disabled={busy}>{t('newPurchase')}</Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
