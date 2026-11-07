import { useEffect, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import * as SecureStore from 'expo-secure-store';
import {
  ScrollView,
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView, SafeAreaProvider } from 'react-native-safe-area-context';
import {
  request,
  SessionExpired,
  freshness,
  money,
  displayValue,
  type OwnerData,
  type OwnerStore,
  type Answer,
} from '../../packages/analytics/client';
import { addDays, localDay } from '../../packages/analytics/engine';
import { labels, suggestedQuestions, type Label } from '../../packages/analytics/locales';
import { writeCache, readCache, clearCache } from './src/cache';
type Tab = 'overview' | 'sales' | 'inventory' | 'forecasts' | 'analyst' | 'alerts' | 'settings';
const tabs: Tab[] = [
  'overview',
  'sales',
  'inventory',
  'forecasts',
  'analyst',
  'alerts',
  'settings',
];
type Row = Record<string, unknown>;
interface Session {
  token: string;
  ownerId: string;
  base: string;
  stores: OwnerStore[];
}
function Button({
  title,
  onPress,
  disabled = false,
  quiet = false,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  quiet?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[s.button, quiet && s.quiet, disabled && { opacity: 0.5 }]}
    >
      <Text style={[s.buttonText, quiet && s.quietText]}>{title}</Text>
    </Pressable>
  );
}
function Field({
  title,
  value,
  onChange,
  secure = false,
}: {
  title: string;
  value: string;
  onChange: (v: string) => void;
  secure?: boolean;
}) {
  return (
    <View style={s.field}>
      <Text style={s.label}>{title}</Text>
      <TextInput
        accessibilityLabel={title}
        style={s.input}
        value={value}
        onChangeText={onChange}
        secureTextEntry={secure}
        autoCapitalize="none"
        autoCorrect={false}
      />
    </View>
  );
}
function Rows({ rows }: { rows: Row[] }) {
  return (
    <>
      {rows.map((r, i) => (
        <View key={i} style={s.row}>
          {Object.entries(r).map(([k, v]) => (
            <Text key={k} style={s.detailText}>
              {k.replaceAll('_', ' ')}: {displayValue(k, v)}
            </Text>
          ))}
        </View>
      ))}
    </>
  );
}
export default function App() {
  return (
    <SafeAreaProvider>
      <OwnerApp />
    </SafeAreaProvider>
  );
}
function OwnerApp() {
  const [session, setSession] = useState<Session>(),
    [ready, setReady] = useState(false),
    [base, setBase] = useState(process.env.EXPO_PUBLIC_API_URL ?? ''),
    [email, setEmail] = useState(''),
    [password, setPassword] = useState('');
  const [language, setLanguage] = useState<'en' | 'si'>('en'),
    t = labels[language],
    [storeId, setStoreId] = useState(''),
    [tab, setTab] = useState<Tab>('overview');
  const [data, setData] = useState<OwnerData>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [cached, setCached] = useState<string>(),
    [search, setSearch] = useState('');
  const [from, setFrom] = useState(addDays(localDay(new Date().toISOString()), -29)),
    [to, setTo] = useState(localDay(new Date().toISOString())),
    [question, setQuestion] = useState(''),
    [answer, setAnswer] = useState<Answer>(),
    [history, setHistory] = useState<{ question: string }[]>([]),
    [detail, setDetail] = useState<Row>();
  const [settings, setSettings] = useState<OwnerData['forecastSettings']>(),
    [now, setNow] = useState(Date.now());
  const generation = useRef(0),
    cacheQueue = useRef(Promise.resolve()),
    account = useRef<Session | undefined>(undefined);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  const wipe = async () => {
    generation.current++;
    account.current = undefined;
    setSession(undefined);
    setStoreId('');
    setData(undefined);
    setAnswer(undefined);
    setHistory([]);
    setDetail(undefined);
    setCached(undefined);
    await cacheQueue.current.catch(() => {});
    await clearCache();
    await SecureStore.deleteItemAsync('ajith_owner_session');
  };
  const selected = useRef(storeId);
  selected.current = storeId;
  const call = async <T,>(path: string, body?: unknown): Promise<T> => {
    const id = storeId,
      result = await request<T>(session!.base, path, body, session!.token);
    if (path.startsWith('/stores/') && selected.current !== id)
      throw new Error('Store selection changed. Retry for the selected store.');
    return result;
  };
  useEffect(() => {
    void (async () => {
      try {
        const raw = await SecureStore.getItemAsync('ajith_owner_session'),
          lang = await SecureStore.getItemAsync('ajith_owner_language');
        if (lang === 'si') setLanguage('si');
        if (raw) {
          const saved = JSON.parse(raw) as Session;
          account.current = saved;
          setSession(saved);
          setBase(saved.base);
          setStoreId(saved.stores[0]?.id ?? '');
        }
      } catch {
        await clearCache();
        await SecureStore.deleteItemAsync('ajith_owner_session');
      } finally {
        setReady(true);
      }
    })();
  }, []);
  const action = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      if (e instanceof SessionExpired) await wipe();
      setError(e instanceof Error ? e.message : 'Request failed.');
    } finally {
      setBusy(false);
    }
  };
  const load = async () => {
    if (!session || !storeId) return;
    const current = ++generation.current;
    setBusy(true);
    setError('');
    try {
      const result = await call<OwnerData>(`/stores/${storeId}/analytics?from=${from}&to=${to}`);
      if (current !== generation.current) return;
      setData(result);
      setSettings(result.forecastSettings);
      setCached(undefined);
      cacheQueue.current = cacheQueue.current
        .catch(() => {})
        .then(async () => {
          if (account.current?.ownerId === session.ownerId && current === generation.current)
            await writeCache(session.ownerId, storeId, result);
        });
    } catch (e) {
      if (current !== generation.current) return;
      if (e instanceof SessionExpired) {
        await wipe();
        setError(e.message);
        return;
      }
      const saved = await readCache(session.ownerId, storeId);
      if (current !== generation.current) return;
      if (saved) {
        setData(saved.data);
        setSettings(saved.data.forecastSettings);
        setCached(saved.savedAt);
      }
      setError(e instanceof Error ? e.message : 'Unable to refresh.');
    } finally {
      if (current === generation.current) setBusy(false);
    }
  };
  useEffect(() => {
    setData(undefined);
    setCached(undefined);
    setAnswer(undefined);
    setHistory([]);
    setDetail(undefined);
    setSearch('');
    void load();
    return () => {
      generation.current++;
    };
  }, [session, storeId, from, to]);
  useEffect(() => {
    if (!session || !storeId) return;
    let active = true;
    void call<{ question: string }[]>(`/stores/${storeId}/questions`)
      .then((h) => {
        if (active) setHistory(h);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [session, storeId]);
  const ask = (q: string) =>
    void action(async () => {
      const current = generation.current,
        result = await call<Answer>(`/stores/${storeId}/questions`, { question: q });
      if (current !== generation.current) return;
      setAnswer(result);
      setHistory((h) => [{ question: q }, ...h].slice(0, 10));
    });
  const name = (p: { name: string; nameSi: string }) =>
    language === 'si' ? p.nameSi || p.name : p.name;
  if (!ready)
    return (
      <SafeAreaView style={s.root}>
        <ActivityIndicator />
      </SafeAreaView>
    );
  if (!session)
    return (
      <SafeAreaView style={s.root}>
        <StatusBar style="dark" />
        <ScrollView contentContainerStyle={s.login} keyboardShouldPersistTaps="handled">
          <Text style={s.brand}>Ajith</Text>
          <Text style={s.title}>Owner insights</Text>
          <Text style={s.muted}>{t.readOnly}</Text>
          <Field title="Analytics server URL" value={base} onChange={setBase} />
          <Field title={t.email} value={email} onChange={setEmail} />
          <Field title={t.password} value={password} onChange={setPassword} secure />
          {error && (
            <Text accessibilityRole="alert" style={s.error}>
              {error}
            </Text>
          )}
          <Button
            title={busy ? t.loading : t.signIn}
            disabled={busy}
            onPress={() =>
              void action(async () => {
                const url = new URL(base);
                if (url.protocol !== 'https:' && !__DEV__)
                  throw new Error('Use an HTTPS server address.');
                const auth = await request<{ token: string; ownerId: string }>(
                    url.origin,
                    '/auth/login',
                    { email, password, client: 'mobile' },
                  ),
                  stores = await request<OwnerStore[]>(
                    url.origin,
                    '/stores',
                    undefined,
                    auth.token,
                  ),
                  value = { ...auth, base: url.origin, stores };
                await clearCache();
                await SecureStore.setItemAsync('ajith_owner_session', JSON.stringify(value), {
                  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
                });
                account.current = value;
                setSession(value);
                setStoreId(stores[0]?.id ?? '');
                setPassword('');
              })
            }
          />
        </ScrollView>
      </SafeAreaView>
    );
  const report = data?.report,
    stamp = freshness(data?.store.last_synced ?? null, now),
    products =
      report?.products.filter((p) =>
        `${p.name} ${p.nameSi} ${p.sku}`.toLowerCase().includes(search.toLowerCase()),
      ) ?? [];
  return (
    <SafeAreaView style={s.root}>
      <StatusBar style="dark" />
      <View style={s.header}>
        <View>
          <Text style={s.brand}>Ajith</Text>
          <Text style={s.muted}>
            {session.stores.find((st) => st.id === storeId)?.name ?? t.store}
          </Text>
        </View>
        <Button title={t.refresh} quiet onPress={() => void load()} disabled={busy} />
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={s.tabs}
        contentContainerStyle={s.tabContent}
      >
        {tabs.map((key) => (
          <Pressable
            key={key}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === key }}
            onPress={() => {
              setTab(key);
              setSearch('');
            }}
            style={[s.tab, tab === key && s.selected]}
          >
            <Text style={[s.tabText, tab === key && s.selectedText]}>{t[key]}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={busy} onRefresh={() => void load()} />}
      >
        <Text style={[s.sync, stamp.stale && s.warning]}>
          {stamp.text}
          {stamp.stale ? ` · ${t.stale}` : ''}
        </Text>
        {cached && (
          <Text style={s.warning}>
            {t.cached}: {new Date(cached).toLocaleString()}. Limited saved summary; some lists may
            be incomplete.
          </Text>
        )}
        <Text accessibilityRole="header" style={s.title}>
          {t[tab]}
        </Text>
        <Text style={s.muted}>
          {t.period}: {data?.report.from ?? from} — {data?.report.to ?? to}
        </Text>
        <DateRange
          from={from}
          to={to}
          onChange={(f, d) => {
            setFrom(f);
            setTo(d);
          }}
        />
        {error && (
          <View>
            <Text accessibilityRole="alert" style={s.error}>
              {error}
            </Text>
            <Button title={t.retry} quiet onPress={() => void load()} />
          </View>
        )}
        {!session.stores.length && <Text>No stores are assigned to this owner.</Text>}
        {data && report && (
          <>
            {tab === 'overview' && (
              <>
                <View style={s.metrics}>
                  {(
                    ['revenue', 'grossProfit', 'netProfit', 'refunds', 'bills', 'average'] as const
                  ).map((key) => (
                    <View key={key} style={[s.metric, key === 'revenue' && s.revenue]}>
                      <Text style={[s.metricLabel, key === 'revenue' && s.white]}>{t[key]}</Text>
                      <Text style={[s.metricValue, key === 'revenue' && s.white]}>
                        {key === 'bills' ? report.summary[key] : money(report.summary[key])}
                      </Text>
                    </View>
                  ))}
                </View>
                <Text style={s.heading}>Sales trend · last 14 days</Text>
                <View style={s.chart}>
                  {report.daily.slice(-14).map((d) => (
                    <View key={d.date} style={s.barColumn}>
                      <View
                        style={[
                          s.bar,
                          {
                            height: Math.max(
                              2,
                              (Math.max(0, d.revenue) /
                                Math.max(1, ...report.daily.slice(-14).map((v) => v.revenue))) *
                                100,
                            ),
                          },
                        ]}
                      />
                      <Text style={s.barLabel}>{d.date.slice(8)}</Text>
                    </View>
                  ))}
                </View>
                <Text style={s.muted}>
                  {t.customerCredit}: {money(report.summary.customerCredit)}
                  {`\n`}
                  {t.supplierBalance}: {money(report.summary.supplierBalance)}
                </Text>
                <Text style={s.heading}>Top products by revenue</Text>
                {[...report.products]
                  .sort((a, b) => b.revenue - a.revenue)
                  .slice(0, 5)
                  .map((p) => (
                    <View key={p.id} style={s.row}>
                      <Text style={s.rowTitle}>{name(p)}</Text>
                      <Text>
                        {money(p.revenue)} · {p.quantity.toFixed(3)} {p.unit}
                      </Text>
                    </View>
                  ))}
              </>
            )}
            {tab === 'sales' && (
              <>
                <Field title={t.search} value={search} onChange={setSearch} />
                {report.sales
                  .filter((r) => String(r.bill_no).toLowerCase().includes(search.toLowerCase()))
                  .map((sale) => (
                    <Pressable
                      accessibilityRole="button"
                      key={String(sale.id)}
                      style={s.row}
                      onPress={() =>
                        void action(async () => {
                          const current = generation.current,
                            result = await call<Row>(`/stores/${storeId}/sales/${sale.id}`);
                          if (current === generation.current) setDetail(result);
                        })
                      }
                    >
                      <Text style={s.rowTitle}>{sale.bill_no}</Text>
                      <Text>
                        {money(Number(sale.total))} ·{' '}
                        {new Date(String(sale.created_at)).toLocaleString()}
                      </Text>
                      <Text style={s.muted}>
                        {t.refunds}: {money(Number(sale.refunds))} · {t.view}
                      </Text>
                    </Pressable>
                  ))}
                {detail && (
                  <View style={s.detail}>
                    <Button title="Close details" quiet onPress={() => setDetail(undefined)} />
                    <Text style={s.heading}>{String((detail.sale as Row)?.bill_no)}</Text>
                    {(['items', 'payments', 'returns'] as const).map((section) => (
                      <View key={section}>
                        <Text style={s.heading}>{section}</Text>
                        <Rows
                          rows={((detail[section] as Row[]) ?? []).map((r) =>
                            Object.fromEntries(
                              Object.entries(r).filter(([k]) => !k.endsWith('id')),
                            ),
                          )}
                        />
                      </View>
                    ))}
                  </View>
                )}
              </>
            )}
            {tab === 'inventory' && (
              <>
                <Field title={t.search} value={search} onChange={setSearch} />
                {products.map((p) => (
                  <Pressable
                    accessibilityRole="button"
                    key={p.id}
                    style={s.row}
                    onPress={() => {
                      setSearch(p.name);
                      setTab('forecasts');
                    }}
                  >
                    <Text style={s.rowTitle}>{name(p)}</Text>
                    <Text>
                      {t.available}: {p.available.toFixed(3)} {p.unit} · {t.expired}:{' '}
                      {p.expired.toFixed(3)}
                    </Text>
                    <Text style={s.muted}>
                      {p.sku} · {t.quantity}: {p.quantity.toFixed(3)} · {t.revenue}:{' '}
                      {money(p.revenue)}
                    </Text>
                  </Pressable>
                ))}
              </>
            )}
            {tab === 'forecasts' && (
              <>
                <Text style={s.muted}>
                  Observed unit sales, not guaranteed demand. Returns stay in financial reporting.
                  No automatic orders.
                </Text>
                <Field title={t.search} value={search} onChange={setSearch} />
                {data.forecasts
                  .filter((f) =>
                    `${f.name} ${f.nameSi}`.toLowerCase().includes(search.toLowerCase()),
                  )
                  .map((f) => (
                    <View key={f.productId} style={s.row}>
                      <Text style={s.rowTitle}>{name(f)}</Text>
                      <Text>
                        {t.forecast}: {f.predicted.toFixed(2)} {f.unit} / {f.horizon} days
                      </Text>
                      <Text style={s.forecastOrder}>
                        {t.reorder}: {f.suggested === null ? '—' : `${f.suggested} ${f.unit}`}
                      </Text>
                      <Text style={s.muted}>
                        {f.method} · {f.historyDays} history days
                        {f.mae !== null
                          ? ` · MAE ${f.mae.toFixed(3)} (${f.backtestDays} test days)`
                          : ''}
                      </Text>
                      <Text style={s.muted}>{f.explanation}</Text>
                      {f.warning && <Text style={s.warning}>{f.warning}</Text>}
                    </View>
                  ))}
              </>
            )}
            {tab === 'analyst' && (
              <>
                <Field title={t.question} value={question} onChange={setQuestion} />
                <Button
                  title={t.ask}
                  disabled={busy || question.trim().length < 3 || !!cached}
                  onPress={() => ask(question)}
                />
                {suggestedQuestions.map((q) => (
                  <Button
                    key={q}
                    title={q}
                    quiet
                    disabled={busy || !!cached}
                    onPress={() => {
                      setQuestion(q);
                      ask(q);
                    }}
                  />
                ))}
                {answer && (
                  <View style={s.detail}>
                    <Text style={s.heading}>{answer.answer.interpretation}</Text>
                    <Text style={s.muted}>
                      {answer.answer.from} — {answer.answer.to}
                      {`\n`}
                      {freshness(answer.lastSynced).text}
                    </Text>
                    <Rows rows={answer.answer.rows} />
                  </View>
                )}
                <Text style={s.heading}>{t.history}</Text>
                {history.map((h, i) => (
                  <Button
                    key={i}
                    title={h.question}
                    quiet
                    disabled={busy || !!cached}
                    onPress={() => {
                      setQuestion(h.question);
                      ask(h.question);
                    }}
                  />
                ))}
              </>
            )}
            {tab === 'alerts' && (
              <>
                {stamp.stale && (
                  <Text style={s.warning}>
                    {t.stale}. {stamp.text}
                  </Text>
                )}
                <Text style={s.heading}>{t.low}</Text>
                {report.products
                  .filter((p) => p.active && p.available <= p.reorderLevel)
                  .map((p) => (
                    <Pressable
                      accessibilityRole="button"
                      style={s.row}
                      key={p.id}
                      onPress={() => {
                        setTab('inventory');
                        setSearch(p.name);
                      }}
                    >
                      <Text style={s.rowTitle}>{name(p)}</Text>
                      <Text>
                        {t.available}: {p.available} {p.unit} · reorder level {p.reorderLevel}
                      </Text>
                    </Pressable>
                  ))}
                <Text style={s.heading}>{t.expiry}</Text>
                {report.products.flatMap((p) =>
                  p.nearExpiry.map((b) => (
                    <Pressable
                      accessibilityRole="button"
                      key={String(b.id)}
                      style={s.row}
                      onPress={() => {
                        setTab('inventory');
                        setSearch(p.name);
                      }}
                    >
                      <Text style={s.rowTitle}>{name(p)}</Text>
                      <Text>
                        {String(b.expiry_date)} · {b.qty} {p.unit}
                      </Text>
                    </Pressable>
                  )),
                )}
              </>
            )}
            {tab === 'settings' && (
              <>
                <Text style={s.heading}>{t.store}</Text>
                {session.stores.map((st) => (
                  <Button
                    key={st.id}
                    title={`${st.id === storeId ? '✓ ' : ''}${st.name}`}
                    quiet
                    onPress={() => {
                      generation.current++;
                      setData(undefined);
                      setStoreId(st.id);
                    }}
                  />
                ))}
                <Text style={s.heading}>{t.language}</Text>
                <Button
                  quiet
                  title={language === 'en' ? 'සිංහල' : 'English'}
                  onPress={() => {
                    const lang = language === 'en' ? 'si' : 'en';
                    setLanguage(lang);
                    void SecureStore.setItemAsync('ajith_owner_language', lang);
                  }}
                />
                <Text style={s.heading}>{t.forecast}</Text>
                {settings &&
                  (Object.keys(settings) as (keyof typeof settings)[]).map((k) => (
                    <Field
                      key={k}
                      title={t[k as Label]}
                      value={String(settings[k])}
                      onChange={(v) => setSettings({ ...settings, [k]: Number(v) })}
                    />
                  ))}
                <Button
                  title={t.save}
                  disabled={busy || !!cached}
                  onPress={() =>
                    void action(async () => {
                      await call(`/stores/${storeId}/forecast-settings`, settings);
                      await load();
                    })
                  }
                />
                <Text style={s.heading}>Connection</Text>
                <Text style={s.muted}>
                  {session.base}
                  {`\n`}
                  {stamp.text}
                </Text>
                <Text style={s.heading}>Privacy</Text>
                <Text style={s.muted}>{t.privacy}</Text>
                <Button
                  title={t.logout}
                  quiet
                  onPress={() =>
                    void action(async () => {
                      try {
                        await call('/auth/logout', {});
                      } finally {
                        await wipe();
                      }
                    })
                  }
                />
              </>
            )}
            {((tab === 'sales' && !report.sales.length) ||
              (tab === 'inventory' && !products.length)) && <Text style={s.muted}>{t.empty}</Text>}
          </>
        )}
        {busy && !data && <ActivityIndicator color="#176448" />}
      </ScrollView>
    </SafeAreaView>
  );
}
function DateRange({
  from,
  to,
  onChange,
}: {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
}) {
  const [f, setF] = useState(from),
    [t, setT] = useState(to);
  return (
    <View>
      <View style={s.range}>
        <View style={s.flex}>
          <Field title="From (YYYY-MM-DD)" value={f} onChange={setF} />
        </View>
        <View style={s.flex}>
          <Field title="To (YYYY-MM-DD)" value={t} onChange={setT} />
        </View>
      </View>
      <Button
        quiet
        title="Apply dates"
        onPress={() => {
          if (/^\d{4}-\d{2}-\d{2}$/.test(f) && /^\d{4}-\d{2}-\d{2}$/.test(t)) onChange(f, t);
        }}
      />
    </View>
  );
}
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f7faf8' },
  header: {
    paddingHorizontal: 22,
    paddingTop: 18,
    paddingBottom: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  brand: { fontSize: 28, fontWeight: '700', color: '#176448', letterSpacing: -1 },
  title: { fontSize: 28, fontWeight: '600', color: '#17372e', marginTop: 20, marginBottom: 12 },
  muted: { fontSize: 12, color: '#64776e', lineHeight: 20 },
  tabs: { maxHeight: 64, backgroundColor: '#fff' },
  tabContent: { paddingHorizontal: 14, alignItems: 'center', gap: 6 },
  tab: { paddingHorizontal: 15, paddingVertical: 15, minHeight: 48, borderRadius: 7 },
  selected: { backgroundColor: '#e5f1e9' },
  tabText: { fontSize: 13, color: '#64776e' },
  selectedText: { color: '#176448', fontWeight: '600' },
  content: { padding: 20, paddingBottom: 60 },
  sync: { fontSize: 11, color: '#517360', lineHeight: 18 },
  warning: { color: '#996315', fontSize: 12, lineHeight: 20, marginVertical: 8 },
  button: {
    minHeight: 48,
    backgroundColor: '#176448',
    borderRadius: 7,
    paddingHorizontal: 18,
    paddingVertical: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginVertical: 5,
  },
  buttonText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  quiet: { backgroundColor: '#e9f3ed' },
  quietText: { color: '#176448' },
  field: { marginVertical: 9 },
  label: { fontSize: 12, color: '#64776e', marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderColor: '#cbd9d0',
    backgroundColor: '#fff',
    borderRadius: 7,
    padding: 13,
    color: '#17372e',
    fontSize: 14,
    minHeight: 48,
  },
  range: { flexDirection: 'row', gap: 10, marginTop: 8 },
  flex: { flex: 1 },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginVertical: 18 },
  metric: { width: '48%', padding: 16, backgroundColor: '#fff', borderRadius: 10, minHeight: 98 },
  revenue: { backgroundColor: '#176448' },
  metricLabel: { fontSize: 11, color: '#64776e' },
  metricValue: { fontSize: 19, fontWeight: '600', marginTop: 11, color: '#17372e' },
  white: { color: '#fff' },
  heading: { fontSize: 17, fontWeight: '600', color: '#17372e', marginTop: 25, marginBottom: 12 },
  chart: {
    height: 135,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 5,
    marginBottom: 20,
    paddingTop: 10,
  },
  barColumn: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  bar: {
    backgroundColor: '#5a9776',
    width: '80%',
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
  },
  barLabel: { fontSize: 8, color: '#64776e', marginTop: 6 },
  row: { paddingVertical: 17, borderBottomWidth: 1, borderColor: '#dfe9e2', gap: 7 },
  rowTitle: { fontSize: 15, fontWeight: '600', color: '#17372e' },
  forecastOrder: { color: '#176448', fontWeight: '600' },
  detail: { backgroundColor: '#edf4ef', padding: 16, borderRadius: 8, marginTop: 16 },
  detailText: { fontSize: 12, lineHeight: 20, paddingVertical: 3 },
  error: {
    backgroundColor: '#fff0dc',
    color: '#864d0d',
    padding: 14,
    borderRadius: 6,
    fontSize: 13,
    marginVertical: 12,
    lineHeight: 20,
  },
  login: { padding: 30, paddingTop: 70 },
});
