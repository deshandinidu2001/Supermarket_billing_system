import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { dateString, money, safe } from '../lib/utils';
import { useStore } from '../store';
import { Button } from '../components/ui/button';
import { Modal } from '../components/ui/dialog';
import { DataTable, Empty, ErrorState, Loading, PageTitle, useLoad } from '../components/common';

export default function SupplierReturns() {
  const { t } = useTranslation();
  const history = useLoad(() => api('supplierReturns', {}));
  const suppliers = useLoad(() => api('list', { entity: 'suppliers' }));
  const [open, setOpen] = useState(false),
    [supplier, setSupplier] = useState(''),
    [reason, setReason] = useState(''),
    [date, setDate] = useState(dateString());
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [request, setRequest] = useState(crypto.randomUUID());
  const [busy, setBusy] = useState(false),
    [view, setView] = useState<string | null>(null);
  const batches = useLoad(
    () =>
      supplier ? api('supplierReturnBatches', { supplier_id: supplier }) : Promise.resolve([]),
    [supplier, open],
  );
  const details = useLoad(
    () => (view ? api('supplierReturnDetails', { id: view }) : Promise.resolve(null)),
    [view],
  );
  const items = Object.entries(quantities)
    .filter(([, qty]) => Number(qty) > 0)
    .map(([batch_id, qty]) => ({ batch_id, qty: Number(qty) }));
  const invalid = (batches.data ?? []).some((batch) => {
    const qty = Number(quantities[String(batch.batch_id)] ?? 0);
    return (
      !Number.isFinite(qty) ||
      qty < 0 ||
      qty > Number(batch.available) ||
      (['pcs', 'pack'].includes(String(batch.unit)) && !Number.isInteger(qty))
    );
  });
  async function save() {
    if (busy || invalid || !items.length) return;
    setBusy(true);
    try {
      const id = await api('supplierReturn', {
        request_id: request,
        supplier_id: supplier,
        date,
        reason,
        items,
      });
      setOpen(false);
      history.reload();
      await useStore.getState().boot();
      setView(id);
      toast.success(t('supplierReturnSaved'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageTitle
        title={t('nav.supplierReturns')}
        hint={t('supplierReturnHint')}
        actions={
          <Button
            onClick={() => {
              setSupplier('');
              setQuantities({});
              setReason('');
              setDate(dateString());
              setRequest(crypto.randomUUID());
              setOpen(true);
            }}
          >
            <Plus size={16} />
            {t('newSupplierReturn')}
          </Button>
        }
      />
      <section className="panel">
        {history.error ? (
          <ErrorState retry={history.reload} />
        ) : !history.data ? (
          <Loading />
        ) : (
          <DataTable
            rows={history.data}
            columns={['date', 'supplier', 'reason', 'total']}
            actions={(row) => (
              <Button variant="outline" size="sm" onClick={() => setView(String(row.id))}>
                {t('details')}
              </Button>
            )}
          />
        )}
      </section>
      <Modal
        open={open}
        onClose={() => {
          if (!busy) setOpen(false);
        }}
        title={t('newSupplierReturn')}
        wide
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            safe(save);
          }}
        >
          <div className="form-grid">
            <label className="field">
              <span>{t('supplier')}</span>
              <select
                aria-label={t('supplier')}
                required
                value={supplier}
                onChange={(e) => {
                  setSupplier(e.target.value);
                  setQuantities({});
                }}
              >
                <option value="">—</option>
                {suppliers.data?.map((entry) => (
                  <option key={String(entry.id)} value={String(entry.id)}>
                    {entry.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t('date')}</span>
              <input
                type="date"
                max={dateString()}
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
            <label className="field field-full">
              <span>{t('reason')}</span>
              <input required value={reason} onChange={(e) => setReason(e.target.value)} />
            </label>
          </div>
          {supplier &&
            (batches.error ? (
              <ErrorState retry={batches.reload} />
            ) : !batches.data ? (
              <Loading />
            ) : !batches.data.length ? (
              <Empty text={t('noReturnableBatches')} />
            ) : (
              <div className="supplier-return-table table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      {['item', 'invoice_no', 'availableStock', 'cost_price', 'returnQty'].map(
                        (key) => (
                          <th key={key}>{t(key)}</th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {batches.data.map((batch) => (
                      <tr key={String(batch.batch_id)}>
                        <td>
                          {batch.name_en}
                          <small className="product-secondary">{batch.expiry_date ?? '—'}</small>
                        </td>
                        <td>{batch.invoice_no}</td>
                        <td>
                          {batch.available} {t(`units.${batch.unit}`)}
                        </td>
                        <td>{money(Number(batch.cost_price))}</td>
                        <td>
                          <input
                            aria-label={`${t('returnQty')}: ${batch.name_en} ${batch.invoice_no}`}
                            type="number"
                            min="0"
                            max={Number(batch.available)}
                            step={['pcs', 'pack'].includes(String(batch.unit)) ? '1' : '.001'}
                            value={quantities[String(batch.batch_id)] ?? ''}
                            onChange={(e) =>
                              setQuantities((old) => ({
                                ...old,
                                [String(batch.batch_id)]: e.target.value,
                              }))
                            }
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          <div className="modal-actions">
            <Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>
              {t('cancel')}
            </Button>
            <Button disabled={busy || invalid || !items.length || !supplier || !reason.trim()}>
              <RotateCcw size={16} />
              {t('recordSupplierReturn')}
            </Button>
          </div>
        </form>
      </Modal>
      {view && (
        <Modal open onClose={() => setView(null)} title={t('supplierReturnDetails')} wide>
          {details.error ? (
            <ErrorState retry={details.reload} />
          ) : !details.data ? (
            <Loading />
          ) : (
            <>
              <div className="payment-summary">
                <span>
                  {details.data.record.supplier} · {details.data.record.date}
                </span>
                <strong>{money(Number(details.data.record.total))}</strong>
              </div>
              <p className="record-description">{details.data.record.reason}</p>
              <DataTable
                rows={details.data.items}
                columns={['name_en', 'invoice_no', 'qty', 'cost_price', 'amount']}
              />
            </>
          )}
        </Modal>
      )}
    </>
  );
}
