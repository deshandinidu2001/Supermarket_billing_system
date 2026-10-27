import { useTranslation } from 'react-i18next';
import { Printer, FileDown, CheckCheck } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { money, safe } from '../lib/utils';
import { Modal } from './ui/dialog';
import { Button } from './ui/button';
import { DataTable, Loading, useLoad } from './common';
import type { Row } from '../../shared/types';
export default function ReceiptView({
  billNo,
  onClose,
  success = false,
}: {
  billNo: string;
  onClose: () => void;
  success?: boolean;
}) {
  const { t } = useTranslation();
  const { data } = useLoad(() => api('receipt', { bill_no: billNo }), [billNo]);
  const grouped = new Map<string, Row>();
  for (const item of data?.items ?? []) {
    const id = String(item.line_id);
    const old = grouped.get(id);
    if (old) {
      old.qty = Number(old.qty) + Number(item.qty);
      old.line_total = Number(old.line_total) + Number(item.line_total);
      old.discount = Number(old.discount) + Number(item.discount);
    } else grouped.set(id, { ...item, total: item.line_total });
  }
  const print = (pdf: boolean) =>
    safe(async () => {
      const result = await api('printReceipt', { bill_no: billNo, pdf });
      if (result !== null) toast.success(t(pdf ? 'exported' : 'saved'));
    });
  return (
    <Modal open onClose={onClose} title={t(success ? 'saleComplete' : 'receipt')} wide>
      {success && (
        <div className="notice notice-green">
          <CheckCheck size={20} />
          {billNo}
        </div>
      )}
      {!data ? (
        <Loading />
      ) : (
        <>
          <div className="receipt-preview">
            <div className="receipt-shop">
              <strong>{data.shop.shop_name}</strong>
              <p>{data.shop.address}</p>
              <p>{data.shop.phone}</p>
            </div>
            <div className="receipt-meta">
              <span>{billNo}</span>
              <span>{data.sale.cashier}</span>
            </div>
            <DataTable
              rows={[...grouped.values()].map((r) => ({
                ...r,
                total: Number(r.line_total) + Number(r.discount),
              }))}
              columns={['name_en', 'name_si', 'qty', 'unit_price', 'total']}
            />
            <div className="receipt-totals">
              {[
                'subtotal',
                'line_discount',
                'bill_discount',
                'loyalty_discount',
                'bag_total',
                'rounding',
                'total',
              ].map((key) => (
                <div key={key}>
                  <span>{t(key)}</span>
                  <span>{money(Number(data.sale[key]))}</span>
                </div>
              ))}
              <div>
                <span>{t('change')}</span>
                <span>
                  {money(
                    data.payments
                      .filter((p) => p.method === 'cash')
                      .reduce((s, p) => s + Number(p.tendered) - Number(p.amount), 0),
                  )}
                </span>
              </div>
            </div>
          </div>
          <div className="modal-actions">
            <Button variant="outline" onClick={() => print(true)}>
              <FileDown size={16} />
              {t('savePdf')}
            </Button>
            <Button onClick={() => print(false)}>
              <Printer size={16} />
              {t('print')}
            </Button>
            <Button variant="ghost" onClick={onClose}>
              {t('close')}
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
