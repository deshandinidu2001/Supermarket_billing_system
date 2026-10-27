import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FileClock, Play, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { displayDate, safe } from '../lib/utils';
import { flushCart, useStore } from '../store';
import type { Row } from '../../shared/types';
import { Button } from '../components/ui/button';
import { Confirm, Empty, ErrorState, Loading, PageTitle, useLoad } from '../components/common';
export default function Held() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data, error, reload } = useLoad(() => api('list', { entity: 'held_bills' }));
  const [remove, setRemove] = useState<Row | null>(null);
  return (
    <>
      <PageTitle title={t('nav.held')} hint={t('holdCurrentCart')} />
      {error ? (
        <ErrorState retry={reload} />
      ) : !data ? (
        <Loading />
      ) : !data.length ? (
        <section className="panel">
          <Empty text={t('noHeld')} />
        </section>
      ) : (
        <div className="held-grid">
          {data.map((row) => (
            <section className="panel held-card" key={String(row.id)}>
              <span className="stat-icon">
                <FileClock size={21} />
              </span>
              <h2>{row.name}</h2>
              <p>{displayDate(String(row.updated_at), true)}</p>
              <Button
                onClick={() =>
                  safe(async () => {
                    await flushCart();
                    await api('resumeCart', { id: String(row.id) });
                    await useStore.getState().reloadCart();
                    navigate('/checkout');
                  })
                }
              >
                <Play size={15} />
                {t('resume')}
              </Button>
              <Button variant="ghost" onClick={() => setRemove(row)} aria-label={t('delete')}>
                <Trash2 size={16} />
              </Button>
            </section>
          ))}
        </div>
      )}
      {remove && (
        <Confirm
          title={t('confirmDelete')}
          onClose={() => setRemove(null)}
          onConfirm={async () => {
            await api('deleteHeld', { id: String(remove.id) });
            reload();
            toast.success(t('deleted'));
          }}
        />
      )}
    </>
  );
}
