import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, Package, Plus } from 'lucide-react';
import type { Bootstrap, Product } from '../../shared/types';
import { api } from '../lib/api';
import { money } from '../lib/utils';
import { useStore } from '../store';
import { Empty, ErrorState, Loading, SearchBox } from './common';
import { Button } from './ui/button';

const pageSize = 24;

export default function CheckoutCatalogue({
  bootstrap,
  onAdd,
}: {
  bootstrap: Bootstrap;
  onAdd: (product: Product) => void;
}) {
  const { t, i18n } = useTranslation();
  const cache = useStore((s) => s.cache);
  const [filter, setFilter] = useState({ query: '', category: '', page: 0 });
  const [items, setItems] = useState<Product[]>([]);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(false);
    const timer = setTimeout(() => {
      void api('products', {
        query: filter.query,
        category_id: filter.category || undefined,
        offset: filter.page * pageSize,
        limit: pageSize + 1,
      })
        .then((rows) => {
          if (!live) return;
          setItems(rows.slice(0, pageSize));
          setMore(rows.length > pageSize);
          cache(rows.slice(0, pageSize));
        })
        .catch(() => {
          if (live) setError(true);
        })
        .finally(() => {
          if (live) setLoading(false);
        });
    }, 100);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [filter, bootstrap, cache, revision]);

  return (
    <section className="checkout-catalogue" aria-labelledby="catalogue-title">
      <div className="catalogue-heading">
        <div>
          <h2 id="catalogue-title">{t('allProducts')}</h2>
          <p>{t('catalogueHint')}</p>
        </div>
        <SearchBox
          value={filter.query}
          onChange={(query) => setFilter((v) => ({ ...v, query, page: 0 }))}
          placeholder={t('catalogueSearch')}
        />
      </div>
      <div className="catalogue-categories" role="group" aria-label={t('category')}>
        <button
          className={`category-filter ${!filter.category ? 'category-selected' : ''}`}
          aria-pressed={!filter.category}
          onClick={() => setFilter((v) => ({ ...v, category: '', page: 0 }))}
        >
          {t('allCategories')}
        </button>
        {bootstrap.categories.map((category) => (
          <button
            key={String(category.id)}
            className={`category-filter ${filter.category === category.id ? 'category-selected' : ''}`}
            aria-pressed={filter.category === category.id}
            onClick={() => setFilter((v) => ({ ...v, category: String(category.id), page: 0 }))}
          >
            {category[i18n.language === 'si' ? 'name_si' : 'name_en']}
          </button>
        ))}
      </div>
      <div className="catalogue-body" aria-busy={loading}>
        {loading ? (
          <Loading />
        ) : error ? (
          <ErrorState retry={() => setRevision((v) => v + 1)} />
        ) : items.length === 0 ? (
          <Empty text={t('noMatchingProducts')}>
            <Button
              variant="outline"
              onClick={() => setFilter({ query: '', category: '', page: 0 })}
            >
              {t('resetFilters')}
            </Button>
          </Empty>
        ) : (
          <div className="catalogue-grid">
            {items.map((product) => {
              const name = i18n.language === 'si' ? product.name_si : product.name_en;
              return (
                <button
                  className="catalogue-product"
                  key={product.id}
                  aria-label={`${t('addItem')}: ${name}`}
                  onClick={() => onAdd(product)}
                >
                  <span className="catalogue-image">
                    {product.image ? (
                      <img src={product.image} alt="" loading="lazy" />
                    ) : (
                      <Package size={28} />
                    )}
                    <span className="catalogue-add">
                      <Plus size={15} />
                    </span>
                  </span>
                  <span className="catalogue-product-name">{name}</span>
                  <span className="catalogue-product-category">
                    {i18n.language === 'si' ? product.category_si : product.category_en}
                  </span>
                  <strong className="catalogue-price">
                    {money(product.selling_price)} <small>/ {t(`units.${product.unit}`)}</small>
                  </strong>
                  <span className={`catalogue-stock ${product.stock <= 0 ? 'out-of-stock' : ''}`}>
                    {t('stock')}: {product.stock} {t(`units.${product.unit}`)}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
      <div className="catalogue-footer">
        <span aria-live="polite">
          {t('page')} {filter.page + 1}
        </span>
        <div>
          <Button
            variant="ghost"
            size="sm"
            disabled={loading || filter.page === 0}
            onClick={() => setFilter((v) => ({ ...v, page: v.page - 1 }))}
          >
            <ChevronLeft size={15} />
            {t('previousPage')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={loading || error || !more}
            onClick={() => setFilter((v) => ({ ...v, page: v.page + 1 }))}
          >
            {t('nextPage')}
            <ChevronRight size={15} />
          </Button>
        </div>
      </div>
    </section>
  );
}
