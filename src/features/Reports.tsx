import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Download, Printer, ReceiptText } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { dateString, rangeFor, safe } from '../lib/utils';
import { reportNames, type ReportName } from '../../shared/contracts';
import { Button } from '../components/ui/button';
import ReceiptView from '../components/ReceiptView';
import {
  DataTable,
  ErrorState,
  Loading,
  PageTitle,
  RangeFilter,
  useLoad,
} from '../components/common';
export default function Reports() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const initial = params.get('report');
  const [name, setName] = useState<ReportName>(
    initial !== 'credit' && reportNames.includes(initial as ReportName)
      ? (initial as ReportName)
      : 'sales',
  );
  const [range, setRange] = useState(rangeFor('month'));
  const [busy, setBusy] = useState(false);
  const [bill, setBill] = useState<string | null>(null);
  const latest = useLoad(() => api('list', { entity: 'sales' }));
  const { data, error, reload } = useLoad(
    () => api('report', { name, ...range }),
    [name, range.from, range.to],
  );
  function exportFile(format: 'xlsx' | 'csv' | 'pdf', print = false) {
    safe(async () => {
      setBusy(true);
      try {
        const result = await api('export', {
          name: print ? 'sales' : name,
          ...(print ? { from: dateString(), to: dateString() } : range),
          format,
          print,
        });
        if (result !== null) toast.success(t('exported'));
      } finally {
        setBusy(false);
      }
    });
  }
  return (
    <>
      <PageTitle
        title={t('nav.reports')}
        hint={t('reportsHint')}
        actions={
          <>
            <Button
              variant="outline"
              disabled={!latest.data?.length}
              onClick={() => setBill(String(latest.data![0].bill_no))}
            >
              <ReceiptText size={16} />
              {t('lastReceipt')}
            </Button>
            <Button variant="outline" onClick={() => exportFile('pdf', true)} disabled={busy}>
              <Printer size={16} />
              {t('dailySummary')}
            </Button>
          </>
        }
      />
      <div className="report-toolbar">
        <select
          value={name}
          aria-label={t('report')}
          onChange={(e) => setName(e.target.value as ReportName)}
        >
          {reportNames
            .filter((n) => n !== 'credit')
            .map((n) => (
              <option key={n} value={n}>
                {t(`report.${n}`)}
              </option>
            ))}
        </select>
        <RangeFilter value={range} onChange={setRange} />
        <div className="report-actions">
          {(['xlsx', 'csv', 'pdf'] as const).map((f) => (
            <Button
              variant="outline"
              size="sm"
              key={f}
              disabled={busy}
              onClick={() => exportFile(f)}
            >
              <Download size={14} />
              {t(f)}
            </Button>
          ))}
        </div>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <h2>{t(`report.${name}`)}</h2>
          {data && (
            <span className="badge badge-neutral">
              {data.rows.length} {t('results')}
            </span>
          )}
        </div>
        {error ? (
          <ErrorState retry={reload} />
        ) : !data ? (
          <Loading />
        ) : (
          <DataTable
            rows={data.rows}
            columns={data.columns}
            actions={
              name === 'sales'
                ? (row) => (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setBill(String(row.bill_no))}
                    >
                      <ReceiptText size={14} />
                      {t('billDetails')}
                    </Button>
                  )
                : undefined
            }
          />
        )}
      </section>
      <p className="report-note">{t('stockAsOf')}</p>
      {bill && <ReceiptView billNo={bill} onClose={() => setBill(null)} />}
    </>
  );
}
