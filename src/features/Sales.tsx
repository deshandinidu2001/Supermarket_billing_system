import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Printer } from 'lucide-react';
import { api } from '../lib/api';
import { Button } from '../components/ui/button';
import {
  DataTable,
  ErrorState,
  Loading,
  PageTitle,
  SearchBox,
  useLoad,
} from '../components/common';
import ReceiptView from '../components/ReceiptView';
export default function Sales() {
  const { t } = useTranslation();
  const [q, setQ] = useState(''),
    [bill, setBill] = useState<string | null>(null);
  const { data, error, reload } = useLoad(() => api('list', { entity: 'sales', query: q }), [q]);
  return (
    <>
      <PageTitle title={t('nav.sales')} />
      <section className="panel">
        <div className="content-toolbar">
          <SearchBox value={q} onChange={setQ} placeholder={t('bill_no')} />
        </div>
        {error ? (
          <ErrorState retry={reload} />
        ) : !data ? (
          <Loading />
        ) : (
          <DataTable
            rows={data}
            columns={['bill_no', 'created_at', 'cashier', 'total', 'status']}
            actions={(row) => (
              <Button variant="ghost" size="sm" onClick={() => setBill(String(row.bill_no))}>
                <Printer size={15} />
                {t('receipt')}
              </Button>
            )}
          />
        )}
      </section>
      {bill && <ReceiptView billNo={bill} onClose={() => setBill(null)} />}
    </>
  );
}
