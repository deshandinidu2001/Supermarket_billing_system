import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { money, safe } from '../lib/utils';
import { useStore } from '../store';
import type { PaymentMethod, Receipt } from '../../shared/types';
import { Button } from '../components/ui/button';
import { Confirm, PageTitle } from '../components/common';
export default function Returns() {
  const { t, i18n } = useTranslation();
  const user = useStore((s) => s.user)!;
  const [bill, setBill] = useState(''),
    [receipt, setReceipt] = useState<Receipt | null>(null),
    [items, setItems] = useState<Record<string, { qty: number; damaged: boolean }>>({}),
    [reason, setReason] = useState(''),
    [pin, setPin] = useState(''),
    [method, setMethod] = useState<PaymentMethod>('cash'),
    [isVoid, setIsVoid] = useState(false),
    [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false);
  const find = async () => {
    const found = await api('receipt', { bill_no: bill.trim() });
    setReceipt(found);
    setItems({});
    setIsVoid(false);
    setReason('');
  };
  const refund = async () => {
    if (!receipt) return;
    setBusy(true);
    try {
      await api('returnSale', {
        sale_id: String(receipt.sale.id),
        items: Object.entries(items)
          .filter(([, i]) => i.qty > 0)
          .map(([id, i]) => ({ sale_item_id: id, ...i })),
        reason,
        owner_pin: user.role === 'cashier' ? pin : undefined,
        method,
        void: isVoid,
      });
      setConfirm(false);
      setReceipt(null);
      setItems({});
      setPin('');
      await useStore.getState().boot();
      toast.success(t('returnSaved'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageTitle title={t('nav.returns')} hint={t('returnHint')} />
      <section className="panel">
        <form
          className="content-toolbar"
          onSubmit={(e) => {
            e.preventDefault();
            safe(find);
          }}
        >
          <label className="field" style={{ flex: 1, maxWidth: 450 }}>
            <span className="sr-only">{t('bill_no')}</span>
            <input
              placeholder="C1-000001"
              aria-label={t('bill_no')}
              value={bill}
              onChange={(e) => setBill(e.target.value)}
              required
            />
          </label>
          <Button>
            <Search size={16} />
            {t('findBill')}
          </Button>
        </form>
        {receipt && (
          <div className="panel-body">
            <div className="payment-summary">
              <span>
                {receipt.sale.bill_no} · {receipt.sale.cashier}
              </span>
              <strong>{money(Number(receipt.sale.total))}</strong>
            </div>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    {['item', 'qty', 'returned_qty', 'returnQty', 'damaged'].map((key) => (
                      <th key={key}>{t(key)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {receipt.items.map((item) => {
                    const key = String(item.id),
                      max = Number(item.qty) - Number(item.returned_qty);
                    return (
                      <tr key={key}>
                        <td>
                          {item[i18n.language === 'si' ? 'name_si' : 'name_en']}
                          <small className="product-secondary">
                            {String(item.batch_id).slice(0, 8)}
                          </small>
                        </td>
                        <td>{item.qty}</td>
                        <td>{item.returned_qty}</td>
                        <td>
                          <input
                            aria-label={`${t('returnQty')} ${item.name_en}`}
                            style={{ width: 95 }}
                            type="number"
                            step=".001"
                            min="0"
                            max={max}
                            value={items[key]?.qty ?? 0}
                            disabled={max <= 0}
                            onChange={(e) => {
                              setIsVoid(false);
                              setItems((rows) => ({
                                ...rows,
                                [key]: {
                                  qty: Number(e.target.value),
                                  damaged: rows[key]?.damaged ?? false,
                                },
                              }));
                            }}
                          />
                        </td>
                        <td>
                          <input
                            aria-label={`${t('damaged')} ${item.name_en}`}
                            type="checkbox"
                            checked={items[key]?.damaged ?? false}
                            onChange={(e) =>
                              setItems((rows) => ({
                                ...rows,
                                [key]: { qty: rows[key]?.qty ?? 0, damaged: e.target.checked },
                              }))
                            }
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="return-controls">
              <label className="field field-full">
                <span>{t('reason')}</span>
                <textarea required value={reason} onChange={(e) => setReason(e.target.value)} />
              </label>
              <label className="field">
                <span>{t('refundMethod')}</span>
                <select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
                  {['cash', 'card', 'qr', 'credit'].map((m) => (
                    <option key={m} value={m}>
                      {t(m)}
                    </option>
                  ))}
                </select>
              </label>
              {user.role === 'cashier' && (
                <label className="field">
                  <span>{t('owner_pin')}</span>
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={6}
                    value={pin}
                    onChange={(e) => setPin(e.target.value)}
                    autoComplete="off"
                  />
                </label>
              )}
              <label className="field field-check field-full">
                <span>{t('voidBill')}</span>
                <input
                  type="checkbox"
                  checked={isVoid}
                  onChange={(e) => {
                    setIsVoid(e.target.checked);
                    if (e.target.checked)
                      setItems(
                        Object.fromEntries(
                          receipt.items.map((i) => [
                            String(i.id),
                            {
                              qty: Math.max(0, Number(i.qty) - Number(i.returned_qty)),
                              damaged: false,
                            },
                          ]),
                        ),
                      );
                  }}
                />
              </label>
            </div>
            <div className="modal-actions">
              <Button
                disabled={busy || !reason || !Object.values(items).some((i) => i.qty > 0)}
                variant="destructive"
                onClick={() => setConfirm(true)}
              >
                <ShieldCheck size={17} />
                {t('refund')}
              </Button>
            </div>
          </div>
        )}
      </section>
      {confirm && (
        <Confirm
          title={t(isVoid ? 'voidBill' : 'refund')}
          onClose={() => setConfirm(false)}
          onConfirm={refund}
        />
      )}
    </>
  );
}
