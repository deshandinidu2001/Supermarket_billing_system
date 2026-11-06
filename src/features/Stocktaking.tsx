import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ClipboardCheck, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { safe } from '../lib/utils';
import { useStore } from '../store';
import { Button } from '../components/ui/button';
import {
  Confirm,
  DataTable,
  ErrorState,
  Loading,
  PageTitle,
  SearchBox,
  useLoad,
} from '../components/common';

export default function Stocktaking() {
  const { t, i18n } = useTranslation();
  const [id, setId] = useState<string | null>(null);
  const history = useLoad(() => api('stocktakes', {}));
  const details = useLoad(() => (id ? api('stocktake', { id }) : Promise.resolve(null)), [id]);
  const current = details.data?.session.id === id ? details.data : null;
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [query, setQuery] = useState('');
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setCounts(
      Object.fromEntries(
        (current?.lines ?? []).map((line) => [
          String(line.product_id),
          line.counted_qty == null ? '' : String(line.counted_qty),
        ]),
      ),
    );
  }, [current]);
  const completed = current?.session.status === 'completed';
  const entered = Object.entries(counts).filter(([, value]) => value !== '');
  const changed =
    current?.lines.filter(
      (line) =>
        counts[String(line.product_id)] !== '' &&
        Number(counts[String(line.product_id)]) !== Number(line.expected_qty),
    ).length ?? 0;
  const invalid = current?.lines.some((line) => {
    const value = counts[String(line.product_id)];
    return (
      value != null &&
      value !== '' &&
      (!Number.isFinite(Number(value)) ||
        Number(value) < 0 ||
        (['pcs', 'pack'].includes(String(line.unit)) && !Number.isInteger(Number(value))))
    );
  });
  async function save(complete = false) {
    if (!id || invalid) return;
    setBusy(true);
    try {
      await api('saveStocktake', {
        id,
        complete,
        counts: Object.entries(counts).map(([product_id, value]) => ({
          product_id,
          counted_qty: value === '' ? null : Number(value),
        })),
      });
      details.reload();
      history.reload();
      if (complete) await useStore.getState().boot();
      toast.success(t(complete ? 'countApplied' : 'saved'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageTitle
        title={t('nav.stocktaking')}
        hint={t('stocktakeHint')}
        actions={
          <>
            {id && (
              <Button
                variant="outline"
                onClick={() => {
                  setId(null);
                  setQuery('');
                }}
              >
                {t('countHistory')}
              </Button>
            )}
            <Button
              disabled={busy}
              onClick={() =>
                safe(async () => {
                  setBusy(true);
                  try {
                    setId(await api('startStocktake', {}));
                    history.reload();
                  } finally {
                    setBusy(false);
                  }
                })
              }
            >
              <Plus size={16} />
              {t('startCount')}
            </Button>
          </>
        }
      />
      {!id ? (
        <section className="panel">
          {history.error ? (
            <ErrorState retry={history.reload} />
          ) : !history.data ? (
            <Loading />
          ) : (
            <DataTable
              rows={history.data}
              columns={['created_at', 'cashier', 'status', 'counted']}
              actions={(row) => (
                <Button variant="outline" size="sm" onClick={() => setId(String(row.id))}>
                  {t('openCount')}
                </Button>
              )}
            />
          )}
        </section>
      ) : details.error ? (
        <ErrorState retry={details.reload} />
      ) : !current ? (
        <Loading />
      ) : (
        <section className="panel stocktake-panel">
          <div className="content-toolbar">
            <SearchBox value={query} onChange={setQuery} placeholder={t('searchHint')} />
            <span className="badge badge-neutral">{t(completed ? 'completed' : 'draft')}</span>
            <span>
              {entered.length} {t('counted')} · {changed} {t('differences')}
            </span>
          </div>
          <div className="stocktake-table table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  {['item', 'unit', 'expectedStock', 'countedStock', 'difference'].map((key) => (
                    <th key={key}>{t(key)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {current.lines
                  .filter((line) =>
                    `${line.name_en} ${line.name_si} ${line.sku}`
                      .toLowerCase()
                      .includes(query.toLowerCase()),
                  )
                  .map((line) => {
                    const productId = String(line.product_id),
                      value = counts[productId] ?? '';
                    const delta =
                      value === ''
                        ? null
                        : Math.round((Number(value) - Number(line.expected_qty)) * 1000) / 1000;
                    return (
                      <tr key={productId}>
                        <td>
                          <strong>{line[i18n.language === 'si' ? 'name_si' : 'name_en']}</strong>
                          <small className="product-secondary">{line.sku}</small>
                        </td>
                        <td>{t(`units.${line.unit}`)}</td>
                        <td>{line.expected_qty}</td>
                        <td>
                          <input
                            type="number"
                            aria-label={`${t('countedStock')}: ${line.name_en}`}
                            disabled={completed || busy}
                            min="0"
                            step={['pcs', 'pack'].includes(String(line.unit)) ? '1' : '.001'}
                            value={value}
                            onChange={(e) =>
                              setCounts((old) => ({ ...old, [productId]: e.target.value }))
                            }
                          />
                        </td>
                        <td className={delta ? 'count-difference' : ''}>
                          {delta == null ? '—' : delta > 0 ? `+${delta}` : delta}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
          {!completed && (
            <div className="stocktake-actions">
              <span className="muted">{t('countReviewHint')}</span>
              <Button
                variant="outline"
                disabled={busy || invalid}
                onClick={() => safe(() => save())}
              >
                {t('saveCount')}
              </Button>
              <Button disabled={busy || invalid || !entered.length} onClick={() => setReview(true)}>
                <ClipboardCheck size={16} />
                {t('applyCount')}
              </Button>
            </div>
          )}
        </section>
      )}
      {review && (
        <Confirm
          title={`${t('applyCountConfirm')} ${changed} ${t('differences')}.`}
          onClose={() => setReview(false)}
          onConfirm={() => save(true)}
        />
      )}
    </>
  );
}
