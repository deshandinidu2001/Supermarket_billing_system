import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import {
  ShoppingBasket,
  RefreshCw,
  LogOut,
  ArrowUpRight,
  Cloud,
  Search,
  Download,
} from 'lucide-react';
import {
  request,
  SessionExpired,
  money,
  displayValue,
  freshness,
  csv,
  type OwnerData,
  type OwnerStore,
  type Answer,
} from '../../../packages/analytics/client';
import { labels, suggestedQuestions, type Label } from '../../../packages/analytics/locales';
import { addDays, localDay, groupTrend } from '../../../packages/analytics/engine';
import './style.css';

const tabs = [
  'overview',
  'sales',
  'inventory',
  'forecasts',
  'analyst',
  'alerts',
  'settings',
] as const;
type Tab = (typeof tabs)[number];
type Row = Record<string, unknown>;
function Table({
  rows,
  columns,
  onRow,
}: {
  rows: Row[];
  columns?: string[];
  onRow?: (row: Row) => void;
}) {
  const keys = columns ?? Object.keys(rows[0] ?? {});
  return rows.length ? (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {keys.map((k) => (
              <th key={k}>{k.replaceAll('_', ' ')}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {keys.map((k, j) => (
                <td key={k}>
                  {j === 0 && onRow ? (
                    <button className="link" onClick={() => onRow(r)}>
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
  ) : (
    <p className="empty">No records for this period.</p>
  );
}
function App() {
  const [language, setLanguage] = useState<'en' | 'si'>(
      localStorage.getItem('owner-language') === 'si' ? 'si' : 'en',
    ),
    t = labels[language];
  const [signed, setSigned] = useState(false),
    [checking, setChecking] = useState(true),
    [stores, setStores] = useState<OwnerStore[]>([]),
    [storeId, setStoreId] = useState('');
  const [data, setData] = useState<OwnerData>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [tab, setTab] = useState<Tab>('overview'),
    [search, setSearch] = useState('');
  const [from, setFrom] = useState(addDays(localDay(new Date().toISOString()), -29)),
    [to, setTo] = useState(localDay(new Date().toISOString())),
    [refresh, setRefresh] = useState(0);
  const [question, setQuestion] = useState(''),
    [answer, setAnswer] = useState<Answer>(),
    [history, setHistory] = useState<{ question: string }[]>([]),
    [code, setCode] = useState(''),
    [devices, setDevices] = useState<{ id: string; revoked: boolean }[]>([]),
    [detail, setDetail] = useState<Row>();
  const [email, setEmail] = useState(''),
    [password, setPassword] = useState('');
  const [now, setNow] = useState(Date.now());
  const [group, setGroup] = useState<'day' | 'week' | 'month'>('day');
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  const clear = () => {
    setSigned(false);
    setStores([]);
    setStoreId('');
    setData(undefined);
    setAnswer(undefined);
    setHistory([]);
    setDevices([]);
    setCode('');
    setDetail(undefined);
  };
  const action = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      if (e instanceof SessionExpired) clear();
      setError(e instanceof Error ? e.message : 'Request failed.');
    } finally {
      setBusy(false);
    }
  };
  const loadStores = async () => {
    const list = await request<OwnerStore[]>('', '/stores');
    setStores(list);
    setStoreId(list[0]?.id ?? '');
    setSigned(true);
  };
  useEffect(() => {
    void loadStores()
      .catch(() => {})
      .finally(() => setChecking(false));
  }, []);
  useEffect(() => {
    if (!signed || !storeId) return;
    let active = true;
    setBusy(true);
    setData(undefined);
    setError('');
    void request<OwnerData>('', `/stores/${storeId}/analytics?from=${from}&to=${to}`)
      .then((result) => {
        if (active) setData(result);
      })
      .catch((e) => {
        if (active) {
          if (e instanceof SessionExpired) clear();
          setError(e.message);
        }
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [signed, storeId, from, to, refresh]);
  useEffect(() => {
    if (!storeId || !signed) return;
    setCode('');
    setAnswer(undefined);
    setHistory([]);
    setDetail(undefined);
    let active = true;
    void Promise.all([
      request<{ question: string }[]>('', `/stores/${storeId}/questions`),
      request<typeof devices>('', `/stores/${storeId}/devices`),
    ])
      .then(([h, d]) => {
        if (active) {
          setHistory(h);
          setDevices(d);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [storeId, signed]);
  const selection = useRef(storeId);
  selection.current = storeId;
  const scoped = async <T,>(path: string, body?: unknown): Promise<T> => {
    const id = storeId,
      result = await request<T>('', `/stores/${id}${path}`, body);
    if (selection.current !== id)
      throw new Error('Store selection changed. Retry for the selected store.');
    return result;
  };
  const ask = (q: string) =>
    void action(async () => {
      const result = await scoped<Answer>('/questions', { question: q });
      setAnswer(result);
      setHistory((h) => [{ question: q }, ...h].slice(0, 10));
    });
  const exportRows = (rows: Row[]) => {
    const link = document.createElement('a'),
      url = URL.createObjectURL(new Blob([csv(rows)], { type: 'text/csv;charset=utf-8' }));
    link.href = url;
    link.download = `ajith-${tab}-${from}-${to}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const displayName = (p: { name: string; nameSi: string }) =>
    language === 'si' ? p.nameSi || p.name : p.name;
  if (checking)
    return (
      <main className="login">
        <p>{t.loading}</p>
      </main>
    );
  if (!signed)
    return (
      <main className="login">
        <section>
          <ShoppingBasket size={38} />
          <h1>
            Ajith
            <br />
            Owner insights
          </h1>
          <p>{t.readOnly}</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void action(async () => {
                await request('', '/auth/login', { email, password, client: 'web' });
                setPassword('');
                await loadStores();
              });
            }}
          >
            <label>
              {t.email}
              <input
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label>
              {t.password}
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <button disabled={busy}>{busy ? t.loading : t.signIn}</button>
          </form>
        </section>
      </main>
    );
  const stamp = freshness(data?.store.last_synced ?? null, now),
    report = data?.report;
  const filtered =
    report?.products.filter((p) =>
      `${p.name} ${p.nameSi} ${p.sku}`.toLowerCase().includes(search.toLowerCase()),
    ) ?? [];
  return (
    <div className="shell">
      <aside>
        <div className="brand">
          <ShoppingBasket />
          <strong>
            Ajith<span>Owner insights</span>
          </strong>
        </div>
        <nav aria-label="Main navigation">
          {tabs.map((key) => (
            <button
              key={key}
              className={tab === key ? 'active' : ''}
              onClick={() => {
                setTab(key);
                setSearch('');
              }}
            >
              {t[key]}
              {key === 'analyst' && <ArrowUpRight size={16} />}
            </button>
          ))}
        </nav>
        <div className="aside-bottom">
          <p>{t.readOnly}</p>
          <button
            className="quiet"
            onClick={() =>
              void action(async () => {
                try {
                  await request('', '/auth/logout', {});
                } finally {
                  clear();
                }
              })
            }
          >
            <LogOut size={17} />
            {t.logout}
          </button>
        </div>
      </aside>
      <main>
        <header>
          <div>
            <p className="subtle">{t.store}</p>
            <select
              aria-label={t.store}
              value={storeId}
              onChange={(e) => {
                setData(undefined);
                setStoreId(e.target.value);
              }}
            >
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="header-actions">
            <select
              aria-label={t.language}
              value={language}
              onChange={(e) => {
                const lang = e.target.value as 'en' | 'si';
                setLanguage(lang);
                localStorage.setItem('owner-language', lang);
              }}
            >
              <option value="en">English</option>
              <option value="si">සිංහල</option>
            </select>
            <button className="quiet" disabled={busy} onClick={() => setRefresh((r) => r + 1)}>
              <RefreshCw size={17} />
              {t.refresh}
            </button>
          </div>
        </header>
        <div className={`sync-strip ${stamp.stale ? 'stale' : ''}`} role="status">
          <Cloud size={16} />
          <span>
            {stamp.text}
            {stamp.stale && data?.store.last_synced ? ` · ${t.stale}` : ''}
          </span>
        </div>
        <div className="page-heading">
          <h1>{t[tab]}</h1>
          <div className="dates">
            <label>
              {t.from}
              <input type="date" max={to} value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label>
              {t.to}
              <input type="date" min={from} value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
          </div>
        </div>
        {error && (
          <div className="error" role="alert">
            {error}
            <button className="quiet" onClick={() => setRefresh((r) => r + 1)}>
              {t.retry}
            </button>
          </div>
        )}
        {busy && !data && <p>{t.loading}</p>}
        {!stores.length && <p>No stores have been assigned to this owner.</p>}
        {report && data && (
          <>
            {tab === 'overview' && (
              <>
                <section className="earnings">
                  {(['revenue', 'grossProfit', 'netProfit', 'refunds'] as const).map((k, i) => (
                    <div key={k} className={i === 0 ? 'primary-metric' : ''}>
                      <p>{t[k]}</p>
                      <strong>{money(report.summary[k])}</strong>
                    </div>
                  ))}
                </section>
                <div className="mini-metrics">
                  {(['bills', 'average', 'customerCredit', 'supplierBalance'] as const).map((k) => (
                    <div key={k}>
                      <span>{t[k]}</span>
                      <strong>
                        {k === 'bills' ? report.summary[k] : money(report.summary[k])}
                      </strong>
                    </div>
                  ))}
                </div>
                <section className="chart-block">
                  <div className="section-heading">
                    <h2>Sales through the period</h2>
                    <select
                      aria-label="Group sales by"
                      value={group}
                      onChange={(e) => setGroup(e.target.value as typeof group)}
                    >
                      <option value="day">Daily</option>
                      <option value="week">Weekly</option>
                      <option value="month">Monthly</option>
                    </select>
                    <span>
                      {from} — {to}
                    </span>
                  </div>
                  <ResponsiveContainer width="100%" height={260}>
                    <AreaChart data={groupTrend(report.daily, group)}>
                      <CartesianGrid vertical={false} stroke="#e5ede7" />
                      <XAxis dataKey="date" tickFormatter={(v) => v.slice(5)} minTickGap={45} />
                      <YAxis tickFormatter={(v) => `${Math.round(v / 100000)}k`} />
                      <Tooltip formatter={(v) => money(Number(v))} />
                      <Area
                        type="monotone"
                        dataKey="revenue"
                        stroke="#176448"
                        fill="#dceee3"
                        strokeWidth={2}
                        isAnimationActive={false}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </section>
                <section>
                  <div className="section-heading">
                    <h2>Products driving sales</h2>
                    <button className="quiet" onClick={() => setTab('inventory')}>
                      {t.inventory}
                      <ArrowUpRight size={17} />
                    </button>
                  </div>
                  <Table
                    rows={[...report.products]
                      .sort((a, b) => b.revenue - a.revenue)
                      .slice(0, 8)
                      .map((p) => ({
                        [t.product]: displayName(p),
                        [t.quantity]: `${p.quantity.toFixed(3)} ${p.unit}`,
                        [t.revenue]: money(p.revenue),
                        [t.profit]: money(p.profit),
                      }))}
                  />
                </section>
              </>
            )}
            {tab === 'sales' && (
              <>
                <SearchBox value={search} onChange={setSearch} label={t.search} />
                <Table
                  rows={report.sales
                    .filter((s) => String(s.bill_no).toLowerCase().includes(search.toLowerCase()))
                    .map((s) => ({
                      bill: String(s.bill_no),
                      date: new Date(String(s.created_at)).toLocaleString(),
                      total: money(Number(s.total)),
                      refunds: money(Number(s.refunds)),
                      id: s.id,
                    }))}
                  columns={['bill', 'date', 'total', 'refunds']}
                  onRow={(r) =>
                    void action(async () => setDetail(await scoped<Row>(`/sales/${r.id}`)))
                  }
                />
              </>
            )}
            {tab === 'inventory' && (
              <>
                <div className="section-heading">
                  <SearchBox value={search} onChange={setSearch} label={t.search} />
                  <button
                    className="quiet"
                    onClick={() => exportRows(filtered as unknown as Row[])}
                  >
                    <Download size={16} />
                    CSV
                  </button>
                </div>
                <Table
                  rows={filtered.map((p) => ({
                    [t.product]: displayName(p),
                    SKU: p.sku,
                    [t.available]: `${p.available.toFixed(3)} ${p.unit}`,
                    [t.expired]: p.expired,
                    [t.quantity]: p.quantity,
                    [t.revenue]: money(p.revenue),
                  }))}
                />
                <h2>Slow-moving products</h2>
                <Table
                  rows={[...filtered]
                    .filter((p) => p.active)
                    .sort((a, b) => a.quantity - b.quantity)
                    .slice(0, 10)
                    .map((p) => ({
                      name: displayName(p),
                      quantity: p.quantity,
                      available: p.available,
                      unit: p.unit,
                    }))}
                />
              </>
            )}
            {tab === 'forecasts' && (
              <>
                <p className="explanation">
                  Forecasts estimate units sold from completed days. Returns stay in financial
                  reporting. Stockouts can hide demand; no orders are placed automatically.
                </p>
                <Table
                  rows={data.forecasts.map((f) => ({
                    [t.product]: language === 'si' ? f.nameSi || f.name : f.name,
                    [t.forecast]: `${f.predicted.toFixed(2)} ${f.unit} / ${f.horizon} days`,
                    [t.reorder]:
                      f.suggested === null ? 'Insufficient history' : `${f.suggested} ${f.unit}`,
                    method: f.method,
                    history: `${f.historyDays} days`,
                    evaluation:
                      f.mae === null
                        ? 'Not evaluated'
                        : `MAE ${f.mae.toFixed(3)} over ${f.backtestDays} days`,
                    explanation: f.explanation,
                    warning: f.warning ?? '',
                  }))}
                />
              </>
            )}
            {tab === 'analyst' && (
              <section className="analyst">
                <p>Ask about sales, profit and stock using the data uploaded by your store.</p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    ask(question);
                  }}
                >
                  <label>
                    {t.question}
                    <textarea
                      value={question}
                      maxLength={500}
                      minLength={3}
                      required
                      onChange={(e) => setQuestion(e.target.value)}
                      placeholder="What are the top 5 items this week?"
                    />
                  </label>
                  <button disabled={busy}>
                    {t.ask}
                    <ArrowUpRight size={16} />
                  </button>
                </form>
                <div className="suggestions">
                  {suggestedQuestions.map((q) => (
                    <button
                      className="quiet"
                      disabled={busy}
                      key={q}
                      onClick={() => {
                        setQuestion(q);
                        ask(q);
                      }}
                    >
                      {q}
                    </button>
                  ))}
                </div>
                {answer && (
                  <section className="answer">
                    <h2>{answer.answer.interpretation}</h2>
                    <p>
                      {answer.answer.from} {answer.answer.to && `— ${answer.answer.to}`} ·{' '}
                      {freshness(answer.lastSynced).text}
                    </p>
                    <Table rows={answer.answer.rows} />
                  </section>
                )}
                <h2>{t.history}</h2>
                {history.map((h, i) => (
                  <button
                    className="history-question"
                    key={i}
                    disabled={busy}
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
              <>
                <h2>{t.low}</h2>
                <Table
                  rows={report.products
                    .filter((p) => p.active && p.available <= p.reorderLevel)
                    .map((p) => ({
                      name: displayName(p),
                      available: p.available,
                      reorderLevel: p.reorderLevel,
                      unit: p.unit,
                    }))}
                  onRow={(r) => {
                    setTab('inventory');
                    setSearch(String(r.name));
                  }}
                />
                <h2>{t.expiry}</h2>
                <Table
                  rows={report.products.flatMap((p) =>
                    p.nearExpiry.map((b) => ({
                      name: displayName(p),
                      expiry: b.expiry_date,
                      quantity: b.qty,
                      unit: p.unit,
                    })),
                  )}
                  onRow={(r) => {
                    setTab('inventory');
                    setSearch(String(r.name));
                  }}
                />
                {stamp.stale && (
                  <p className="error">
                    {t.stale}. {stamp.text}
                  </p>
                )}
              </>
            )}
            {tab === 'settings' && (
              <div className="settings-grid">
                <section>
                  <h2>{t.enrollment}</h2>
                  <p>{t.codeHint}</p>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void action(async () =>
                        setCode((await scoped<{ code: string }>('/enrollment', {})).code),
                      )
                    }
                  >
                    {t.createCode}
                  </button>
                  {code && <output className="enrollment-code">{code}</output>}
                  <h2>{t.devices}</h2>
                  {devices
                    .filter((d) => !d.revoked)
                    .map((d) => (
                      <p key={d.id}>
                        {d.id.slice(0, 8)}{' '}
                        <button
                          className="quiet"
                          onClick={() =>
                            void action(async () => {
                              await scoped(`/devices/${d.id}/revoke`, {});
                              setDevices((ds) =>
                                ds.map((v) => (v.id === d.id ? { ...v, revoked: true } : v)),
                              );
                            })
                          }
                        >
                          {t.revoke}
                        </button>
                      </p>
                    ))}
                  {!devices.some((d) => !d.revoked) && <p>{t.noDevice}</p>}
                  <p>{t.privacy}</p>
                </section>
                <ForecastForm
                  key={`${storeId}-${JSON.stringify(data.forecastSettings)}`}
                  value={data.forecastSettings}
                  t={t}
                  busy={busy}
                  onSave={(settings) =>
                    void action(async () => {
                      await scoped('/forecast-settings', settings);
                      setRefresh((v) => v + 1);
                    })
                  }
                />
              </div>
            )}
          </>
        )}
        {detail && (
          <div className="modal-backdrop">
            <section className="modal" role="dialog" aria-modal="true" aria-label="Sale details">
              <button className="quiet" onClick={() => setDetail(undefined)}>
                Close
              </button>
              <h2>{String((detail.sale as Row)?.bill_no)}</h2>
              <h3>Items</h3>
              <Table
                rows={detail.items as Row[]}
                columns={['name_en', 'qty', 'unit', 'unit_price', 'discount', 'line_total']}
              />
              <h3>Recorded payments</h3>
              <Table rows={detail.payments as Row[]} columns={['method', 'amount', 'tendered']} />
              <h3>Refunds</h3>
              <Table
                rows={detail.returns as Row[]}
                columns={['created_at', 'method', 'total', 'cost']}
              />
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
function SearchBox({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
}) {
  return (
    <label className="search">
      <Search size={17} />
      <input
        aria-label={label}
        placeholder={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
function ForecastForm({
  value,
  t,
  busy,
  onSave,
}: {
  value: OwnerData['forecastSettings'];
  t: typeof labels.en | typeof labels.si;
  busy: boolean;
  onSave: (v: OwnerData['forecastSettings']) => void;
}) {
  const [settings, setSettings] = useState(value);
  return (
    <section>
      <h2>{t.forecast}</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave(settings);
        }}
      >
        {(Object.keys(settings) as (keyof typeof settings)[]).map((key) => (
          <label key={key}>
            {t[key as Label]}
            <input
              type="number"
              min={key === 'safetyStock' || key === 'minimumOrder' ? 0 : 1}
              max={key === 'horizon' ? 90 : key === 'leadDays' ? 180 : 1000000}
              step={['leadDays', 'horizon'].includes(key) ? 1 : 'any'}
              required
              value={settings[key]}
              onChange={(e) => setSettings({ ...settings, [key]: Number(e.target.value) })}
            />
          </label>
        ))}
        <button disabled={busy}>{t.save}</button>
      </form>
    </section>
  );
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
