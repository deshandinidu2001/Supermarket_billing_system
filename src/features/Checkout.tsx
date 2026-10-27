import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Banknote,
  Barcode,
  Check,
  CheckCheck,
  ChevronDown,
  Cookie,
  CreditCard,
  FileClock,
  Leaf,
  Milk,
  Package,
  Pause,
  Plus,
  Printer,
  QrCode,
  ShieldCheck,
  ShoppingBag,
  ShoppingBasket,
  Split,
  Trash2,
  UserRound,
  Wallet,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { dateString, money, safe } from '../lib/utils';
import { useStore, flushCart } from '../store';
import { cartTotals, roundQty, scaleBarcode } from '../../services/calculations';
import {
  emptyCart,
  type Cart,
  type Payment,
  type PaymentMethod,
  type Product,
  type Row,
} from '../../shared/types';
import { Button } from '../components/ui/button';
import { Modal } from '../components/ui/dialog';
import { Confirm, Empty, SearchBox, useLoad } from '../components/common';
import ReceiptView from '../components/ReceiptView';
import { RecordForm, field } from '../components/forms';
const methodIcons = { cash: Banknote, card: CreditCard, qr: QrCode, credit: Wallet };
function Numeric({
  value,
  onChange,
  min = 0,
  step = '.001',
  label,
  className,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  step?: string;
  label: string;
  className?: string;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return (
    <input
      className={className}
      type="number"
      min={min}
      step={step}
      value={draft}
      aria-label={label}
      onChange={(e) => {
        setDraft(e.target.value);
        if (
          e.target.value !== '' &&
          Number.isFinite(Number(e.target.value)) &&
          Number(e.target.value) >= min
        )
          onChange(Number(e.target.value));
      }}
      onBlur={() => setDraft(String(value))}
    />
  );
}
function CustomerPicker({
  onClose,
  onSelect,
}: {
  onClose: () => void;
  onSelect: (row: Row | null) => void;
}) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const { data } = useLoad(() => api('list', { entity: 'customers', query: q }), [q]);
  return (
    <Modal open onClose={onClose} title={t('selectCustomer')}>
      <SearchBox value={q} onChange={setQ} placeholder={t('customerSearch')} />
      <div className="customer-list">
        <button className="customer-option" onClick={() => onSelect(null)}>
          <strong>{t('walkIn')}</strong>
          <UserRound size={18} />
        </button>
        {data?.map((row) => (
          <button className="customer-option" key={String(row.id)} onClick={() => onSelect(row)}>
            <span>
              <strong>{row.name}</strong>
              <small>{row.phone}</small>
            </span>
            <span>
              {row.points} {t('points')}
              <small>{money(Number(row.balance))}</small>
            </span>
          </button>
        ))}
        {data?.length === 0 && <Empty />}
      </div>
    </Modal>
  );
}
export default function Checkout() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { cart, products, bootstrap: boot, user, mutate, saving, cache, reloadCart } = useStore();
  const [query, setQuery] = useState(''),
    [results, setResults] = useState<Product[]>([]),
    [focused, setFocused] = useState(false),
    [customerOpen, setCustomerOpen] = useState(false),
    [customer, setCustomer] = useState<Row | null>(null),
    [hold, setHold] = useState(false),
    [clear, setClear] = useState(false),
    [split, setSplit] = useState(false),
    [method, setMethod] = useState<PaymentMethod>('cash'),
    [tender, setTender] = useState(''),
    [reference, setReference] = useState(''),
    [paying, setPaying] = useState(false),
    [receipt, setReceipt] = useState<string | null>(null),
    [success, setSuccess] = useState(false);
  const [splitPayments, setSplitPayments] = useState<Payment[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef(crypto.randomUUID());
  const transactionLock = useRef(false);
  useEffect(() => {
    if (!query) {
      setResults([]);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      void api('products', { query, limit: 25 })
        .then((p) => {
          if (live) {
            setResults(p);
            cache(p);
          }
        })
        .catch(() => {});
    }, 70);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, cache]);
  useEffect(() => {
    if (!cart.customer_id) {
      setCustomer(null);
      return;
    }
    void api('list', { entity: 'customers', query: '' })
      .then((rows) => setCustomer(rows.find((r) => r.id === cart.customer_id) ?? null))
      .catch(() => {});
  }, [cart.customer_id]);
  const settings = boot?.settings;
  let totals: ReturnType<typeof cartTotals> | null = null;
  try {
    if (settings) totals = cartTotals(cart, products, settings);
  } catch {
    /* Restored products are loaded alongside their cart. */
  }
  const amount = totals?.total ?? 0;
  const cash = Number(tender || '0') * 100;
  const localName = (p: Product) => (i18n.language === 'si' ? p.name_si : p.name_en);
  const changeCart = (fn: (c: Cart) => Cart) => safe(() => mutate(fn));
  async function add(product: Product, quantity = 1) {
    cache([product]);
    await mutate((c) => {
      const line = c.lines.find((l) => l.product_id === product.id);
      return {
        ...c,
        lines: line
          ? c.lines.map((l) =>
              l.product_id === product.id ? { ...l, qty: roundQty(l.qty + quantity) } : l,
            )
          : [...c.lines, { product_id: product.id, qty: quantity, discount_percent: 0 }],
      };
    });
    setQuery('');
    setFocused(false);
    searchRef.current?.focus();
  }
  function editLine(id: string, key: 'qty' | 'discount_percent', value: number) {
    changeCart((c) => ({
      ...c,
      lines: c.lines.map((l) => (l.product_id === id ? { ...l, [key]: value } : l)),
    }));
  }
  async function scan() {
    if (!query.trim()) return;
    const input = query.trim();
    let found = await api('products', { query: input, limit: 25 });
    if (settings?.scale_enabled && input.startsWith(settings.scale_prefix)) {
      const code = input.slice(
        settings.scale_prefix.length,
        settings.scale_prefix.length + settings.scale_item_digits,
      );
      found = await api('products', { query: code, limit: 5 });
      const decoded = scaleBarcode(input, settings, found);
      if (decoded && decoded.qty > 0) {
        await add(decoded.product, decoded.qty);
        return;
      }
    }
    if (found.length === 1 || found[0]?.barcode === input || found[0]?.sku === input)
      await add(found[0]);
    else if (found.length) {
      setResults(found);
      setFocused(true);
    } else toast.error(t('productUnavailable'));
  }
  async function pay(payments?: Payment[]) {
    if (transactionLock.current || !totals || !cart.lines.length) return;
    transactionLock.current = true;
    setPaying(true);
    try {
      await flushCart();
      const finalPayments = payments ?? [
        { method, amount, reference, tendered: method === 'cash' ? Math.round(cash) : 0 },
      ];
      const result = await api('checkout', {
        payments: finalPayments,
        request_id: requestRef.current,
      });
      requestRef.current = crypto.randomUUID();
      localStorage.setItem(`last-receipt-${user?.id}`, result.bill_no);
      setReceipt(result.bill_no);
      setSuccess(true);
      setSplit(false);
      setTender('');
      setReference('');
      await reloadCart();
      await useStore.getState().boot();
    } finally {
      transactionLock.current = false;
      setPaying(false);
    }
  }
  const lastReceipt = () => {
    const bill = localStorage.getItem(`last-receipt-${user?.id}`);
    if (bill) {
      setReceipt(bill);
      setSuccess(false);
    } else toast.info(t('billNotFound'));
  };
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      const actions: Record<string, () => void> = {
        F2: () => searchRef.current?.focus(),
        F3: () => setCustomerOpen(true),
        F4: () => cart.lines.length && setHold(true),
        F5: () => navigate('/held'),
        F8: () => safe(() => pay()),
        F10: lastReceipt,
        Escape: () => {
          setFocused(false);
          if (query) setQuery('');
          else if (cart.lines.length) setClear(true);
        },
      };
      if (actions[e.key] && !document.querySelector('[role="dialog"]')) {
        e.preventDefault();
        actions[e.key]();
      }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  });
  if (!boot || !settings || !totals) return null;
  const quick = products
    .filter((p) => p.quick_access && p.active)
    .sort((a, b) => a.name_en.localeCompare(b.name_en))
    .slice(0, 12);
  return (
    <div className="checkout-page">
      <div className="checkout-title">
        <div>
          <h1>{t('nav.checkout')}</h1>
          <p>{t('searchHint')}</p>
        </div>
        <div className="checkout-heading-meta">
          <span className="checkout-date">{dateString().split('-').reverse().join('/')}</span>
          <Button variant="outline" size="sm" onClick={() => navigate('/held')}>
            <FileClock size={15} />
            {t('nav.held')}
          </Button>
          <Button variant="outline" size="sm" onClick={lastReceipt}>
            <Printer size={15} />
            {t('lastReceipt')}
          </Button>
        </div>
      </div>
      {!boot.shift && (
        <div className="notice notice-amber">
          <Wallet size={17} />
          <span style={{ flex: 1 }}>{t('noActiveShift')}</span>
          <Button
            size="sm"
            onClick={() =>
              safe(async () => {
                await api('shift', { action: 'start' });
                await useStore.getState().boot();
                toast.success(t('shiftOpen'));
              })
            }
          >
            {t('startShift')}
          </Button>
        </div>
      )}
      <div className="checkout-grid">
        <div className="checkout-left">
          <section className="panel cart-panel">
            <div className="scanner-area">
              <div className="scanner-input">
                <Barcode size={24} />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setFocused(true);
                  }}
                  onFocus={() => setFocused(true)}
                  onBlur={() => setTimeout(() => setFocused(false), 150)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      safe(scan);
                    }
                  }}
                  placeholder={t('scanSearch')}
                  aria-label={t('scanSearch')}
                  autoFocus
                />
                <kbd>F2</kbd>
              </div>
              {query && focused && (
                <div className="search-results">
                  {results.map((p) => (
                    <button
                      key={p.id}
                      className="search-result"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => safe(() => add(p))}
                    >
                      <div className="product-glyph">
                        <Package size={18} />
                      </div>
                      <span className="search-result-name">
                        <strong>{localName(p)}</strong>
                        <small>
                          {i18n.language === 'si' ? p.name_en : p.name_si} · {p.barcode}
                        </small>
                      </span>
                      <span
                        className={`badge ${p.stock <= p.reorder_level ? 'badge-amber' : 'badge-neutral'}`}
                      >
                        {p.stock} {t(`units.${p.unit}`)}
                      </span>
                      <strong>{money(p.selling_price)}</strong>
                    </button>
                  ))}
                  {results.length === 0 && <Empty text={t('empty')} />}
                </div>
              )}
            </div>
            {!cart.lines.length ? (
              <div className="empty-state cart-empty">
                <div className="cart-empty-icon">
                  <ShoppingBasket size={29} />
                </div>
                <h3>{t('emptyCart')}</h3>
                <p>{t('emptyCartHint')}</p>
              </div>
            ) : (
              <div className="cart-scroll">
                <table className="cart-table">
                  <thead>
                    <tr>
                      <th>{t('item')}</th>
                      <th className="price-col numeric">{t('price')}</th>
                      <th>{t('qty')}</th>
                      <th className="discount-col">{t('discount')} %</th>
                      <th className="numeric">{t('total')}</th>
                      <th>
                        <span className="sr-only">{t('remove')}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {totals.lines.map((line) => (
                      <tr key={line.product_id}>
                        <td className="product-name">
                          {localName(line.product)}
                          <span className="product-secondary">
                            {line.product.sku} · {t(`units.${line.product.unit}`)}
                          </span>
                        </td>
                        <td className="price-col numeric">{money(line.product.selling_price)}</td>
                        <td>
                          <Numeric
                            value={line.qty}
                            min={0.001}
                            step={['kg', 'g', 'l', 'ml'].includes(line.product.unit) ? '.001' : '1'}
                            label={`${t('qty')} ${localName(line.product)}`}
                            onChange={(v) => editLine(line.product_id, 'qty', v)}
                          />
                        </td>
                        <td className="discount-col">
                          <Numeric
                            className="discount-input"
                            value={line.discount_percent}
                            step=".01"
                            label={`${t('discount')} ${localName(line.product)}`}
                            onChange={(v) => editLine(line.product_id, 'discount_percent', v)}
                          />
                        </td>
                        <td className="numeric">
                          <strong>{money(line.net)}</strong>
                        </td>
                        <td>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`${t('remove')} ${localName(line.product)}`}
                            onClick={() =>
                              changeCart((c) => ({
                                ...c,
                                lines: c.lines.filter((l) => l.product_id !== line.product_id),
                              }))
                            }
                          >
                            <X size={16} />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="cart-bottom">
              <span className="save-status">
                <CheckCheck size={13} />
                {t(saving ? 'saving' : 'savedLocally')}
              </span>
              <div className="cart-controls">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!cart.lines.length}
                  onClick={() => setClear(true)}
                >
                  <Trash2 size={14} />
                  {t('clear')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!cart.lines.length}
                  onClick={() => setHold(true)}
                >
                  <Pause size={14} />
                  {t('hold')}
                </Button>
              </div>
            </div>
          </section>
          <section className="quick-section">
            <div className="quick-section-heading">
              <h2>{t('quickProducts')}</h2>
              <small>{t('quickHint')}</small>
            </div>
            <div className="quick-grid">
              {quick.map((p, i) => {
                const Glyph = [Leaf, Package, ShoppingBasket, Cookie, Milk][i % 5];
                return (
                  <button className="quick-product" key={p.id} onClick={() => safe(() => add(p))}>
                    {p.image ? (
                      <img src={p.image} alt="" />
                    ) : (
                      <div className={`product-glyph glyph-${i % 4}`}>
                        <Glyph size={21} />
                      </div>
                    )}
                    <Plus size={14} className="quick-add" />
                    <span className="quick-product-name">{localName(p)}</span>
                    <span className="quick-product-price">
                      {money(p.selling_price)}{' '}
                      <span className="quick-product-unit">/ {t(`units.${p.unit}`)}</span>
                    </span>
                  </button>
                );
              })}
              {!quick.length && <Empty text={t('empty')} />}
            </div>
          </section>
        </div>
        <aside className="panel payment-panel">
          <button className="customer-button" onClick={() => setCustomerOpen(true)}>
            <div className="customer-circle">
              <UserRound size={18} />
            </div>
            <div>
              <strong>{customer?.name ?? t('walkIn')}</strong>
              <small>{customer?.phone ?? t('selectCustomer')}</small>
            </div>
            <ChevronDown size={15} />
          </button>
          <div className="payment-inner">
            <h2 className="payment-label">
              {t('currentBill')}{' '}
              <span className="muted" style={{ fontWeight: 400, fontSize: 10 }}>
                ({cart.lines.length} {t('items')})
              </span>
            </h2>
            <div className="total-row">
              <span>{t('subtotal')}</span>
              <span>{money(totals.subtotal)}</span>
            </div>
            {totals.lineDiscount > 0 && (
              <div className="total-row">
                <span>{t('line_discount')}</span>
                <span>− {money(totals.lineDiscount)}</span>
              </div>
            )}
            <div className="total-row">
              <span>{t('bill_discount')}</span>
              <div className="discount-control">
                <Numeric
                  value={
                    cart.discount_type === 'amount'
                      ? cart.discount_value / 100
                      : cart.discount_value
                  }
                  step=".01"
                  label={t('bill_discount')}
                  onChange={(v) =>
                    changeCart((c) => ({
                      ...c,
                      discount_value: c.discount_type === 'amount' ? Math.round(v * 100) : v,
                    }))
                  }
                />
                <select
                  aria-label={t('discount_type')}
                  value={cart.discount_type}
                  onChange={(e) =>
                    changeCart((c) => ({
                      ...c,
                      discount_type: e.target.value as Cart['discount_type'],
                      discount_value: 0,
                    }))
                  }
                >
                  <option value="percent">%</option>
                  <option value="amount">Rs.</option>
                </select>
              </div>
            </div>
            {user?.role === 'cashier' && (
              <div className="total-row">
                <span>{t('discountCap')}</span>
                <small>{settings.max_discount}%</small>
              </div>
            )}
            {customer && (
              <>
                <div className="total-row">
                  <span>
                    {t('points')} ({customer.points})
                  </span>
                  <div className="discount-control">
                    <Numeric
                      label={t('redeem_points')}
                      step="1"
                      value={cart.redeem_points}
                      onChange={(v) => changeCart((c) => ({ ...c, redeem_points: v }))}
                    />
                  </div>
                </div>
                {totals.loyaltyDiscount > 0 && (
                  <div className="total-row">
                    <span>{t('loyalty_discount')}</span>
                    <span>− {money(totals.loyaltyDiscount)}</span>
                  </div>
                )}
              </>
            )}
            <div className="bag-control">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => changeCart((c) => ({ ...c, bag_qty: c.bag_qty + 1 }))}
              >
                <ShoppingBag size={14} />
                {t('bag')}
                <Plus size={12} />
              </Button>
              {cart.bag_qty > 0 && (
                <span className="bag-count">
                  <button
                    aria-label={t('remove')}
                    onClick={() =>
                      changeCart((c) => ({ ...c, bag_qty: Math.max(0, c.bag_qty - 1) }))
                    }
                  >
                    −
                  </button>{' '}
                  {cart.bag_qty} · {money(totals.bagTotal)}
                </span>
              )}
            </div>
            {totals.rounding !== 0 && (
              <div className="total-row">
                <span>{t('rounding')}</span>
                <span>{money(totals.rounding)}</span>
              </div>
            )}
            <div className="amount-due">
              <span>{t('amountDue')}</span>
              <strong>{money(amount)}</strong>
            </div>
            <div className="payment-methods">
              {(['cash', 'card', 'qr', 'credit'] as const).map((m) => {
                const Icon = methodIcons[m];
                return (
                  <button
                    key={m}
                    className={`method-button ${method === m ? 'method-selected' : ''}`}
                    onClick={() => setMethod(m)}
                  >
                    <Icon size={15} />
                    {t(m)}
                  </button>
                );
              })}
            </div>
            {method === 'cash' ? (
              <>
                <label className="cash-tender">
                  <span>{t('tendered')}</span>
                  <div className="money-input">
                    <span>Rs.</span>
                    <input
                      type="number"
                      min="0"
                      step=".01"
                      value={tender}
                      placeholder="0.00"
                      onChange={(e) => setTender(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') safe(() => pay());
                      }}
                    />
                  </div>
                </label>
                <div className="quick-cash">
                  {[50000, 100000, 200000, 500000].map((v) => (
                    <button key={v} onClick={() => setTender(String(v / 100))}>
                      {(v / 100).toLocaleString('en-LK')}
                    </button>
                  ))}
                  <button onClick={() => setTender((amount / 100).toFixed(2))}>
                    <Check size={11} />
                  </button>
                </div>
                <div className="change-row">
                  <span>{t('change')}</span>
                  <strong>{money(Math.max(0, Math.round(cash) - amount))}</strong>
                </div>
              </>
            ) : ['card', 'qr'].includes(method) ? (
              <label className="cash-tender">
                <span>{t('reference')}</span>
                <input value={reference} onChange={(e) => setReference(e.target.value)} />
              </label>
            ) : (
              <div className="notice notice-green">
                {customer
                  ? `${customer.name} · ${money(Number(customer.credit_limit) - Number(customer.balance))}`
                  : t('customerRequired')}
              </div>
            )}
            <Button
              className="pay-button"
              disabled={!cart.lines.length || paying || saving || !boot.shift}
              onClick={() => safe(() => pay())}
            >
              <span>{t(paying ? 'loading' : 'pay')}</span>
              <kbd>F8</kbd>
            </Button>
            <Button
              variant="ghost"
              className="split-button"
              disabled={!cart.lines.length}
              onClick={() => {
                setSplitPayments([{ method: 'cash', amount, tendered: amount, reference: '' }]);
                setSplit(true);
              }}
            >
              <Split size={14} />
              {t('split')}
            </Button>
          </div>
          <div className="payment-panel-foot">
            <ShieldCheck size={12} />
            {t('localData')}
          </div>
        </aside>
      </div>
      <div className="keyboard-bar">
        {[
          ['F2', 'search'],
          ['F3', 'customer'],
          ['F4', 'hold'],
          ['F5', 'resume'],
          ['F8', 'pay'],
          ['F10', 'print'],
          ['Esc', 'cancel'],
        ].map(([key, label]) => (
          <span key={key}>
            <kbd>{key}</kbd>
            {t(`shortcut.${label}`)}
          </span>
        ))}
        <small>
          {settings.counter_id} · {t('offline')}
        </small>
      </div>
      {customerOpen && (
        <CustomerPicker
          onClose={() => setCustomerOpen(false)}
          onSelect={(row) => {
            changeCart((c) => ({
              ...c,
              customer_id: row ? String(row.id) : null,
              redeem_points: 0,
            }));
            setCustomer(row);
            setCustomerOpen(false);
          }}
        />
      )}
      {hold && (
        <Modal open onClose={() => setHold(false)} title={t('holdName')}>
          <RecordForm
            fields={[field('name', { required: true, full: true })]}
            onSave={async (v) => {
              await flushCart();
              await api('holdCart', { name: String(v.name) });
              await reloadCart();
              setHold(false);
              toast.success(t('saved'));
            }}
            onCancel={() => setHold(false)}
            submit="hold"
          />
        </Modal>
      )}
      {clear && (
        <Confirm
          title={t('confirmClear')}
          onClose={() => setClear(false)}
          onConfirm={() => mutate(() => emptyCart())}
        />
      )}
      <Modal open={split} onClose={() => setSplit(false)} title={t('split')} wide>
        <div className="payment-summary">
          <span>{t('amountDue')}</span>
          <strong>{money(amount)}</strong>
        </div>
        {splitPayments.map((p, index) => (
          <div className="payment-row" key={index}>
            <label className="field">
              <span>{t('payment')}</span>
              <select
                value={p.method}
                onChange={(e) =>
                  setSplitPayments((rows) =>
                    rows.map((r, i) =>
                      i === index ? { ...r, method: e.target.value as PaymentMethod } : r,
                    ),
                  )
                }
              >
                {(['cash', 'card', 'qr', 'credit'] as const).map((m) => (
                  <option key={m} value={m}>
                    {t(m)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t('amount')}</span>
              <input
                type="number"
                min="0"
                step=".01"
                value={p.amount / 100}
                onChange={(e) =>
                  setSplitPayments((rows) =>
                    rows.map((r, i) =>
                      i === index ? { ...r, amount: Math.round(Number(e.target.value) * 100) } : r,
                    ),
                  )
                }
              />
            </label>
            <label className="field">
              <span>{t(p.method === 'cash' ? 'tendered' : 'reference')}</span>
              <input
                type={p.method === 'cash' ? 'number' : 'text'}
                step=".01"
                value={p.method === 'cash' ? p.tendered / 100 : p.reference}
                onChange={(e) =>
                  setSplitPayments((rows) =>
                    rows.map((r, i) =>
                      i === index
                        ? {
                            ...r,
                            ...(p.method === 'cash'
                              ? { tendered: Math.round(Number(e.target.value) * 100) }
                              : { reference: e.target.value }),
                          }
                        : r,
                    ),
                  )
                }
              />
            </label>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('remove')}
              onClick={() => setSplitPayments((rows) => rows.filter((_, i) => i !== index))}
            >
              <X size={16} />
            </Button>
          </div>
        ))}
        <Button
          variant="outline"
          onClick={() =>
            setSplitPayments((rows) => [
              ...rows,
              {
                method: 'card',
                amount: Math.max(0, amount - rows.reduce((s, p) => s + p.amount, 0)),
                tendered: 0,
                reference: '',
              },
            ])
          }
        >
          <Plus size={16} />
          {t('addPayment')}
        </Button>
        <p className="report-note">
          {t('insufficientPayment')}:{' '}
          {money(amount - splitPayments.reduce((s, p) => s + p.amount, 0))}
        </p>
        <div className="modal-actions">
          <Button variant="outline" onClick={() => setSplit(false)}>
            {t('cancel')}
          </Button>
          <Button
            disabled={paying || splitPayments.reduce((s, p) => s + p.amount, 0) !== amount}
            onClick={() => safe(() => pay(splitPayments))}
          >
            {t('pay')}
          </Button>
        </div>
      </Modal>
      {receipt && (
        <ReceiptView billNo={receipt} onClose={() => setReceipt(null)} success={success} />
      )}
    </div>
  );
}
