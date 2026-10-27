import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Banknote, Clock, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { dateString, money, safe } from '../lib/utils';
import { useStore } from '../store';
import type { Entity } from '../../shared/contracts';
import type { Row } from '../../shared/types';
import { Button } from '../components/ui/button';
import { Modal } from '../components/ui/dialog';
import {
  Confirm,
  DataTable,
  ErrorState,
  Loading,
  PageTitle,
  SearchBox,
  useLoad,
} from '../components/common';
import { field, RecordForm, type Field } from '../components/forms';
type Kind = Entity | 'users' | 'audit';
export default function Records({ entity }: { entity: Kind }) {
  const { t } = useTranslation();
  const [q, setQ] = useState(''),
    [edit, setEdit] = useState<Row | null>(null),
    [remove, setRemove] = useState<Row | null>(null),
    [payment, setPayment] = useState<Row | null>(null),
    [history, setHistory] = useState<Row | null>(null);
  const { data, error, reload } = useLoad(
    () => api('list', { entity: entity === 'audit' ? 'audit_logs' : entity, query: q }),
    [entity, q],
  );
  const { suppliers } = useSuppliers(entity === 'cheques');
  const fields: Record<Kind, Field[]> = {
    categories: [field('name_en', { required: true }), field('name_si', { required: true })],
    suppliers: [
      field('name', { required: true }),
      field('phone'),
      field('address', { full: true }),
      field('credit_days', { type: 'number', min: 0, max: 365, required: true }),
    ],
    customers: [
      field('name', { required: true }),
      field('phone', { required: true }),
      field('address', { full: true }),
      field('credit_limit', { required: true, min: 0 }),
    ],
    expenses: [
      field('date', { type: 'date', required: true }),
      field('amount', { required: true, min: 0.01 }),
      field('note', { required: true, full: true, type: 'textarea' }),
    ],
    cheques: [
      field('supplier_id', {
        required: true,
        type: 'select',
        options: suppliers.map((r) => ({ value: String(r.id), label: String(r.name) })),
      }),
      field('number', { required: true }),
      field('bank', { required: true }),
      field('amount', { required: true, min: 0.01 }),
      field('due_date', { type: 'date', required: true }),
      field('status', {
        required: true,
        type: 'select',
        options: ['pending', 'cleared', 'returned'].map((v) => ({ value: v, label: t(v) })),
      }),
    ],
    users: [
      field('username', { required: true }),
      field('display_name', { required: true }),
      field('password', {
        type: 'password',
        required: !edit?.id,
        hint: edit?.id ? 'passwordUnchanged' : undefined,
      }),
      field('active', { type: 'checkbox' }),
    ],
    audit: [],
  };
  const columns: Record<Kind, string[]> = {
    categories: ['name_en', 'name_si'],
    suppliers: ['name', 'phone', 'address', 'credit_days', 'balance'],
    customers: ['name', 'phone', 'credit_limit', 'balance', 'points'],
    expenses: ['date', 'amount', 'note'],
    cheques: ['supplier', 'number', 'bank', 'amount', 'due_date', 'status'],
    users: ['username', 'display_name', 'role', 'active'],
    audit: ['created_at', 'display_name', 'action', 'details'],
  };
  const add = () =>
    setEdit({
      ...(entity === 'expenses' ? { date: dateString() } : {}),
      ...(entity === 'suppliers' ? { credit_days: 14 } : {}),
      ...(entity === 'customers' ? { credit_limit: 0 } : {}),
      ...(entity === 'users' ? { active: 1 } : {}),
      ...(entity === 'cheques' ? { status: 'pending' } : {}),
    });
  return (
    <>
      <PageTitle
        title={t(`nav.${entity}`)}
        hint={entity === 'users' ? t('userHint') : undefined}
        actions={
          entity !== 'audit' && (
            <Button onClick={add}>
              <Plus size={17} />
              {t(
                entity === 'expenses' ? 'newExpense' : entity === 'users' ? 'newUser' : 'addRecord',
              )}
            </Button>
          )
        }
      />
      <section className="panel">
        <div className="content-toolbar">
          <SearchBox value={q} onChange={setQ} />
        </div>
        {error ? (
          <ErrorState retry={reload} />
        ) : !data ? (
          <Loading />
        ) : (
          <>
            <DataTable
              rows={
                entity === 'expenses' ||
                entity === 'categories' ||
                entity === 'cheques' ||
                entity === 'users' ||
                entity === 'audit'
                  ? data.filter(
                      (r) =>
                        !q ||
                        Object.values(r).some((v) =>
                          String(v ?? '')
                            .toLowerCase()
                            .includes(q.toLowerCase()),
                        ),
                    )
                  : data
              }
              columns={columns[entity]}
              actions={
                entity === 'audit'
                  ? undefined
                  : (row) =>
                      row.role === 'owner' ? null : (
                        <>
                          {['suppliers', 'customers'].includes(entity) && (
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label={t(
                                entity === 'customers' ? 'collectPayment' : 'recordPayment',
                              )}
                              onClick={() => setPayment(row)}
                            >
                              <Banknote size={16} />
                            </Button>
                          )}
                          {['suppliers', 'customers'].includes(entity) && (
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label={t('purchaseHistory')}
                              onClick={() => setHistory(row)}
                            >
                              <Clock size={16} />
                            </Button>
                          )}
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label={t('edit')}
                            onClick={() => setEdit(row)}
                          >
                            <Pencil size={15} />
                          </Button>
                          {entity !== 'users' && (
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label={t('delete')}
                              onClick={() => setRemove(row)}
                            >
                              <Trash2 size={15} />
                            </Button>
                          )}
                        </>
                      )
              }
            />
            <div className="table-summary">
              {data.length} {t('results')}
            </div>
          </>
        )}
      </section>
      {edit && (
        <Modal
          open
          onClose={() => setEdit(null)}
          title={t(edit.id ? 'edit' : entity === 'users' ? 'newUser' : 'addRecord')}
        >
          <RecordForm
            key={String(edit.id ?? 'new')}
            fields={fields[entity]}
            initial={edit}
            onCancel={() => setEdit(null)}
            onSave={async (values) => {
              if (entity === 'users')
                await api('saveUser', {
                  id: edit.id ? String(edit.id) : undefined,
                  username: String(values.username),
                  display_name: String(values.display_name),
                  active: Boolean(values.active),
                  password: values.password ? String(values.password) : undefined,
                });
              else
                await api('saveEntity', {
                  entity: entity as Entity,
                  data: { ...values, id: edit.id ?? undefined },
                });
              setEdit(null);
              reload();
              await useStore.getState().boot();
              toast.success(t('saved'));
            }}
          />
        </Modal>
      )}
      {remove && (
        <Confirm
          title={t('confirmDelete')}
          onClose={() => setRemove(null)}
          onConfirm={async () => {
            await api('deleteEntity', { entity: entity as Entity, id: String(remove.id) });
            reload();
            await useStore.getState().boot();
            toast.success(t('deleted'));
          }}
        />
      )}
      {payment && (
        <Modal
          open
          onClose={() => setPayment(null)}
          title={t(entity === 'customers' ? 'collectPayment' : 'recordPayment')}
        >
          <div className="payment-summary">
            <span>{payment.name}</span>
            <strong>{money(Number(payment.balance))}</strong>
          </div>
          <RecordForm
            fields={[
              field('amount', { required: true, min: 0.01, max: Number(payment.balance) / 100 }),
              field('note', { full: true }),
              ...(entity === 'suppliers' ? [field('date', { type: 'date', required: true })] : []),
            ]}
            initial={{ date: dateString() }}
            onCancel={() => setPayment(null)}
            onSave={async (v) => {
              let id: string;
              if (entity === 'customers')
                id = await api('customerPayment', {
                  customer_id: String(payment.id),
                  amount: Number(v.amount),
                  note: String(v.note ?? ''),
                });
              else
                id = await api('supplierPayment', {
                  supplier_id: String(payment.id),
                  amount: Number(v.amount),
                  note: String(v.note ?? ''),
                  date: String(v.date),
                });
              setPayment(null);
              reload();
              toast.success(
                t('paymentSaved'),
                entity === 'customers'
                  ? {
                      action: {
                        label: t('print'),
                        onClick: () => safe(() => api('printCustomerPayment', { id, pdf: false })),
                      },
                    }
                  : undefined,
              );
            }}
          />
        </Modal>
      )}
      {history && (
        <History
          row={history}
          entity={entity === 'customers' ? 'customers' : 'suppliers'}
          onClose={() => setHistory(null)}
        />
      )}
    </>
  );
}
function useSuppliers(enabled: boolean) {
  const { data } = useLoad(
    () => (enabled ? api('list', { entity: 'suppliers' }) : Promise.resolve([])),
    [enabled],
  );
  return { suppliers: data ?? [] };
}
function History({
  row,
  entity,
  onClose,
}: {
  row: Row;
  entity: 'customers' | 'suppliers';
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { data } = useLoad(async () => {
    if (entity === 'customers') return api('customerHistory', { customer_id: String(row.id) });
    const [sales, payments] = await Promise.all([
      api('list', { entity: 'purchases' }),
      api('list', { entity: 'supplier_payments' }),
    ]);
    return {
      sales: sales.filter((r) => r.supplier_id === row.id),
      payments: payments.filter((r) => r.supplier_id === row.id),
      loyalty: [],
    };
  }, [row.id]);
  return (
    <Modal open wide onClose={onClose} title={String(row.name)}>
      {!data ? (
        <Loading />
      ) : (
        <>
          <div className="history-section">
            <h3>{t('purchaseHistory')}</h3>
            <DataTable
              rows={data.sales}
              columns={
                entity === 'customers'
                  ? ['bill_no', 'total', 'created_at']
                  : ['invoice_no', 'date', 'total']
              }
            />
          </div>
          <div className="history-section">
            <h3>{t('paymentHistory')}</h3>
            <DataTable
              rows={data.payments}
              columns={['created_at', 'amount', 'note']}
              actions={
                entity === 'customers'
                  ? (r) => (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          safe(() => api('printCustomerPayment', { id: String(r.id), pdf: true }))
                        }
                      >
                        {t('savePdf')}
                      </Button>
                    )
                  : undefined
              }
            />
          </div>
          {entity === 'customers' && (
            <div className="history-section">
              <h3>{t('points')}</h3>
              <DataTable rows={data.loyalty} columns={['created_at', 'points', 'note']} />
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
