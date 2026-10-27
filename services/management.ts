import type { z } from 'zod';
import { entitySchemas, type Entity, schemas } from '../shared/contracts';
import { Store, today } from '../db/database';
import { Auth } from './auth';
import { AppError, requireValue } from './errors';
export class Management {
  constructor(
    public store: Store,
    public auth: Auth,
  ) {}
  list(entity: z.infer<typeof schemas.list>['entity'], query = '') {
    const user = this.auth.current();
    const like = `%${query}%`;
    if (user.role === 'cashier') {
      if (entity === 'customers')
        return this.store.all(
          'SELECT id,name,phone,balance,points,credit_limit FROM customers WHERE name LIKE ? OR phone LIKE ? ORDER BY name LIMIT 200',
          like,
          like,
        );
      if (entity === 'held_bills')
        return this.store.all(
          "SELECT id,name,updated_at FROM held_bills WHERE user_id=? AND status='held' ORDER BY updated_at DESC",
          user.id,
        );
      if (entity === 'sales')
        return this.store.all(
          "SELECT s.id,s.bill_no,s.total,s.status,s.created_at,u.display_name cashier FROM sales s JOIN users u ON u.id=s.user_id WHERE user_id=? AND date(s.created_at,'localtime')=? AND bill_no LIKE ? ORDER BY s.created_at DESC LIMIT 200",
          user.id,
          today(),
          like,
        );
      throw new AppError('forbidden');
    }
    switch (entity) {
      case 'users':
        return this.store.all(
          'SELECT id,username,display_name,role,active,language,must_change_password FROM users ORDER BY role DESC,username',
        );
      case 'suppliers':
        return this.store.all(
          'SELECT s.*,COALESCE((SELECT SUM(total) FROM purchases WHERE supplier_id=s.id),0)-COALESCE((SELECT SUM(amount) FROM supplier_payments WHERE supplier_id=s.id),0) balance FROM suppliers s WHERE name LIKE ? OR phone LIKE ? ORDER BY name',
          like,
          like,
        );
      case 'customers':
        return this.store.all(
          'SELECT * FROM customers WHERE name LIKE ? OR phone LIKE ? ORDER BY name LIMIT 500',
          like,
          like,
        );
      case 'purchases':
        return this.store.all(
          'SELECT p.*,s.name supplier FROM purchases p JOIN suppliers s ON s.id=p.supplier_id WHERE invoice_no LIKE ? ORDER BY date DESC LIMIT 500',
          like,
        );
      case 'cheques':
        return this.store.all(
          'SELECT c.*,s.name supplier FROM cheques c JOIN suppliers s ON s.id=c.supplier_id ORDER BY due_date',
        );
      case 'sales':
        return this.store.all(
          'SELECT s.*,u.display_name cashier FROM sales s JOIN users u ON u.id=s.user_id WHERE bill_no LIKE ? ORDER BY s.created_at DESC LIMIT 500',
          like,
        );
      case 'held_bills':
        return this.store.all(
          "SELECT id,name,updated_at FROM held_bills WHERE user_id=? AND status='held' ORDER BY updated_at DESC",
          user.id,
        );
      case 'expenses':
        return this.store.all('SELECT * FROM expenses ORDER BY date DESC LIMIT 500');
      case 'categories':
        return this.store.all('SELECT * FROM categories ORDER BY name_en');
      case 'audit_logs':
        return this.store.all(
          'SELECT a.*,u.display_name FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.created_at DESC LIMIT 500',
        );
      case 'shifts':
        return this.store.all(
          'SELECT s.*,u.display_name FROM shifts s JOIN users u ON u.id=s.user_id ORDER BY start_time DESC LIMIT 500',
        );
      case 'supplier_payments':
        return this.store.all(
          'SELECT p.*,s.name supplier FROM supplier_payments p JOIN suppliers s ON s.id=p.supplier_id ORDER BY p.created_at DESC LIMIT 500',
        );
      case 'customer_payments':
        return this.store.all(
          'SELECT p.*,c.name customer FROM customer_payments p JOIN customers c ON c.id=p.customer_id ORDER BY p.created_at DESC LIMIT 500',
        );
    }
  }
  save(entity: Entity, input: Record<string, unknown>) {
    const user = this.auth.owner();
    const parsed = entitySchemas[entity].parse(input);
    const { id, ...data } = parsed;
    return this.store.db.transaction(() => {
      if (entity === 'cheques') {
        const cheque = data as z.infer<typeof entitySchemas.cheques>;
        if (id) {
          const old = requireValue(this.store.get('SELECT * FROM cheques WHERE id=?', id));
          if (old.payment_id) {
            if (
              old.status !== cheque.status ||
              Number(old.amount) !== cheque.amount ||
              old.supplier_id !== cheque.supplier_id
            )
              throw new AppError('clearedChequeLocked');
          }
        }
        let paymentId: string | null = null;
        if (
          cheque.status === 'cleared' &&
          (!id || !this.store.get('SELECT payment_id FROM cheques WHERE id=?', id)?.payment_id)
        )
          paymentId = this.supplierPayment({
            supplier_id: cheque.supplier_id,
            amount: cheque.amount,
            note: `${cheque.bank} ${cheque.number}`,
            date: today(),
          });
        if (id)
          this.store.update(entity, id, {
            ...data,
            ...(paymentId ? { payment_id: paymentId } : {}),
          } as Record<string, string | number | null>);
        else {
          const result = this.store.insert(entity, { ...data, payment_id: paymentId } as Record<
            string,
            string | number | null
          >);
          this.store.audit(user.id, 'chequeCreated', result);
          return result;
        }
      } else if (id) {
        requireValue(this.store.get(`SELECT id FROM ${entity} WHERE id=?`, id));
        this.store.update(entity, id, data);
      } else {
        const result = this.store.insert(entity, {
          ...data,
          ...(entity === 'customers' ? { join_date: today() } : {}),
        });
        this.store.audit(user.id, `${entity}Created`, result);
        return result;
      }
      this.store.audit(user.id, `${entity}Edited`, id!);
      return id!;
    })();
  }
  delete(entity: Entity, id: string) {
    const user = this.auth.owner();
    return this.store.db.transaction(() => {
      const row = requireValue(this.store.get(`SELECT * FROM ${entity} WHERE id=?`, id));
      if (entity === 'cheques' && row.payment_id) throw new AppError('clearedChequeLocked');
      this.store.run(`DELETE FROM ${entity} WHERE id=?`, id);
      this.store.audit(user.id, `${entity}Deleted`, id, row);
      return true;
    })();
  }
  supplierPayment(data: z.infer<typeof schemas.supplierPayment>) {
    const user = this.auth.owner();
    const balance = Number(
      this.store.get(
        'SELECT COALESCE((SELECT SUM(total) FROM purchases WHERE supplier_id=?),0)-COALESCE((SELECT SUM(amount) FROM supplier_payments WHERE supplier_id=?),0) balance',
        data.supplier_id,
        data.supplier_id,
      )?.balance ?? 0,
    );
    if (data.amount > balance) throw new AppError('paymentExceedsBalance');
    const id = this.store.insert('supplier_payments', data);
    this.store.audit(user.id, 'supplierPayment', id);
    return id;
  }
  customerPayment(data: z.infer<typeof schemas.customerPayment>) {
    const user = this.auth.owner();
    return this.store.db.transaction(() => {
      const c = requireValue(
        this.store.get('SELECT * FROM customers WHERE id=?', data.customer_id),
      );
      if (data.amount > Number(c.balance)) throw new AppError('paymentExceedsBalance');
      const id = this.store.insert('customer_payments', { ...data, user_id: user.id });
      this.store.update('customers', data.customer_id, {
        balance: Number(c.balance) - data.amount,
      });
      this.store.audit(user.id, 'customerPayment', id, { amount: data.amount });
      return id;
    })();
  }
  history(customerId: string) {
    this.auth.owner();
    return {
      sales: this.store.all(
        'SELECT id,bill_no,total,created_at FROM sales WHERE customer_id=? ORDER BY created_at DESC',
        customerId,
      ),
      payments: this.store.all(
        'SELECT * FROM customer_payments WHERE customer_id=? ORDER BY created_at DESC',
        customerId,
      ),
      loyalty: this.store.all(
        'SELECT * FROM loyalty_transactions WHERE customer_id=? ORDER BY created_at DESC',
        customerId,
      ),
    };
  }
}
