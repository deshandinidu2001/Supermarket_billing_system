import { create } from 'zustand';
import { api } from './lib/api';
import i18n from './i18n';
import { emptyCart, type Bootstrap, type Cart, type Product, type User } from '../shared/types';
interface State {
  user: User | null;
  bootstrap: Bootstrap | null;
  products: Product[];
  cart: Cart;
  saving: boolean;
  dark: boolean;
  login: (username: string, password: string) => Promise<void>;
  boot: () => Promise<void>;
  lock: () => Promise<void>;
  reset: () => void;
  cache: (products: Product[]) => void;
  mutate: (fn: (cart: Cart) => Cart) => Promise<void>;
  reloadCart: () => Promise<void>;
  toggleTheme: () => void;
}
let queue = Promise.resolve();
function language(code: string) {
  localStorage.setItem('ajith-language', code);
  document.documentElement.lang = code;
  void i18n.changeLanguage(code);
}
export const useStore = create<State>((set, get) => ({
  user: null,
  bootstrap: null,
  products: [],
  cart: emptyCart(),
  saving: false,
  dark: localStorage.getItem('ajith-dark') === 'true',
  login: async (username, password) => {
    const user = await api('login', { username, password });
    set({ user });
    language(user.language);
    if (!user.must_change_password) await get().boot();
  },
  boot: async () => {
    const data = await api('bootstrap', {});
    set({ user: data.user, bootstrap: data });
    language(data.user.language);
    await get().reloadCart();
    const products = await api('products', { query: '', limit: 200 });
    get().cache(products);
  },
  lock: async () => {
    await queue.catch(() => {});
    await api('logout', {});
    get().reset();
  },
  reset: () => {
    set({ user: null, bootstrap: null, cart: emptyCart(), products: [], saving: false });
  },
  cache: (products) =>
    set((state) => ({
      products: [...new Map([...state.products, ...products].map((p) => [p.id, p])).values()],
    })),
  mutate: (fn) => {
    set({ saving: true });
    const next = queue
      .catch(() => {})
      .then(async () => {
        const cart = await api('saveCart', fn(get().cart));
        set({ cart });
      });
    queue = next;
    void next
      .finally(() => {
        if (queue === next) set({ saving: false });
      })
      .catch(() => {});
    return next;
  },
  reloadCart: async () => {
    await queue.catch(() => {});
    const [cart, products] = await Promise.all([api('loadCart', {}), api('cartProducts', {})]);
    get().cache(products);
    set({ cart });
  },
  toggleTheme: () => {
    const dark = !get().dark;
    localStorage.setItem('ajith-dark', String(dark));
    set({ dark });
  },
}));
window.addEventListener('pos:locked', () => useStore.getState().reset());
export const flushCart = () => queue;
