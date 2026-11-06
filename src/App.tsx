import {
  Component,
  Suspense,
  lazy,
  useEffect,
  useLayoutEffect,
  useState,
  type ErrorInfo,
  type ReactNode,
} from 'react';
import {
  HashRouter,
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  ArrowRightLeft,
  ClipboardCheck,
  Activity,
  ArrowRight,
  BarChart3,
  Bell,
  Boxes,
  ChevronRight,
  ClipboardList,
  CreditCard,
  FileClock,
  LayoutDashboard,
  Leaf,
  LockKeyhole,
  LogOut,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  PackageCheck,
  ReceiptText,
  RotateCcw,
  Settings2,
  ShieldCheck,
  ShoppingBasket,
  ShoppingCart,
  Store,
  Sun,
  Truck,
  Wallet,
} from 'lucide-react';
import { Toaster } from 'sonner';
import { useStore } from './store';
import { api } from './lib/api';
import { safe } from './lib/utils';
import { Button } from './components/ui/button';
import { Modal } from './components/ui/dialog';
import { Loading } from './components/common';
import CashierPinForm from './components/CashierPinForm';
import { RecordForm, field } from './components/forms';
const Stocktaking = lazy(() => import('./features/Stocktaking'));
const SupplierReturns = lazy(() => import('./features/SupplierReturns'));
const Checkout = lazy(() => import('./features/Checkout'));
const Dashboard = lazy(() => import('./features/Dashboard'));
const Products = lazy(() => import('./features/Products'));
const Records = lazy(() => import('./features/Records'));
const Purchases = lazy(() => import('./features/Purchases'));
const Returns = lazy(() => import('./features/Returns'));
const Sales = lazy(() => import('./features/Sales'));
const Held = lazy(() => import('./features/Held'));
const Reports = lazy(() => import('./features/Reports'));
const Settings = lazy(() => import('./features/Settings'));
class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info);
  }
  render() {
    return this.state.failed ? (
      <div className="fatal">
        <ShieldCheck size={40} />
        <h1>Ajith Super Market</h1>
        <Button onClick={() => window.location.reload()}>↻</Button>
      </div>
    ) : (
      this.props.children
    );
  }
}
function Brand({ small = false }: { small?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className={`brand ${small ? 'brand-small' : ''}`}>
      <div className="brand-icon">
        <ShoppingBasket size={small ? 23 : 28} />
        <Leaf className="brand-leaf" size={13} />
      </div>
      <div>
        <strong>Ajith</strong>
        <span>{t('shop').replace(/Ajith |අජිත් /, '')}</span>
      </div>
    </div>
  );
}
function LanguageButton() {
  const { i18n, t } = useTranslation();
  const user = useStore((s) => s.user);
  return (
    <Button
      variant="ghost"
      className="language-button"
      aria-label={t('language')}
      onClick={() =>
        safe(async () => {
          const language = i18n.language === 'en' ? 'si' : 'en';
          localStorage.setItem('ajith-language', language);
          await i18n.changeLanguage(language);
          document.documentElement.lang = language;
          if (user) {
            const updated = await api('language', { language });
            useStore.setState({ user: updated });
          }
        })
      }
    >
      <span className={i18n.language === 'si' ? 'active-lang' : ''}>සිංහල</span>
      <span className="lang-divider" />
      <span className={i18n.language === 'en' ? 'active-lang' : ''}>English</span>
    </Button>
  );
}
function Login() {
  const { t, i18n } = useTranslation(undefined, { lng: 'en' });
  const login = useStore((s) => s.login);
  const [pinMode, setPinMode] = useState(false);
  const [busy, setBusy] = useState(false);
  useLayoutEffect(() => {
    // The sign-in screen is English; account language is restored by login/boot.
    void i18n.changeLanguage('en');
    document.documentElement.lang = 'en';
  }, [i18n]);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<{ username: string; password: string }>({
    resolver: zodResolver(z.object({ username: z.string().min(1), password: z.string().min(1) })),
  });
  return (
    <div className="signin-page" lang="en">
      <aside className="signin-identity">
        <Brand />
        <div className="signin-intro">
          <div className="signin-store-mark" aria-hidden="true">
            <Store size={42} strokeWidth={1.5} />
          </div>
          <h1>
            Ajith
            <br />
            Super Market
          </h1>
          <p>
            Billing and stock management,
            <br />
            ready for your working day.
          </p>
        </div>
        <div className="signin-local">
          <ShieldCheck size={18} />
          <span>{t('localData')}</span>
        </div>
      </aside>
      <main className="signin-access">
        <div className="signin-status">
          <span />
          {t('offline')}
        </div>
        <section className="signin-form-shell" aria-labelledby="signin-title">
          <h2 id="signin-title">{t('welcome')}</h2>
          <p>{t('loginHint')}</p>
          <div className="signin-methods" role="group" aria-label="Sign-in method">
            <button type="button" aria-pressed={!pinMode} onClick={() => setPinMode(false)}>
              {t('password')}
            </button>
            <button type="button" aria-pressed={pinMode} onClick={() => setPinMode(true)}>
              {t('cashierPin')}
            </button>
          </div>
          {pinMode ? (
            <CashierPinForm />
          ) : (
            <form
              className="signin-password-form"
              onSubmit={(e) => {
                void handleSubmit(async (values) => {
                  setBusy(true);
                  try {
                    await login(values.username, values.password);
                  } finally {
                    setBusy(false);
                  }
                })(e).catch(() => {});
              }}
            >
              <label className="field">
                <span>{t('username')}</span>
                <input
                  {...register('username')}
                  autoFocus
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  aria-invalid={!!errors.username}
                />
              </label>
              <label className="field">
                <span>{t('password')}</span>
                <input
                  {...register('password')}
                  type="password"
                  autoComplete="current-password"
                  aria-invalid={!!errors.password}
                />
              </label>
              <Button className="signin-submit" disabled={busy || !window.pos}>
                <span>{busy ? t('loading') : t('signIn')}</span>
                <ArrowRight size={18} />
              </Button>
            </form>
          )}
          {!window.pos && <div className="notice notice-amber">{t('noElectron')}</div>}
          <p className="signin-help">
            <LockKeyhole size={14} />
            <span>Use the account provided by your store owner.</span>
          </p>
        </section>
        <footer className="signin-credit">
          Developed by <strong>Deshan Dinidu</strong>
        </footer>
      </main>
    </div>
  );
}
function PasswordChange() {
  const { t } = useTranslation();
  const user = useStore((s) => s.user)!;
  const boot = useStore((s) => s.boot);
  return (
    <div className="password-page">
      <div className="panel password-panel">
        <Brand />
        <h1>{t('changePassword')}</h1>
        <p className="muted">{t('changePasswordHint')}</p>
        <RecordForm
          fields={[
            field('current', { type: 'password', required: true }),
            field('newPassword', { type: 'password', required: true }),
            ...(user.role === 'owner' ? [field('pin', { type: 'password', required: true })] : []),
          ]}
          onSave={async (v) => {
            await api('changePassword', {
              current: String(v.current),
              password: String(v.newPassword),
              ...(user.role === 'owner' ? { pin: String(v.pin) } : {}),
            });
            await boot();
          }}
          submit="savePassword"
        />
      </div>
    </div>
  );
}
const entries = [
  { path: 'checkout', icon: ShoppingCart, owner: false },
  { path: 'dashboard', icon: LayoutDashboard, owner: true },
  { path: 'held', icon: FileClock, owner: false },
  { path: 'returns', icon: RotateCcw, owner: false },
  { path: 'sales', icon: ReceiptText, owner: false },
  { path: 'products', icon: Boxes, owner: true },
  { path: 'stocktaking', icon: ClipboardCheck, owner: true },
  { path: 'categories', icon: ClipboardList, owner: true },
  { path: 'suppliers', icon: Truck, owner: true },
  { path: 'purchases', icon: PackageCheck, owner: true },
  { path: 'supplierReturns', icon: Truck, owner: true },
  { path: 'cheques', icon: CreditCard, owner: true },
  { path: 'expenses', icon: Wallet, owner: true },
  { path: 'reports', icon: BarChart3, owner: true },
  { path: 'audit', icon: Activity, owner: true },
  { path: 'settings', icon: Settings2, owner: true },
];
function Shell() {
  const { t } = useTranslation();
  const user = useStore((s) => s.user)!,
    data = useStore((s) => s.bootstrap),
    dark = useStore((s) => s.dark),
    toggle = useStore((s) => s.toggleTheme),
    lock = useStore((s) => s.lock);
  const location = useLocation();
  const navigate = useNavigate();
  const [switching, setSwitching] = useState(false);
  const [menu, setMenu] = useState(false),
    [alerts, setAlerts] = useState(false);
  const [sidebarHidden, setSidebarHidden] = useState(
    () => localStorage.getItem('ajith-sidebar-hidden') === 'true',
  );
  const current = location.pathname.slice(1) || 'checkout';
  const count = data
    ? data.alerts.low + data.alerts.expiring + data.alerts.expired + data.alerts.cheques
    : 0;
  useEffect(() => {
    setMenu(false);
  }, [location]);
  useEffect(() => {
    let idle: ReturnType<typeof setTimeout>;
    let last = 0;
    const activity = () => {
      clearTimeout(idle);
      idle = setTimeout(() => safe(lock), (data?.settings.idle_minutes ?? 15) * 60000);
      if (Date.now() - last > 1000) {
        last = Date.now();
        safe(async () => {
          await api('activity', {});
        });
      }
    };
    for (const name of ['pointerdown', 'keydown', 'wheel'])
      window.addEventListener(name, activity, { passive: true });
    activity();
    return () => {
      clearTimeout(idle);
      for (const name of ['pointerdown', 'keydown', 'wheel'])
        window.removeEventListener(name, activity);
    };
  }, [data?.settings.idle_minutes, lock]);
  return (
    <div
      className={`app-shell ${current === 'checkout' ? 'checkout-workspace' : ''} ${sidebarHidden ? 'sidebar-hidden' : ''}`}
    >
      {menu && (
        <button className="sidebar-scrim" aria-label={t('close')} onClick={() => setMenu(false)} />
      )}
      <aside id="workspace-sidebar" className={`sidebar ${menu ? 'sidebar-open' : ''}`}>
        <NavLink to="/checkout" className="brand-link">
          <Brand small />
        </NavLink>
        <nav aria-label={t('workspace')}>
          <span className="nav-label">{t('workspace')}</span>
          {entries
            .filter((e) => !e.owner || user.role === 'owner')
            .map((entry, index) => (
              <div key={entry.path}>
                {entry.path === 'products' && (
                  <span className="nav-label management-label">{t('management')}</span>
                )}
                <NavLink
                  to={`/${entry.path}`}
                  className={({ isActive }) =>
                    `nav-link ${isActive ? 'nav-active' : ''} ${index === 0 ? 'checkout-link' : ''}`
                  }
                >
                  <entry.icon size={19} />
                  <span>{t(`nav.${entry.path}`)}</span>
                  {entry.path === 'held' && <ChevronRight size={13} className="nav-chevron" />}
                </NavLink>
              </div>
            ))}
        </nav>
        <div className="sidebar-footer">
          <div className="offline-dot" />
          <div>
            <strong>{t('offline')}</strong>
            <small>{data?.settings.counter_id ?? 'C1'}</small>
          </div>
          <ShieldCheck size={17} />
        </div>
      </aside>
      <div className="main-shell">
        <header className="app-header">
          <div className="header-left">
            <Button
              variant="ghost"
              size="icon"
              className="menu-button"
              onClick={() => setMenu((v) => !v)}
              aria-label={t('menu')}
              aria-controls="workspace-sidebar"
              aria-expanded={menu}
            >
              <Menu size={21} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="desktop-sidebar-button"
              aria-label={t(sidebarHidden ? 'showSidebar' : 'hideSidebar')}
              title={t(sidebarHidden ? 'showSidebar' : 'hideSidebar')}
              aria-controls="workspace-sidebar"
              aria-expanded={!sidebarHidden}
              onClick={() => {
                const hidden = !sidebarHidden;
                setSidebarHidden(hidden);
                localStorage.setItem('ajith-sidebar-hidden', String(hidden));
              }}
            >
              {sidebarHidden ? <PanelLeftOpen size={20} /> : <PanelLeftClose size={20} />}
            </Button>
            <span className="header-shop">{data?.settings.shop_name ?? 'Ajith Super Market'}</span>
            <ChevronRight size={14} className="muted" />
            <strong>{t(`nav.${current}`)}</strong>
          </div>
          <div className="header-right">
            <LanguageButton />
            <span className="header-divider" />
            <Button variant="ghost" size="icon" onClick={toggle} aria-label={t('theme')}>
              {dark ? <Sun size={19} /> : <Moon size={19} />}
            </Button>
            {user.role === 'owner' && (
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('alerts')}
                onClick={() => setAlerts(true)}
                className="notification"
              >
                <Bell size={20} />
                {count > 0 && <span />}
              </Button>
            )}
            <span className="header-divider" />
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('switchCashier')}
              title={t('switchCashier')}
              onClick={() => setSwitching(true)}
            >
              <ArrowRightLeft size={18} />
            </Button>
            <div className="user-avatar">{user.display_name.slice(0, 1)}</div>
            <div className="header-user">
              <strong>{user.display_name}</strong>
              <small>{t(user.role)}</small>
            </div>
            <Button variant="ghost" size="icon" onClick={() => safe(lock)} aria-label={t('lock')}>
              <LockKeyhole size={18} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => safe(lock)}
              aria-label={t('logout')}
              className="logout-button"
            >
              <LogOut size={18} />
            </Button>
          </div>
        </header>
        <main className={`page-content ${current === 'checkout' ? 'checkout-content' : ''}`}>
          <ErrorBoundary>
            <Suspense fallback={<Loading />}>
              <Routes>
                <Route path="/checkout" element={<Checkout />} />
                <Route path="/held" element={<Held />} />
                <Route path="/returns" element={<Returns />} />
                <Route path="/sales" element={<Sales />} />
                {user.role === 'owner' && (
                  <>
                    <Route path="/dashboard" element={<Dashboard />} />
                    <Route path="/products" element={<Products />} />
                    <Route path="/stocktaking" element={<Stocktaking />} />
                    <Route path="/supplierReturns" element={<SupplierReturns />} />
                    {(
                      ['categories', 'suppliers', 'cheques', 'expenses', 'users', 'audit'] as const
                    ).map((entity) => (
                      <Route
                        key={entity}
                        path={`/${entity}`}
                        element={<Records key={entity} entity={entity} />}
                      />
                    ))}
                    <Route path="/purchases" element={<Purchases />} />
                    <Route path="/reports" element={<Reports />} />
                    <Route path="/settings" element={<Settings />} />
                  </>
                )}
                <Route
                  path="*"
                  element={
                    <Navigate to={user.role === 'owner' ? '/dashboard' : '/checkout'} replace />
                  }
                />
              </Routes>
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>
      <Modal open={switching} onClose={() => setSwitching(false)} title={t('switchCashier')}>
        <p className="record-description">{t('switchCashierHint')}</p>
        <CashierPinForm
          onSuccess={() => {
            setSwitching(false);
            navigate('/checkout');
          }}
        />
      </Modal>
      <Modal open={alerts} onClose={() => setAlerts(false)} title={t('alerts')}>
        <div className="alerts-list">
          {data &&
            (['low', 'expiring', 'expired', 'cheques'] as const).map((key, i) => (
              <NavLink
                key={key}
                to={`/reports?report=${['lowStock', 'expiring', 'expired', 'cheques'][i]}`}
                onClick={() => setAlerts(false)}
              >
                <span>{t(['lowStock', 'expiring', 'expired', 'nav.cheques'][i])}</span>
                <span className="badge badge-amber">{data.alerts[key]}</span>
                <ChevronRight size={16} />
              </NavLink>
            ))}
          {data?.alerts.backup_overdue && (
            <NavLink to="/settings" onClick={() => setAlerts(false)}>
              <span>{t('backupOverdue')}</span>
              <ChevronRight size={16} />
            </NavLink>
          )}
        </div>
      </Modal>
    </div>
  );
}
export default function App() {
  const user = useStore((s) => s.user),
    dark = useStore((s) => s.dark);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }, [dark]);
  return (
    <ErrorBoundary>
      <HashRouter>
        {!user ? (
          <Login />
        ) : user.must_change_password ? (
          <PasswordChange />
        ) : (
          <Shell key={user.id} />
        )}
        <Toaster richColors position="top-right" theme={dark ? 'dark' : 'light'} closeButton />
      </HashRouter>
    </ErrorBoundary>
  );
}
