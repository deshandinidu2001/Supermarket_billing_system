import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Cloud, CloudOff, Download, RefreshCw, LogOut } from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '../lib/api';
import { PageTitle, Loading, SearchBox } from '../components/common';
import { Button } from '../components/ui/button';
import { Modal } from '../components/ui/dialog';
import { labels, suggestedQuestions } from '../../packages/analytics/locales';
import {
  displayValue,
  freshness,
  money,
  type OwnerData,
  type Answer,
} from '../../packages/analytics/client';
import { addDays, groupTrend, localDay } from '../../packages/analytics/engine';
import type {
  OwnerAnalyticsStatus,
  SaleDetails,
  AnalyticsDevice,
} from '../../shared/owner-analytics';
import './online-analytics.css';

const tabs = [
  'overview',
  'sales',
  'inventory',
  'forecasts',
  'analyst',
  'alerts',
  'connection',
] as const;
type Tab = (typeof tabs)[number];
type Row = Record<string, unknown>;
function Table({
  rows,
  columns,
  onOpen,
}: {
  rows: Row[];
  columns?: string[];
  onOpen?: (r: Row) => void;
}) {
  const { i18n } = useTranslation(),
    l = labels[i18n.language === 'si' ? 'si' : 'en'];
  const names: Record<string, string> = {
    name: l.product,
    available: l.available,
    expired: l.expired,
    quantity: l.quantity,
    revenue: l.revenue,
    profit: l.profit,
    unit: l.unit,
  };
  const fields = columns ?? Object.keys(rows[0] ?? {});
  if (!rows.length) return <p className="oa-empty">{l.empty}</p>;
  return (
    <div className="oa-table">
      <table>
        <thead>
          <tr>
            {fields.map((k) => (
              <th key={k}>{names[k] ?? k.replaceAll('_', ' ')}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={String(r.id ?? i)}>
              {fields.map((k, j) => (
                <td key={k}>
                  {j === 0 && onOpen ? (
                    <button className="oa-row-link" type="button" onClick={() => onOpen(r)}>
                      {String(r[k] ?? '—')}
                    </button>
                  ) : (
                    displayValue(k, r[k])
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export default function OnlineAnalytics() {
  const { t, i18n } = useTranslation(),
    l = labels[i18n.language === 'si' ? 'si' : 'en'];
  const [status, setStatus] = useState<OwnerAnalyticsStatus>(),
    [tab, setTab] = useState<Tab>('overview'),
    [data, setData] = useState<OwnerData>();
  const [url, setUrl] = useState(''),
    [email, setEmail] = useState(''),
    [password, setPassword] = useState('');
  const [from, setFrom] = useState(addDays(localDay(new Date().toISOString()), -29)),
    [to, setTo] = useState(localDay(new Date().toISOString()));
  const [group, setGroup] = useState<'day' | 'week' | 'month'>('day'),
    [search, setSearch] = useState(''),
    [refresh, setRefresh] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [question, setQuestion] = useState(''),
    [answer, setAnswer] = useState<Answer>(),
    [history, setHistory] = useState<{ question: string }[]>([]),
    [devices, setDevices] = useState<AnalyticsDevice[]>([]),
    [detail, setDetail] = useState<SaleDetails>();
  const [preferences, setPreferences] = useState<OwnerData['forecastSettings']>(),
    [now, setNow] = useState(Date.now());
  const version = useRef(0),
    ready = !!status?.online && !!status.signedIn && !!status.storeId;
  const dataScope = useRef('');
  const syncCheckpoint = status?.sync.pending === 0 ? status.sync.lastSync : null;
  const resetData = () => {
    setData(undefined);
    setAnswer(undefined);
    setHistory([]);
    setDevices([]);
    setDetail(undefined);
    setSearch('');
  };
  useEffect(() => {
    let active = true,
      running = false;
    const load = async () => {
      if (running) return;
      running = true;
      try {
        const s = await api('analyticsStatus', {});
        if (active) {
          setStatus(s);
          setUrl((v) => v || s.url);
          setNow(Date.now());
          if (!s.signedIn) setTab('connection');
          if (!s.online || !s.signedIn) resetData();
        }
      } catch {
        // Session expiry is handled by the shared IPC client and local lock flow.
      } finally {
        running = false;
      }
    };
    void load();
    const timer = setInterval(() => void load(), 15000);
    const offline = () => {
      version.current++;
      resetData();
      setStatus((s) => (s ? { ...s, online: false } : s));
    };
    const online = () => void load();
    window.addEventListener('offline', offline);
    window.addEventListener('online', online);
    return () => {
      active = false;
      version.current++;
      clearInterval(timer);
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', online);
    };
  }, []);
  useEffect(() => {
    const current = ++version.current;
    const scope = `${status?.storeId}:${from}:${to}`;
    if (dataScope.current !== scope) {
      resetData();
      dataScope.current = scope;
    }
    setError('');
    if (!ready) {
      resetData();
      setBusy(false);
      return;
    }
    let active = true;
    setBusy(true);
    void Promise.all([
      api('analyticsData', { from, to }),
      api('analyticsHistory', {}),
      api('analyticsDevices', {}),
    ])
      .then(([result, h, d]) => {
        if (active && current === version.current) {
          setData(result);
          setPreferences(result.forecastSettings);
          setHistory(h);
          setDevices(d);
        }
      })
      .catch((e) => {
        if (active && current === version.current) {
          setError(t(e.message));
          void api('analyticsStatus', {})
            .then((s) => {
              if (active) setStatus(s);
            })
            .catch(() => {});
        }
      })
      .finally(() => {
        if (active && current === version.current) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [ready, status?.storeId, from, to, refresh, syncCheckpoint]);
  const perform = async (fn: () => Promise<void>) => {
    const current = version.current;
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      if (current === version.current) {
        setError(e instanceof Error ? t(e.message) : t('analyticsRequest'));
        void api('analyticsStatus', {})
          .then(setStatus)
          .catch(() => {});
      }
    } finally {
      if (current === version.current) setBusy(false);
    }
  };
  const update = () =>
    void perform(async () => {
      setStatus(await api('analyticsStatus', {}));
      setRefresh((v) => v + 1);
    });
  const ask = (q: string) =>
    void perform(async () => {
      const current = version.current,
        result = await api('analyticsQuestion', { question: q });
      if (current !== version.current) return;
      setAnswer(result);
      setHistory((h) => [{ question: q }, ...h].slice(0, 10));
    });
  const name = (p: { name: string; nameSi: string }) =>
    i18n.language === 'si' ? p.nameSi || p.name : p.name;
  const stamp = freshness(data?.store.last_synced ?? null, now),
    report = data?.report;
  const products =
    report?.products.filter((p) =>
      `${p.name} ${p.nameSi} ${p.sku}`.toLowerCase().includes(search.toLowerCase()),
    ) ?? [];
  const exportReport = (report: 'sales' | 'products' | 'daily' | 'forecasts') =>
    void perform(async () => {
      await api('analyticsExport', { report, from, to });
    });
  return (
    <section className="online-analytics">
      <PageTitle
        title={t('nav.analytics')}
        hint={t('analyticsHint')}
        actions={
          <Button variant="outline" disabled={busy} onClick={update}>
            <RefreshCw size={16} />
            {l.refresh}
          </Button>
        }
      />
      <nav
        className="oa-tabs"
        role="tablist"
        aria-label={t('nav.analytics')}
        onKeyDown={(e) => {
          const i = tabs.indexOf(tab);
          let next = i;
          if (e.key === 'ArrowRight') next = (i + 1) % tabs.length;
          else if (e.key === 'ArrowLeft') next = (i + tabs.length - 1) % tabs.length;
          else if (e.key === 'Home') next = 0;
          else if (e.key === 'End') next = tabs.length - 1;
          else return;
          e.preventDefault();
          setTab(tabs[next]);
          e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next].focus();
        }}
      >
        {tabs.map((key) => (
          <button
            key={key}
            type="button"
            id={`oa-tab-${key}`}
            role="tab"
            aria-controls={`oa-panel-${key}`}
            aria-selected={tab === key}
            tabIndex={tab === key ? 0 : -1}
            className={tab === key ? 'oa-tab-active' : ''}
            onClick={() => {
              setTab(key);
              setSearch('');
            }}
          >
            {key === 'connection' ? t('analyticsConnection') : l[key]}
          </button>
        ))}
      </nav>
      <div
        className={`oa-connectivity ${status?.online ? 'oa-online' : 'oa-offline'}`}
        role="status"
      >
        {status?.online ? <Cloud size={17} /> : <CloudOff size={17} />}
        <span>
          {status?.online ? t('analyticsServerReady') : t('analyticsOffline')}{' '}
          {data?.store.last_synced && ` · ${stamp.text}`}
        </span>
      </div>
      {error && (
        <p className="oa-error" role="alert">
          {error}
        </p>
      )}
      <div role="tabpanel" id={`oa-panel-${tab}`} aria-labelledby={`oa-tab-${tab}`}>
        {tab === 'connection' ? (
          <div className="oa-connection-grid">
            <section className="panel oa-section">
              <h2>{t('analyticsAccount')}</h2>
              <p>{t('analyticsAccountHint')}</p>
              {!status?.signedIn ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void perform(async () => {
                      const current = version.current,
                        s = await api('analyticsLogin', { url, email, password });
                      if (current !== version.current) return;
                      setPassword('');
                      setStatus(s);
                      setRefresh((v) => v + 1);
                    });
                  }}
                  className="oa-form"
                >
                  <label>
                    {l.server}
                    <input
                      type="url"
                      required
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      placeholder="https://analytics.example.com"
                    />
                  </label>
                  <label>
                    {l.email}
                    <input
                      type="email"
                      required
                      autoComplete="username"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </label>
                  <label>
                    {l.password}
                    <input
                      type="password"
                      required
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </label>
                  <Button disabled={busy}>{l.signIn}</Button>
                </form>
              ) : (
                <>
                  <p>{status.url}</p>
                  <label className="oa-field">
                    {l.store}
                    <select
                      aria-label={l.store}
                      disabled={busy}
                      value={status.storeId}
                      onChange={(e) =>
                        void perform(async () => {
                          setStatus(await api('analyticsSelectStore', { storeId: e.target.value }));
                          setRefresh((v) => v + 1);
                        })
                      }
                    >
                      {status.stores.map((s) => (
                        <option value={s.id} key={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {!status.stores.length && <p>{t('analyticsNoStore')}</p>}
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void perform(async () => {
                        version.current++;
                        resetData();
                        setStatus(await api('analyticsLogout', {}));
                        setBusy(false);
                      })
                    }
                  >
                    <LogOut size={16} />
                    {l.logout}
                  </Button>
                </>
              )}
            </section>
            <section className="panel oa-section">
              <h2>{t('analyticsPOSConnection')}</h2>
              <p>{t('analyticsLinkHint')}</p>
              <dl className="oa-sync-details">
                <dt>{l.pending}</dt>
                <dd>{status?.sync.pending ?? 0}</dd>
                <dt>{l.lastSync}</dt>
                <dd>
                  {status?.sync.lastSync ? new Date(status.sync.lastSync).toLocaleString() : '—'}
                </dd>
                <dt>{t('analyticsLinkedStore')}</dt>
                <dd>
                  {status?.sync.connected
                    ? (status.stores.find((s) => s.id === status.sync.storeId)?.name ??
                      status.sync.storeId)
                    : t('analyticsNotLinked')}
                </dd>
              </dl>
              {status?.sync.error && <p className="oa-error">{status.sync.error}</p>}
              {!status?.sync.connected ? (
                <Button
                  disabled={!ready || busy}
                  onClick={() =>
                    void perform(async () => {
                      setStatus(await api('analyticsLink', { confirm: 'CONNECT' }));
                      setRefresh((v) => v + 1);
                    })
                  }
                >
                  {t('analyticsConnectPOS')}
                </Button>
              ) : (
                <div className="oa-buttons">
                  <Button
                    disabled={!status.online || busy || status.sync.busy}
                    onClick={() =>
                      void perform(async () => {
                        await api('cloudRetry', {});
                        setStatus(await api('analyticsStatus', {}));
                        setRefresh((v) => v + 1);
                      })
                    }
                  >
                    {t('analyticsSyncNow')}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={!status.online || busy || status.sync.busy}
                    onClick={() => {
                      if (window.confirm(l.rebuildHint))
                        void perform(async () => {
                          await api('cloudRebuild', { confirm: 'REBUILD' });
                          setStatus(await api('analyticsStatus', {}));
                          setRefresh((v) => v + 1);
                        });
                    }}
                  >
                    {l.rebuild}
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={!status.online || busy || status.sync.busy}
                    onClick={() =>
                      void perform(async () => {
                        await api('cloudDisconnect', {});
                        setStatus(await api('analyticsStatus', {}));
                        setRefresh((v) => v + 1);
                      })
                    }
                  >
                    {l.disconnect}
                  </Button>
                </div>
              )}
              <h3>{l.devices}</h3>
              {devices
                .filter((d) => !d.revoked)
                .map((d) => (
                  <div className="oa-device" key={d.id}>
                    <span>{d.id.slice(0, 8)}</span>
                    <Button
                      variant="ghost"
                      disabled={!ready || busy}
                      onClick={() =>
                        void perform(async () => {
                          await api('analyticsRevokeDevice', { deviceId: d.id });
                          setRefresh((v) => v + 1);
                        })
                      }
                    >
                      {l.revoke}
                    </Button>
                  </div>
                ))}
              {!devices.some((d) => !d.revoked) && <p>{l.noDevice}</p>}
            </section>
            {ready && preferences && (
              <section className="panel oa-section">
                <h2>{l.forecast}</h2>
                <form
                  className="oa-preferences"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void perform(async () => {
                      await api('analyticsForecastSettings', preferences);
                      setRefresh((v) => v + 1);
                    });
                  }}
                >
                  {(Object.keys(preferences) as (keyof typeof preferences)[]).map((k) => (
                    <label key={k}>
                      {l[k]}
                      <input
                        type="number"
                        required
                        min={k === 'safetyStock' || k === 'minimumOrder' ? 0 : 0.001}
                        max={k === 'horizon' ? 90 : k === 'leadDays' ? 180 : 1000000}
                        step={k === 'horizon' || k === 'leadDays' ? 1 : 0.001}
                        value={preferences[k]}
                        onChange={(e) =>
                          setPreferences({ ...preferences, [k]: Number(e.target.value) })
                        }
                      />
                    </label>
                  ))}
                  <Button disabled={busy}>{l.save}</Button>
                </form>
              </section>
            )}
          </div>
        ) : !ready ? (
          <section className="panel oa-network-gate">
            <CloudOff size={34} />
            <h2>{status?.signedIn ? t('analyticsOffline') : t('analyticsSignIn')}</h2>
            <p>{t('analyticsOnlineOnly')}</p>
            <Button onClick={() => setTab('connection')}>{t('analyticsConnection')}</Button>
          </section>
        ) : (
          <>
            <div className="oa-toolbar">
              <label>
                {l.store}
                <select
                  aria-label={l.store}
                  disabled={busy}
                  value={status.storeId}
                  onChange={(e) =>
                    void perform(async () =>
                      setStatus(await api('analyticsSelectStore', { storeId: e.target.value })),
                    )
                  }
                >
                  {status.stores.map((s) => (
                    <option value={s.id} key={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="oa-dates">
                <label>
                  {l.from}
                  <input
                    type="date"
                    aria-label={l.from}
                    max={to}
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                  />
                </label>
                <label>
                  {l.to}
                  <input
                    type="date"
                    aria-label={l.to}
                    min={from}
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                  />
                </label>
              </div>
            </div>
            <p className={stamp.stale ? 'oa-stale' : 'oa-period'}>
              {l.period}: {from} — {to} · {stamp.text}
              {stamp.stale && ` · ${l.stale}`}
            </p>
            {busy && !data && <Loading />}
            {data && report && (
              <>
                {tab === 'overview' && (
                  <>
                    <div className="oa-metrics">
                      {(['revenue', 'grossProfit', 'netProfit', 'refunds'] as const).map((k) => (
                        <div key={k}>
                          <span>{l[k]}</span>
                          <strong>{money(report.summary[k])}</strong>
                        </div>
                      ))}
                    </div>
                    <div className="oa-secondary">
                      {(['bills', 'average', 'customerCredit', 'supplierBalance'] as const).map(
                        (k) => (
                          <div key={k}>
                            <span>{l[k]}</span>
                            <strong>
                              {k === 'bills' ? report.summary[k] : money(report.summary[k])}
                            </strong>
                          </div>
                        ),
                      )}
                    </div>
                    <section className="panel oa-section">
                      <div className="oa-section-heading">
                        <h2>{t('analyticsTrend')}</h2>
                        <select
                          aria-label={t('analyticsGrouping')}
                          value={group}
                          onChange={(e) => setGroup(e.target.value as typeof group)}
                        >
                          <option value="day">{t('analyticsDaily')}</option>
                          <option value="week">{t('analyticsWeekly')}</option>
                          <option value="month">{t('analyticsMonthly')}</option>
                        </select>
                        <Button variant="ghost" onClick={() => exportReport('daily')}>
                          <Download size={16} />
                          CSV
                        </Button>
                      </div>
                      <ResponsiveContainer width="100%" height={260}>
                        <AreaChart data={groupTrend(report.daily, group)}>
                          <CartesianGrid stroke="var(--line)" vertical={false} />
                          <XAxis dataKey="date" tickFormatter={(v) => v.slice(5)} minTickGap={45} />
                          <YAxis tickFormatter={(v) => `${Math.round(v / 100000)}k`} />
                          <Tooltip formatter={(v) => money(Number(v))} />
                          <Area
                            dataKey="revenue"
                            stroke="var(--green)"
                            fill="var(--green-light)"
                            strokeWidth={2}
                            isAnimationActive={false}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </section>
                    <section className="panel oa-section">
                      <h2>{t('analyticsTopProducts')}</h2>
                      <Table
                        rows={[...report.products]
                          .sort((a, b) => b.revenue - a.revenue)
                          .slice(0, 10)
                          .map((p) => ({ ...p, name: name(p) }))}
                        columns={['name', 'quantity', 'unit', 'revenue', 'profit']}
                      />
                    </section>
                  </>
                )}
                {tab === 'sales' && (
                  <section className="panel oa-section">
                    <div className="oa-section-heading">
                      <SearchBox value={search} onChange={setSearch} />
                      <Button variant="ghost" onClick={() => exportReport('sales')}>
                        <Download size={16} />
                        CSV
                      </Button>
                    </div>
                    <Table
                      rows={report.sales.filter((s) =>
                        String(s.bill_no).toLowerCase().includes(search.toLowerCase()),
                      )}
                      columns={['bill_no', 'created_at', 'total', 'refunds', 'cost']}
                      onOpen={(r) =>
                        void perform(async () => {
                          const current = version.current,
                            result = await api('analyticsSale', { saleId: String(r.id) });
                          if (current === version.current) setDetail(result);
                        })
                      }
                    />
                  </section>
                )}
                {tab === 'inventory' && (
                  <section className="panel oa-section">
                    <div className="oa-section-heading">
                      <SearchBox value={search} onChange={setSearch} />
                      <Button variant="ghost" onClick={() => exportReport('products')}>
                        <Download size={16} />
                        CSV
                      </Button>
                    </div>
                    <Table
                      rows={products.map((p) => ({ ...p, name: name(p) }))}
                      columns={[
                        'name',
                        'sku',
                        'available',
                        'expired',
                        'unit',
                        'quantity',
                        'revenue',
                      ]}
                      onOpen={(r) => {
                        setTab('forecasts');
                        setSearch(String(r.name));
                      }}
                    />
                    <h2>{t('analyticsSlowProducts')}</h2>
                    <Table
                      rows={[...products]
                        .filter((p) => p.active)
                        .sort((a, b) => a.quantity - b.quantity)
                        .slice(0, 10)
                        .map((p) => ({ ...p, name: name(p) }))}
                      columns={['name', 'quantity', 'available', 'unit']}
                    />
                  </section>
                )}
                {tab === 'forecasts' && (
                  <section className="panel oa-section">
                    <p>{t('analyticsForecastHint')}</p>
                    <div className="oa-section-heading">
                      <SearchBox value={search} onChange={setSearch} />
                      <Button variant="ghost" onClick={() => exportReport('forecasts')}>
                        <Download size={16} />
                        CSV
                      </Button>
                    </div>
                    <Table
                      rows={data.forecasts
                        .filter((f) =>
                          `${f.name} ${f.nameSi}`.toLowerCase().includes(search.toLowerCase()),
                        )
                        .map((f) => ({
                          name: name(f),
                          forecast: `${f.predicted.toFixed(3)} ${f.unit} / ${f.horizon} days`,
                          suggested: f.suggested === null ? '—' : `${f.suggested} ${f.unit}`,
                          method: f.method,
                          history: f.historyDays,
                          evaluation:
                            f.mae === null
                              ? '—'
                              : `MAE ${f.mae.toFixed(3)} / ${f.backtestDays} days`,
                          explanation: f.explanation,
                          warning: f.warning ?? '',
                        }))}
                    />
                  </section>
                )}
                {tab === 'analyst' && (
                  <section className="panel oa-section">
                    <form
                      className="oa-ask"
                      onSubmit={(e) => {
                        e.preventDefault();
                        ask(question);
                      }}
                    >
                      <label>
                        {l.question}
                        <textarea
                          required
                          minLength={3}
                          maxLength={500}
                          value={question}
                          onChange={(e) => setQuestion(e.target.value)}
                          placeholder={suggestedQuestions[0]}
                        />
                      </label>
                      <Button disabled={busy}>{l.ask}</Button>
                    </form>
                    <div className="oa-suggestions">
                      {suggestedQuestions.map((q) => (
                        <Button
                          variant="outline"
                          key={q}
                          disabled={busy}
                          onClick={() => {
                            setQuestion(q);
                            ask(q);
                          }}
                        >
                          {q}
                        </Button>
                      ))}
                    </div>
                    {answer && (
                      <section className="oa-answer">
                        <h2>{answer.answer.interpretation}</h2>
                        <p>
                          {answer.answer.from} — {answer.answer.to} ·{' '}
                          {freshness(answer.lastSynced).text}
                        </p>
                        <Table rows={answer.answer.rows} />
                      </section>
                    )}
                    <h2>{l.history}</h2>
                    {history.map((h, i) => (
                      <button
                        type="button"
                        className="oa-history"
                        disabled={busy}
                        key={i}
                        onClick={() => {
                          setQuestion(h.question);
                          ask(h.question);
                        }}
                      >
                        {h.question}
                      </button>
                    ))}
                  </section>
                )}
                {tab === 'alerts' && (
                  <section className="panel oa-section">
                    <h2>{l.low}</h2>
                    <Table
                      rows={report.products
                        .filter((p) => p.active && p.available <= p.reorderLevel)
                        .map((p) => ({ ...p, name: name(p) }))}
                      columns={['name', 'available', 'reorderLevel', 'unit']}
                      onOpen={(r) => {
                        setTab('inventory');
                        setSearch(String(r.name));
                      }}
                    />
                    <h2>{l.expiry}</h2>
                    <Table
                      rows={report.products.flatMap((p) =>
                        p.nearExpiry.map((b) => ({
                          name: name(p),
                          expiry_date: b.expiry_date,
                          quantity: b.qty,
                          unit: p.unit,
                        })),
                      )}
                      onOpen={(r) => {
                        setTab('inventory');
                        setSearch(String(r.name));
                      }}
                    />
                  </section>
                )}
              </>
            )}
          </>
        )}
      </div>
      <Modal
        open={!!detail}
        onClose={() => setDetail(undefined)}
        title={String(detail?.sale.bill_no ?? l.view)}
        wide
      >
        {detail && (
          <>
            <h3>{l.product}</h3>
            <Table
              rows={detail.items}
              columns={['name_en', 'qty', 'unit', 'unit_price', 'discount', 'line_total']}
            />
            <h3>{t('analyticsRecordedPayments')}</h3>
            <Table rows={detail.payments} columns={['method', 'amount', 'tendered']} />
            <h3>{l.refunds}</h3>
            <Table rows={detail.returns} columns={['created_at', 'method', 'total', 'cost']} />
          </>
        )}
      </Modal>
    </section>
  );
}
