import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Banknote,
  Barcode,
  Check,
  CheckCheck,
  CreditCard,
  FileClock,
  Package,
  Pause,
  Plus,
  Minus,
  Printer,
  QrCode,
  Scale,
  ShieldCheck,
  ShoppingBag,
  ShoppingBasket,
  Split,
  Trash2,
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
} from '../../shared/types';
import { Button } from '../components/ui/button';
import { Modal } from '../components/ui/dialog';
import { Confirm, Empty } from '../components/common';
import ReceiptView from '../components/ReceiptView';
import { RecordForm, field } from '../components/forms';
import CheckoutCatalogue from '../components/CheckoutCatalogue';
import MeasuredItemDialog from '../components/MeasuredItemDialog';
import { isMeasuredUnit, type MeasuredUnit } from '../lib/measurement';
const quickStep = (unit: string) =>
  ['kg', 'l'].includes(unit) ? 0.25 : ['g', 'ml'].includes(unit) ? 250 : 1;
const methodIcons = { cash: Banknote, card: CreditCard, qr: QrCode };
function Numeric({
  value,
  onChange,
  min = 0,
  max,
  step = '.001',
  label,
  className,
  integer = false,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: string;
  label: string;
  className?: string;
  integer?: boolean;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return (
    <input
      className={className}
      type="number"
      min={min}
      max={max}
      step={step}
      inputMode={integer ? 'numeric' : 'decimal'}
      onKeyDown={(e) => {
        if (integer && ['.', ',', 'e', 'E', '-', '+'].includes(e.key)) e.preventDefault();
      }}
      value={draft}
      aria-label={label}
      onChange={(e) => {
        if (integer && e.target.value !== '' && !/^\d+$/.test(e.target.value)) return;
        if (max != null && e.target.value !== '' && Number(e.target.value) > max) return;
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
export default function Checkout() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { cart, products, bootstrap: boot, user, mutate, saving, cache, reloadCart } = useStore();
  const [query, setQuery] = useState(''),
    [results, setResults] = useState<Product[]>([]),
    [focused, setFocused] = useState(false),
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
  const [measured, setMeasured] = useState<{
    product: Product & { unit: MeasuredUnit };
    quantity?: number;
  } | null>(null);
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
  const settings = boot?.settings;
  let totals: ReturnType<typeof cartTotals> | null = null;
  try {
    if (settings) totals = cartTotals(cart, products, settings);
  } catch {
    /* Restored products are loaded alongside their cart. */
  }
  const invalidQuantity = cart.lines.some((line) => {
    const product = products.find((p) => p.id === line.product_id);
    return product && ['pcs', 'pack'].includes(product.unit) && !Number.isInteger(line.qty);
  });
  const amount = totals?.total ?? 0;
  const cash = Number(tender || '0') * 100;
  const localName = (p: Product) => (i18n.language === 'si' ? p.name_si : p.name_en);
  const changeCart = (fn: (c: Cart) => Cart) => safe(() => mutate(fn));
  async function add(product: Product, quantity = 1) {
    const existing =
      useStore.getState().cart.lines.find((line) => line.product_id === product.id)?.qty ?? 0;
    if (existing + quantity > (product.available_stock ?? product.stock)) {
      toast.error(t('insufficientStock'));
      throw new Error('insufficientStock');
    }
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
    const product = products.find((p) => p.id === id);
    if (key === 'qty' && product && value > (product.available_stock ?? product.stock)) {
      toast.error(t('insufficientStock'));
      return;
    }
    changeCart((c) => ({
      ...c,
      lines: c.lines.map((l) => (l.product_id === id ? { ...l, [key]: value } : l)),
    }));
  }
  async function selectProduct(product: Product) {
    const existing = cart.lines.find((line) => line.product_id === product.id)?.qty ?? 0;
    if ((product.available_stock ?? product.stock) <= existing) {
      toast.error(t('outOfStock'));
      return;
    }
    if (isMeasuredUnit(product.unit)) {
      setQuery('');
      setFocused(false);
      setMeasured({ product: { ...product, unit: product.unit } });
    } else await add(product);
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
      await selectProduct(found[0]);
    else if (found.length) {
      setResults(found);
      setFocused(true);
    } else toast.error(t('productUnavailable'));
  }
  async function pay(payments?: Payment[]) {
    if (transactionLock.current || !totals || !cart.lines.length) return;
    if (invalidQuantity) {
      toast.error(t('wholeQuantity'));
      return;
    }
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
      <div className="checkout-grid">
        <section className="panel catalogue-panel">
          <CheckoutCatalogue bootstrap={boot} onAdd={(p) => safe(() => selectProduct(p))} />
        </section>
        <div className="checkout-right">
          <section className="panel cart-panel">
            <div className="scanner-area">
              <label className="scanner-label" htmlFor="checkout-barcode">
                {t('barcodeEntry')}
              </label>
              <div className="scanner-input">
                <Barcode size={24} />
                <input
                  ref={searchRef}
                  id="checkout-barcode"
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
                  placeholder={t('barcodePlaceholder')}
                  aria-label={t('scanSearch')}
                  autoFocus
                />
                <kbd>F2</kbd>
                <Button size="sm" disabled={!query.trim()} onClick={() => safe(scan)}>
                  <Plus size={16} />
                  {t('addItem')}
                </Button>
              </div>
              {query && focused && (
                <div className="search-results">
                  {results.map((p) => (
                    <button
                      key={p.id}
                      className="search-result"
                      disabled={
                        (p.available_stock ?? p.stock) <=
                        (cart.lines.find((line) => line.product_id === p.id)?.qty ?? 0)
                      }
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => safe(() => selectProduct(p))}
                    >
                      <div className="product-glyph">
                        {p.image ? <img src={p.image} alt="" /> : <Package size={18} />}
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
            <div className="bill-items-heading">
              <h2>{t('selectedItems')}</h2>
              <span>
                {cart.lines.length} {t('items')}
              </span>
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
                          {line.product.image && (
                            <img className="cart-product-image" src={line.product.image} alt="" />
                          )}
                          {localName(line.product)}
                          <span className="product-secondary">
                            {line.product.sku} · {t(`units.${line.product.unit}`)}
                          </span>
                        </td>
                        <td className="price-col numeric">{money(line.product.selling_price)}</td>
                        <td>
                          <div className="quantity-stepper">
                            <button
                              type="button"
                              aria-label={`${t('decreaseQty')}: ${localName(line.product)}`}
                              disabled={saving || line.qty <= quickStep(line.product.unit)}
                              onClick={() =>
                                editLine(
                                  line.product_id,
                                  'qty',
                                  roundQty(line.qty - quickStep(line.product.unit)),
                                )
                              }
                            >
                              <Minus size={12} />
                            </button>
                            <Numeric
                              value={line.qty}
                              min={isMeasuredUnit(line.product.unit) ? 0.001 : 1}
                              max={line.product.available_stock ?? line.product.stock}
                              integer={!isMeasuredUnit(line.product.unit)}
                              step={
                                ['kg', 'g', 'l', 'ml'].includes(line.product.unit) ? '.001' : '1'
                              }
                              label={`${t('qty')} ${localName(line.product)}`}
                              onChange={(v) => editLine(line.product_id, 'qty', v)}
                            />
                            <button
                              type="button"
                              aria-label={`${t('increaseQty')}: ${localName(line.product)}`}
                              disabled={
                                saving ||
                                line.qty + quickStep(line.product.unit) >
                                  (line.product.available_stock ?? line.product.stock)
                              }
                              onClick={() =>
                                editLine(
                                  line.product_id,
                                  'qty',
                                  roundQty(line.qty + quickStep(line.product.unit)),
                                )
                              }
                            >
                              <Plus size={12} />
                            </button>
                          </div>
                          {!isMeasuredUnit(line.product.unit) && (
                            <div className="quantity-presets">
                              {[1, 3, 5].map((value) => (
                                <button
                                  type="button"
                                  key={value}
                                  aria-label={`${t('setQty')} ${value}: ${localName(line.product)}`}
                                  disabled={
                                    saving ||
                                    value > (line.product.available_stock ?? line.product.stock)
                                  }
                                  onClick={() => editLine(line.product_id, 'qty', value)}
                                >
                                  {value}
                                </button>
                              ))}
                            </div>
                          )}
                          {isMeasuredUnit(line.product.unit) && (
                            <button
                              type="button"
                              className="edit-measurement"
                              aria-label={`${t('editMeasurement')}: ${localName(line.product)}`}
                              onClick={() => {
                                if (isMeasuredUnit(line.product.unit))
                                  setMeasured({
                                    product: { ...line.product, unit: line.product.unit },
                                    quantity: line.qty,
                                  });
                              }}
                            >
                              <Scale size={12} /> {t(`units.${line.product.unit}`)}
                            </button>
                          )}
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
            {invalidQuantity && (
              <p className="quantity-warning" role="alert">
                {t('wholeQuantity')}
              </p>
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
          <aside className="panel payment-panel">
            <div className="payment-inner">
              <h2 className="payment-label">
                {t('currentBill')}{' '}
                <span className="muted" style={{ fontWeight: 400, fontSize: 10 }}>
                  ({cart.lines.length} {t('items')})
                </span>
              </h2>
              <div className="billing-summary">
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
              </div>
              <div className="billing-payment">
                <div className="payment-methods">
                  {(['cash', 'card', 'qr'] as const).map((m) => {
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
                ) : (
                  <label className="cash-tender">
                    <span>{t('reference')}</span>
                    <input value={reference} onChange={(e) => setReference(e.target.value)} />
                  </label>
                )}
                <Button
                  className="pay-button"
                  disabled={!cart.lines.length || paying || saving || invalidQuantity}
                  onClick={() => safe(() => pay())}
                >
                  <span>{t(paying ? 'loading' : 'pay')}</span>
                  <kbd>F8</kbd>
                </Button>
                <Button
                  variant="ghost"
                  className="split-button"
                  disabled={!cart.lines.length || invalidQuantity}
                  onClick={() => {
                    setSplitPayments([{ method: 'cash', amount, tendered: amount, reference: '' }]);
                    setSplit(true);
                  }}
                >
                  <Split size={14} />
                  {t('split')}
                </Button>
              </div>
            </div>
            <div className="payment-panel-foot">
              <ShieldCheck size={12} />
              {t('localData')}
            </div>
          </aside>
        </div>
      </div>
      <div className="keyboard-bar">
        {[
          ['F2', 'search'],
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
      {measured && (
        <MeasuredItemDialog
          product={measured.product}
          initialQuantity={measured.quantity}
          onClose={() => setMeasured(null)}
          onSave={async (quantity) => {
            if (measured.quantity == null) await add(measured.product, quantity);
            else
              await mutate((c) => ({
                ...c,
                lines: c.lines.map((line) =>
                  line.product_id === measured.product.id ? { ...line, qty: quantity } : line,
                ),
              }));
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
                {(['cash', 'card', 'qr'] as const).map((m) => (
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
