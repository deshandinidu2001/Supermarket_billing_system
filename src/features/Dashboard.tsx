import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Banknote,
  ChartNoAxesCombined,
  CircleDollarSign,
  ReceiptText,
  ShoppingCart,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '../lib/api';
import { money, rangeFor } from '../lib/utils';
import { useStore } from '../store';
import { Button } from '../components/ui/button';
import { ErrorState, Loading, PageTitle, RangeFilter, useLoad } from '../components/common';
export default function Dashboard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [range, setRange] = useState(rangeFor('month'));
  const { data, error, reload } = useLoad(() => api('dashboard', range), [range.from, range.to]);
  const bootstrap = useStore((s) => s.bootstrap);
  const format = (value: unknown) => money(Number(value));
  const axis = (v: number) => (v >= 100000 ? `${(v / 100000).toFixed(0)}k` : (v / 100).toFixed(0));
  return (
    <>
      <PageTitle
        title={t('nav.dashboard')}
        hint={t('overviewHint')}
        actions={
          <Button onClick={() => navigate('/checkout')}>
            <ShoppingCart size={16} />
            {t('goCheckout')}
            <ArrowRight size={15} />
          </Button>
        }
      />
      <div className="content-toolbar" style={{ padding: '0 0 22px', border: 0 }}>
        <RangeFilter value={range} onChange={setRange} />
      </div>
      {error ? (
        <ErrorState retry={reload} />
      ) : !data ? (
        <Loading />
      ) : (
        <>
          <div className="stat-grid">
            {[
              {
                label: 'todaysSales',
                value: money(data.today),
                icon: ShoppingCart,
                featured: true,
                foot: 'today',
              },
              { label: 'revenue', value: money(data.revenue), icon: Banknote, foot: 'reportRange' },
              {
                label: 'gross_profit',
                value: money(data.gross_profit),
                icon: TrendingUp,
                foot: 'reportRange',
              },
              {
                label: 'net_profit',
                value: money(data.net_profit),
                icon: Wallet,
                foot: 'reportRange',
              },
              {
                label: 'billCount',
                value: data.bills.toLocaleString('en-LK'),
                icon: ReceiptText,
                foot: 'reportRange',
              },
              {
                label: 'average',
                value: money(data.average),
                icon: CircleDollarSign,
                foot: 'reportRange',
              },
            ].map((stat) => (
              <section
                className={`panel stat-card ${stat.featured ? 'featured' : ''}`}
                key={stat.label}
              >
                <div className="stat-top">
                  <span>{t(stat.label)}</span>
                  <span className="stat-icon">
                    <stat.icon size={16} />
                  </span>
                </div>
                <div className="stat-value">{stat.value}</div>
                <div className="stat-foot">
                  {t(stat.foot)}
                  {stat.foot === 'reportRange' && (
                    <span>
                      · {range.from.split('-').slice(1).reverse().join('/')} –{' '}
                      {range.to.split('-').slice(1).reverse().join('/')}
                    </span>
                  )}
                </div>
              </section>
            ))}
          </div>
          <div className="charts-grid">
            <section className="panel">
              <div className="panel-heading chart-heading">
                <div>
                  <h2>{t('annualTrend')}</h2>
                  <p>{t('last12Months')}</p>
                </div>
                <span className="stat-icon">
                  <ChartNoAxesCombined size={17} />
                </span>
              </div>
              <div className="chart">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.months} barGap={2}>
                    <CartesianGrid strokeDasharray="3 5" vertical={false} stroke="var(--line)" />
                    <XAxis
                      dataKey="month"
                      tickFormatter={(v) =>
                        new Date(`${v}-01T00:00:00`).toLocaleString('en', { month: 'short' })
                      }
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis tickFormatter={axis} width={40} axisLine={false} tickLine={false} />
                    <Tooltip formatter={format} />
                    <Legend iconType="circle" iconSize={7} />
                    <Bar
                      isAnimationActive={false}
                      dataKey="revenue"
                      name={t('revenue')}
                      fill="#217553"
                      radius={[3, 3, 0, 0]}
                      maxBarSize={18}
                    />
                    <Bar
                      isAnimationActive={false}
                      dataKey="profit"
                      name={t('net_profit')}
                      fill="#c5d9a8"
                      radius={[3, 3, 0, 0]}
                      maxBarSize={18}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>
            <section className="panel">
              <div className="panel-heading chart-heading">
                <div>
                  <h2>{t('paymentMix')}</h2>
                  <p>{t('reportRange')}</p>
                </div>
              </div>
              <div className="chart">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    layout="vertical"
                    data={data.methods.map((r) => ({ ...r, label: t(String(r.method)) }))}
                    margin={{ left: 0, right: 20 }}
                  >
                    <CartesianGrid horizontal={false} strokeDasharray="3 5" stroke="var(--line)" />
                    <XAxis type="number" tickFormatter={axis} axisLine={false} tickLine={false} />
                    <YAxis
                      type="category"
                      dataKey="label"
                      width={95}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip formatter={format} />
                    <Bar
                      isAnimationActive={false}
                      dataKey="amount"
                      name={t('amount')}
                      fill="#6f9f85"
                      barSize={20}
                      radius={[0, 4, 4, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>
          </div>
          <div className="charts-grid">
            <section className="panel">
              <div className="panel-heading chart-heading">
                <h2>{t('salesTrend')}</h2>
              </div>
              <div className="chart">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.daily}>
                    <defs>
                      <linearGradient id="salesGreen" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#438d63" stopOpacity={0.18} />
                        <stop offset="100%" stopColor="#438d63" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 5" vertical={false} stroke="var(--line)" />
                    <XAxis
                      dataKey="date"
                      tickFormatter={(v) => v.slice(8)}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis tickFormatter={axis} width={40} axisLine={false} tickLine={false} />
                    <Tooltip formatter={format} />
                    <Area
                      isAnimationActive={false}
                      dataKey="revenue"
                      name={t('revenue')}
                      type="monotone"
                      stroke="#217553"
                      fill="url(#salesGreen)"
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </section>
            <section className="panel">
              <div className="panel-heading chart-heading">
                <h2>{t('peakHours')}</h2>
              </div>
              <div className="chart">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.hours}>
                    <CartesianGrid strokeDasharray="3 5" vertical={false} stroke="var(--line)" />
                    <XAxis
                      dataKey="hour"
                      tickFormatter={(v) =>
                        `${Number(v) % 12 || 12}${Number(v) >= 12 ? 'pm' : 'am'}`
                      }
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis axisLine={false} tickLine={false} width={30} />
                    <Tooltip />
                    <Bar
                      isAnimationActive={false}
                      dataKey="bills"
                      name={t('bills')}
                      fill="#b3c99a"
                      radius={[3, 3, 0, 0]}
                      maxBarSize={22}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>
          </div>
          <section className="panel">
            <div className="panel-heading">
              <h2>{t('monthlyComparison')}</h2>
              <span className="muted">{t('net_profit')}</span>
            </div>
            <div className="panel-body" style={{ display: 'flex', gap: 40, flexWrap: 'wrap' }}>
              {data.comparison.map((row) => (
                <div key={String(row.month)}>
                  <p className="muted" style={{ fontSize: 11, marginBottom: 7 }}>
                    {row.month}
                  </p>
                  <h2>{money(Number(row.profit))}</h2>
                  <p className="muted" style={{ fontSize: 10, marginTop: 6 }}>
                    {t('revenue')}: {money(Number(row.revenue))}
                  </p>
                </div>
              ))}
              <Button
                variant="ghost"
                style={{ marginLeft: 'auto' }}
                onClick={() => navigate('/reports')}
              >
                {t('nav.reports')}
                <ArrowRight size={16} />
              </Button>
            </div>
          </section>
          {bootstrap?.alerts.backup_overdue && (
            <div className="notice notice-amber" style={{ marginTop: 20 }}>
              <span style={{ flex: 1 }}>
                {t('backupOverdue')} · {t('backupHint')}
              </span>
              <Button variant="ghost" size="sm" onClick={() => navigate('/settings')}>
                {t('backupNow')}
              </Button>
            </div>
          )}
        </>
      )}
    </>
  );
}
