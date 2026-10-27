import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Banknote, ReceiptText, RotateCcw, Wallet } from 'lucide-react';
import { api } from '../lib/api';
import { displayDate, money, safe } from '../lib/utils';
import { useStore } from '../store';
import { Button } from '../components/ui/button';
import { Confirm, DataTable, ErrorState, Loading, PageTitle, useLoad } from '../components/common';
export default function Shift() {
  const { t } = useTranslation();
  const [end, setEnd] = useState(false);
  const { data, error, reload } = useLoad(() => api('shift', { action: 'summary' }));
  const update = async (action: 'start' | 'end') => {
    await api('shift', { action });
    reload();
    await useStore.getState().boot();
  };
  return (
    <div className="shift-layout">
      <PageTitle title={t('nav.shift')} hint={t('shiftHint')} />
      {error ? (
        <ErrorState retry={reload} />
      ) : !data ? (
        <Loading />
      ) : (
        <>
          <section className="panel shift-banner">
            <div className="stat-icon">
              <Wallet size={28} />
            </div>
            <div>
              <h2>{t(data.shift && !data.shift.end_time ? 'shiftOpen' : 'shiftClosed')}</h2>
              <p>
                {data.shift
                  ? `${t('start_time')}: ${displayDate(String(data.shift.start_time), true)}${data.shift.end_time ? ` · ${t('end_time')}: ${displayDate(String(data.shift.end_time), true)}` : ''}`
                  : t('noActiveShift')}
              </p>
            </div>
            {data.shift && !data.shift.end_time ? (
              <Button variant="outline" onClick={() => setEnd(true)}>
                {t('endShift')}
                <ArrowRight size={16} />
              </Button>
            ) : (
              <Button onClick={() => safe(() => update('start'))}>
                {t('startShift')}
                <ArrowRight size={16} />
              </Button>
            )}
          </section>
          <div className="stat-grid">
            {[
              {
                label: 'revenue',
                value: money(data.methods.reduce((s, r) => s + Number(r.amount), 0)),
                icon: Banknote,
              },
              { label: 'billCount', value: data.bills, icon: ReceiptText },
              { label: 'returns', value: money(data.returns), icon: RotateCcw },
            ].map((stat) => (
              <section className="panel stat-card" key={stat.label}>
                <div className="stat-top">
                  {t(stat.label)}
                  <span className="stat-icon">
                    <stat.icon size={17} />
                  </span>
                </div>
                <strong className="stat-value">{stat.value}</strong>
              </section>
            ))}
          </div>
          <section className="panel">
            <div className="panel-heading">
              <h2>{t('paymentMix')}</h2>
            </div>
            <DataTable rows={data.methods} columns={['method', 'amount']} />
          </section>
        </>
      )}
      {end && (
        <Confirm
          title={t('endShift')}
          onClose={() => setEnd(false)}
          onConfirm={() => update('end')}
        />
      )}
    </div>
  );
}
