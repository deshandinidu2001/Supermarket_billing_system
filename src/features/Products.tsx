import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, FileInput, Layers, Pencil, Plus, SlidersHorizontal, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { safe } from '../lib/utils';
import { useStore } from '../store';
import type { Product, Row } from '../../shared/types';
import type { Input } from '../../shared/contracts';
import { Button } from '../components/ui/button';
import { Modal } from '../components/ui/dialog';
import {
  DataTable,
  ErrorState,
  Loading,
  PageTitle,
  SearchBox,
  useLoad,
} from '../components/common';
import { field, RecordForm, type Field } from '../components/forms';
export default function Products() {
  const { t, i18n } = useTranslation();
  const [q, setQ] = useState(''),
    [category, setCategory] = useState(''),
    [edit, setEdit] = useState<Record<string, unknown> | null>(null),
    [adjust, setAdjust] = useState<Product | null>(null),
    [batches, setBatches] = useState<Product | null>(null);
  const { data, error, reload } = useLoad(
    () => api('products', { query: q, limit: 200, active: false }),
    [q],
  );
  const bootstrap = useStore((s) => s.bootstrap);
  const suppliers = useLoad(() => api('list', { entity: 'suppliers' })).data ?? [];
  const categories = bootstrap?.categories ?? [];
  const fields: Field[] = [
    field('name_en', { required: true }),
    field('name_si', { required: true }),
    field('sku', { required: true }),
    field('barcodes', { required: true }),
    field('category_id', {
      type: 'select',
      required: true,
      options: categories.map((r) => ({
        value: String(r.id),
        label: String(r[i18n.language === 'si' ? 'name_si' : 'name_en']),
      })),
    }),
    field('unit', {
      type: 'select',
      required: true,
      options: ['pcs', 'kg', 'g', 'l', 'ml', 'pack'].map((v) => ({
        value: v,
        label: t(`units.${v}`),
      })),
    }),
    field('selling_price', { required: true, min: 0 }),
    field('mrp', { min: 0 }),
    field('cost_price', { required: true, min: 0 }),
    field('reorder_level', { type: 'number', required: true, min: 0 }),
    field('supplier_id', {
      type: 'select',
      options: suppliers.map((r) => ({ value: String(r.id), label: String(r.name) })),
    }),
    field('image', { type: 'image' }),
    field('active', { type: 'checkbox' }),
    field('quick_access', { type: 'checkbox' }),
  ];
  const file = (action: 'import' | 'export' | 'template') =>
    safe(async () => {
      const result = await api('productFile', { action });
      if (result.path) {
        toast.success(t(action === 'import' ? 'imported' : 'exported'), {
          description: String(result.count),
        });
        reload();
        await useStore.getState().boot();
      }
    });
  return (
    <>
      <PageTitle
        title={t('nav.products')}
        hint={t('productHint')}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => file('template')}>
              <FileInput size={15} />
              {t('template')}
            </Button>
            <Button variant="outline" size="sm" onClick={() => file('import')}>
              <Upload size={15} />
              {t('import')}
            </Button>
            <Button variant="outline" size="sm" onClick={() => file('export')}>
              <Download size={15} />
              {t('export')}
            </Button>
            <Button
              onClick={() =>
                setEdit({ active: true, unit: 'pcs', quick_access: false, reorder_level: 5 })
              }
            >
              <Plus size={16} />
              {t('addProduct')}
            </Button>
          </>
        }
      />
      <section className="panel">
        <div className="content-toolbar">
          <SearchBox value={q} onChange={setQ} placeholder={t('searchHint')} />
          <select
            aria-label={t('category')}
            style={{ maxWidth: 200, fontSize: 11 }}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">{t('allCategories')}</option>
            {categories.map((r) => (
              <option key={String(r.id)} value={String(r.id)}>
                {r[i18n.language === 'si' ? 'name_si' : 'name_en']}
              </option>
            ))}
          </select>
        </div>
        {error ? (
          <ErrorState retry={reload} />
        ) : !data ? (
          <Loading />
        ) : (
          <>
            <DataTable
              rows={data
                .filter((p) => !category || p.category_id === category)
                .map((p) => ({ ...p }))}
              columns={[
                'name_en',
                'name_si',
                'barcode',
                'unit',
                'selling_price',
                'cost_price',
                'stock',
                'active',
              ]}
              actions={(row) => (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t('edit')}
                    onClick={() =>
                      safe(async () => {
                        const details = await api('productDetails', { product_id: String(row.id) });
                        setEdit({ ...details, barcodes: details.barcodes.join(', ') });
                      })
                    }
                  >
                    <Pencil size={15} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t('batches')}
                    onClick={() => setBatches(row as unknown as Product)}
                  >
                    <Layers size={15} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t('stockAdjustment')}
                    onClick={() => setAdjust(row as unknown as Product)}
                  >
                    <SlidersHorizontal size={15} />
                  </Button>
                </>
              )}
            />
            <div className="table-summary">
              {data.length} {t('results')} · {t('searchHint')}
            </div>
          </>
        )}
      </section>
      {edit && (
        <Modal
          open
          onClose={() => setEdit(null)}
          title={t(edit.id ? 'editProduct' : 'addProduct')}
          wide
        >
          <RecordForm
            key={String(edit.id ?? 'new')}
            fields={fields}
            initial={edit}
            onCancel={() => setEdit(null)}
            onSave={async (values) => {
              const payload = {
                ...values,
                id: edit.id,
                barcodes: String(values.barcodes)
                  .split(',')
                  .map((v) => v.trim())
                  .filter(Boolean),
                supplier_id: values.supplier_id || null,
                image: values.image || null,
              } as Input<'saveProduct'>;
              await api('saveProduct', payload);
              setEdit(null);
              reload();
              await useStore.getState().boot();
              toast.success(t('saved'));
            }}
          />
        </Modal>
      )}
      {adjust && (
        <StockModal
          product={adjust}
          onClose={() => setAdjust(null)}
          onSaved={() => {
            setAdjust(null);
            reload();
            safe(() => useStore.getState().boot());
          }}
        />
      )}
      {batches && <BatchModal product={batches} onClose={() => setBatches(null)} />}
    </>
  );
}
function BatchModal({ product, onClose }: { product: Product; onClose: () => void }) {
  const { t } = useTranslation();
  const { data } = useLoad(() => api('batches', { product_id: product.id }), [product.id]);
  return (
    <Modal open onClose={onClose} title={`${t('batches')} · ${product.name_en}`} wide>
      {data ? (
        <DataTable
          rows={data}
          columns={['id', 'qty', 'cost_price', 'expiry_date', 'received_date']}
        />
      ) : (
        <Loading />
      )}
    </Modal>
  );
}
function StockModal({
  product,
  onClose,
  onSaved,
}: {
  product: Product;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const { data } = useLoad(() => api('batches', { product_id: product.id }), [product.id]);
  return (
    <Modal open onClose={onClose} title={t('stockAdjustment')} description={t('adjustHint')}>
      <p className="record-description">
        {product.name_en} · {product.name_si}
      </p>
      {data && (
        <RecordForm
          initial={{ cost_price: product.cost_price ?? 0, reason: 'correction' }}
          fields={[
            field('batch_id', {
              type: 'select',
              options: data.map((b: Row) => ({
                value: String(b.id),
                label: `${String(b.id).slice(0, 8)} · ${b.qty} · ${b.expiry_date ?? '—'}`,
              })),
            }),
            field('qty', { type: 'number', required: true }),
            field('cost_price', { required: true, min: 0 }),
            field('expiry_date', { type: 'date' }),
            field('reason', {
              type: 'select',
              required: true,
              options: ['damage', 'expired', 'lost', 'correction'].map((v) => ({
                value: v,
                label: t(v),
              })),
            }),
          ]}
          onCancel={onClose}
          onSave={async (v) => {
            await api('adjustStock', {
              product_id: product.id,
              batch_id: v.batch_id ? String(v.batch_id) : null,
              qty: Number(v.qty),
              cost_price: Number(v.cost_price),
              expiry_date: v.expiry_date ? String(v.expiry_date) : null,
              reason: v.reason as 'damage',
            });
            toast.success(t('saved'));
            onSaved();
          }}
        />
      )}
    </Modal>
  );
}
