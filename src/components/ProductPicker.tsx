import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { money } from '../lib/utils';
import type { Product } from '../../shared/types';
export default function ProductPicker({
  value,
  onSelect,
}: {
  value: Product | null;
  onSelect: (p: Product) => void;
}) {
  const { t, i18n } = useTranslation();
  const [query, setQuery] = useState(''),
    [open, setOpen] = useState(false),
    [results, setResults] = useState<Product[]>([]);
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      void api('products', { query, limit: 30 })
        .then((v) => {
          if (live) setResults(v);
        })
        .catch(() => {});
    }, 70);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query]);
  return (
    <div style={{ position: 'relative' }}>
      <input
        aria-label={t('chooseProduct')}
        placeholder={t('chooseProduct')}
        value={open ? query : value ? (i18n.language === 'si' ? value.name_si : value.name_en) : ''}
        onFocus={() => {
          setOpen(true);
          setQuery('');
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => setQuery(e.target.value)}
      />
      {open && (
        <div className="search-results" style={{ top: 45, left: 0, right: 0 }}>
          {results.map((p) => (
            <button
              type="button"
              key={p.id}
              className="search-result"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onSelect(p);
                setOpen(false);
              }}
            >
              <span className="search-result-name">
                {i18n.language === 'si' ? p.name_si : p.name_en}
                <small>{p.sku}</small>
              </span>
              <strong>{money(p.cost_price ?? p.selling_price)}</strong>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
