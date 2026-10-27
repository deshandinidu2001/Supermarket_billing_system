import { Store, today } from '../db/database';
import type { Dashboard, Report, Row } from '../shared/types';
import type { ReportName } from '../shared/contracts';
import { Auth } from './auth';
import { profit } from './calculations';
export class Reports {
  constructor(
    public store: Store,
    public auth: Auth,
  ) {}
  dashboard(from: string, to: string): Dashboard {
    this.auth.owner();
    const range = [from, to];
    const sale = this.store.get(
      "SELECT COALESCE(SUM(total),0) revenue,COALESCE(SUM(cost),0) cost,COUNT(*) bills FROM sales WHERE date(created_at,'localtime') BETWEEN ? AND ?",
      ...range,
    )!;
    const returned = this.store.get(
      "SELECT COALESCE(SUM(total),0) refunds,COALESCE(SUM(cost),0) cost FROM returns WHERE date(created_at,'localtime') BETWEEN ? AND ?",
      ...range,
    )!;
    const expenses = Number(
      this.store.get(
        'SELECT COALESCE(SUM(amount),0) n FROM expenses WHERE date BETWEEN ? AND ?',
        ...range,
      )?.n ?? 0,
    );
    const p = profit(
      Number(sale.revenue),
      Number(sale.cost),
      expenses,
      Number(returned.refunds),
      Number(returned.cost),
    );
    const todays = Number(
      this.store.get(
        "SELECT COALESCE((SELECT SUM(total) FROM sales WHERE date(created_at,'localtime')=?),0)-COALESCE((SELECT SUM(total) FROM returns WHERE date(created_at,'localtime')=?),0) n",
        today(),
        today(),
      )?.n ?? 0,
    );
    const events =
      'SELECT created_at,total revenue,cost FROM sales UNION ALL SELECT created_at,-total revenue,-cost FROM returns';
    const months = this.store.all(
      `WITH RECURSIVE calendar(month,i) AS (SELECT date(?,'start of month','-11 months'),0 UNION ALL SELECT date(month,'+1 month'),i+1 FROM calendar WHERE i<11), events AS (${events}), sums AS (SELECT strftime('%Y-%m',created_at,'localtime') month,SUM(revenue) revenue,SUM(revenue-cost) profit FROM events GROUP BY 1), exp AS (SELECT substr(date,1,7) month,SUM(amount) amount FROM expenses GROUP BY 1) SELECT substr(c.month,1,7) month,COALESCE(s.revenue,0) revenue,COALESCE(s.profit,0)-COALESCE(e.amount,0) profit FROM calendar c LEFT JOIN sums s ON s.month=substr(c.month,1,7) LEFT JOIN exp e ON e.month=substr(c.month,1,7) ORDER BY c.month`,
      to,
    );
    const daily = this.store.all(
      `SELECT date(created_at,'localtime') date,SUM(revenue) revenue,SUM(revenue-cost) profit FROM (${events}) WHERE date(created_at,'localtime') BETWEEN ? AND ? GROUP BY 1 ORDER BY 1`,
      ...range,
    );
    const methods = this.store.all(
      "SELECT method,SUM(amount) amount FROM (SELECT p.method,p.amount,s.created_at FROM payments p JOIN sales s ON s.id=p.sale_id UNION ALL SELECT method,-(total-credit_amount) amount,created_at FROM returns WHERE method!='credit' UNION ALL SELECT 'credit' method,-credit_amount amount,created_at FROM returns WHERE credit_amount>0) WHERE date(created_at,'localtime') BETWEEN ? AND ? GROUP BY method",
      ...range,
    );
    const hours = this.store.all(
      "SELECT strftime('%H',created_at,'localtime') hour,COUNT(*) bills,SUM(total) revenue FROM sales WHERE date(created_at,'localtime') BETWEEN ? AND ? GROUP BY 1 ORDER BY 1",
      ...range,
    );
    return {
      ...p,
      expenses,
      bills: Number(sale.bills),
      average: Number(sale.bills) ? Math.round(p.revenue / Number(sale.bills)) : 0,
      today: todays,
      months,
      daily,
      methods,
      hours,
      comparison: months.slice(-2),
    };
  }
  report(name: ReportName, from: string, to: string): Report {
    this.auth.owner();
    const range = [from, to];
    let rows: Row[] = [];
    const productNet = `WITH sold AS (SELECT product_id,SUM(qty) quantity,SUM(line_total) revenue,SUM(cost_total) cost FROM sale_items WHERE date(created_at,'localtime') BETWEEN ? AND ? GROUP BY product_id), refunded AS (SELECT si.product_id,SUM(ri.qty) quantity,SUM(ri.amount) amount,SUM(ri.cost) cost FROM return_items ri JOIN returns r ON r.id=ri.return_id JOIN sale_items si ON si.id=ri.sale_item_id WHERE date(r.created_at,'localtime') BETWEEN ? AND ? GROUP BY si.product_id) SELECT p.id,p.name_en,p.name_si,c.name_en category,c.name_si category_si,COALESCE(s.quantity,0)-COALESCE(r.quantity,0) quantity,COALESCE(s.revenue,0)-COALESCE(r.amount,0) revenue,COALESCE(s.cost,0)-COALESCE(r.cost,0) cost,COALESCE(s.revenue,0)-COALESCE(r.amount,0)-COALESCE(s.cost,0)+COALESCE(r.cost,0) profit FROM products p JOIN categories c ON c.id=p.category_id LEFT JOIN sold s ON s.product_id=p.id LEFT JOIN refunded r ON r.product_id=p.id`;
    switch (name) {
      case 'sales':
        rows = this.store.all(
          "SELECT * FROM (SELECT s.bill_no,s.created_at,u.display_name cashier,COALESCE(c.name,'') customer,s.total,0 refunds,s.cost,s.total-s.cost profit,'completed' status FROM sales s JOIN users u ON u.id=s.user_id LEFT JOIN customers c ON c.id=s.customer_id UNION ALL SELECT s.bill_no,r.created_at,u.display_name cashier,COALESCE(c.name,'') customer,-r.total total,r.total refunds,-r.cost cost,-r.total+r.cost profit,CASE WHEN r.is_void=1 THEN 'void' ELSE 'returned' END status FROM returns r JOIN sales s ON s.id=r.sale_id JOIN users u ON u.id=r.user_id LEFT JOIN customers c ON c.id=s.customer_id) WHERE date(created_at,'localtime') BETWEEN ? AND ? ORDER BY created_at DESC",
          ...range,
        );
        break;
      case 'products':
      case 'profitProducts':
      case 'bottom':
        rows = this.store.all(
          `${productNet} ORDER BY ${name === 'bottom' ? 'quantity ASC' : name === 'profitProducts' ? 'profit DESC' : 'quantity DESC'}`,
          ...range,
          ...range,
        );
        break;
      case 'profitCategories':
        rows = this.store.all(
          `SELECT category,category_si,SUM(quantity) quantity,SUM(revenue) revenue,SUM(cost) cost,SUM(profit) profit FROM (${productNet}) GROUP BY category,category_si ORDER BY profit DESC`,
          ...range,
          ...range,
        );
        break;
      case 'cashiers':
        rows = this.store.all(
          "SELECT u.display_name cashier,COALESCE(s.bills,0) bills,COALESCE(s.revenue,0)-COALESCE(r.refunds,0) revenue,COALESCE(s.revenue-s.cost,0)-COALESCE(r.refunds-r.cost,0) profit FROM users u LEFT JOIN (SELECT user_id,COUNT(*) bills,SUM(total) revenue,SUM(cost) cost FROM sales WHERE date(created_at,'localtime') BETWEEN ? AND ? GROUP BY user_id) s ON s.user_id=u.id LEFT JOIN (SELECT sales.user_id,SUM(r.total) refunds,SUM(r.cost) cost FROM returns r JOIN sales ON sales.id=r.sale_id WHERE date(r.created_at,'localtime') BETWEEN ? AND ? GROUP BY sales.user_id) r ON r.user_id=u.id",
          ...range,
          ...range,
        );
        break;
      case 'lowStock':
        rows = this.store.all(
          'SELECT p.name_en,p.name_si,p.sku,p.unit,COALESCE(SUM(b.qty),0) stock,p.reorder_level FROM products p LEFT JOIN batches b ON b.product_id=p.id WHERE active=1 GROUP BY p.id HAVING COALESCE(SUM(b.qty),0)<=p.reorder_level ORDER BY stock',
        );
        break;
      case 'expiring':
      case 'expired':
        rows = this.store.all(
          `SELECT p.name_en,p.name_si,p.sku,b.id batch_id,b.qty quantity,p.unit,b.cost_price,b.expiry_date FROM batches b JOIN products p ON p.id=b.product_id WHERE b.qty>0 AND ${name === 'expired' ? 'b.expiry_date<date(?)' : 'b.expiry_date BETWEEN date(?) AND date(? , ?)'} ORDER BY b.expiry_date`,
          ...(name === 'expired'
            ? [today()]
            : [today(), today(), `+${this.store.settings().expiry_days} days`]),
        );
        break;
      case 'deadStock':
        rows = this.store.all(
          "SELECT p.name_en,p.name_si,p.sku,COALESCE((SELECT SUM(qty) FROM batches WHERE product_id=p.id),0) stock,(SELECT MAX(created_at) FROM sale_items WHERE product_id=p.id) last_sale FROM products p WHERE p.active=1 AND NOT EXISTS (SELECT 1 FROM sale_items WHERE product_id=p.id AND date(created_at,'localtime')>=date(?,?)) ORDER BY p.name_en",
          today(),
          `-${this.store.settings().dead_stock_days} days`,
        );
        break;
      case 'valuation':
        rows = this.store.all(
          'SELECT p.name_en,p.name_si,p.sku,p.unit,ROUND(SUM(b.qty),3) stock,SUM(ROUND(b.qty*b.cost_price)) value FROM products p JOIN batches b ON b.product_id=p.id GROUP BY p.id ORDER BY value DESC',
        );
        break;
      case 'credit':
        rows = this.store.all(
          'SELECT name,phone,credit_limit,balance,points FROM customers ORDER BY balance DESC',
        );
        break;
      case 'supplierBalances':
        rows = this.store.all(
          'SELECT s.name,s.phone,COALESCE((SELECT SUM(total) FROM purchases WHERE supplier_id=s.id),0) purchases,COALESCE((SELECT SUM(amount) FROM supplier_payments WHERE supplier_id=s.id),0) paid,COALESCE((SELECT SUM(total) FROM purchases WHERE supplier_id=s.id),0)-COALESCE((SELECT SUM(amount) FROM supplier_payments WHERE supplier_id=s.id),0) balance FROM suppliers s ORDER BY balance DESC',
        );
        break;
      case 'returns':
        rows = this.store.all(
          "SELECT r.created_at,s.bill_no,u.display_name cashier,a.display_name approved_by,r.reason,r.method,r.total,r.cost,r.is_void FROM returns r JOIN sales s ON s.id=r.sale_id JOIN users u ON u.id=r.user_id JOIN users a ON a.id=r.approved_by WHERE date(r.created_at,'localtime') BETWEEN ? AND ? ORDER BY r.created_at DESC",
          ...range,
        );
        break;
      case 'discounts':
        rows = this.store.all(
          "SELECT bill_no,created_at,line_discount,bill_discount,loyalty_discount,line_discount+bill_discount+loyalty_discount discount FROM sales WHERE date(created_at,'localtime') BETWEEN ? AND ? AND line_discount+bill_discount+loyalty_discount>0 ORDER BY created_at DESC",
          ...range,
        );
        break;
      case 'expenses':
        rows = this.store.all(
          'SELECT date,amount,note FROM expenses WHERE date BETWEEN ? AND ? ORDER BY date DESC',
          ...range,
        );
        break;
      case 'audit':
        rows = this.store.all(
          "SELECT a.created_at,u.display_name,a.action,a.entity_id,a.details FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id WHERE date(a.created_at,'localtime') BETWEEN ? AND ? ORDER BY a.created_at DESC",
          ...range,
        );
        break;
      case 'cheques':
        rows = this.store.all(
          'SELECT s.name supplier,c.number,c.bank,c.amount,c.due_date,c.status FROM cheques c JOIN suppliers s ON s.id=c.supplier_id ORDER BY c.due_date',
        );
        break;
      case 'reorder':
        rows = this.store.all(
          "SELECT COALESCE(s.name,'') supplier,p.name_en,p.name_si,p.sku,p.unit,COALESCE(SUM(b.qty),0) stock,p.reorder_level,MAX(0,p.reorder_level*2-COALESCE(SUM(b.qty),0)) suggested_qty FROM products p LEFT JOIN suppliers s ON s.id=p.supplier_id LEFT JOIN batches b ON b.product_id=p.id WHERE p.active=1 GROUP BY p.id HAVING stock<=p.reorder_level ORDER BY supplier,p.name_en",
        );
        break;
    }
    const columns: Record<ReportName, string[]> = {
      sales: [
        'bill_no',
        'created_at',
        'cashier',
        'customer',
        'total',
        'refunds',
        'cost',
        'profit',
        'status',
      ],
      products: ['name_en', 'name_si', 'category', 'quantity', 'revenue', 'cost', 'profit'],
      bottom: ['name_en', 'name_si', 'quantity', 'revenue', 'profit'],
      profitProducts: ['name_en', 'name_si', 'quantity', 'revenue', 'cost', 'profit'],
      profitCategories: ['category', 'category_si', 'quantity', 'revenue', 'cost', 'profit'],
      cashiers: ['cashier', 'bills', 'revenue', 'profit'],
      lowStock: ['name_en', 'name_si', 'sku', 'unit', 'stock', 'reorder_level'],
      expiring: [
        'name_en',
        'name_si',
        'sku',
        'batch_id',
        'quantity',
        'unit',
        'cost_price',
        'expiry_date',
      ],
      expired: ['name_en', 'name_si', 'sku', 'quantity', 'unit', 'expiry_date'],
      deadStock: ['name_en', 'name_si', 'sku', 'stock', 'last_sale'],
      valuation: ['name_en', 'name_si', 'sku', 'unit', 'stock', 'value'],
      credit: ['name', 'phone', 'credit_limit', 'balance', 'points'],
      supplierBalances: ['name', 'phone', 'purchases', 'paid', 'balance'],
      returns: [
        'created_at',
        'bill_no',
        'cashier',
        'approved_by',
        'reason',
        'method',
        'total',
        'cost',
        'is_void',
      ],
      discounts: [
        'bill_no',
        'created_at',
        'line_discount',
        'bill_discount',
        'loyalty_discount',
        'discount',
      ],
      expenses: ['date', 'amount', 'note'],
      audit: ['created_at', 'display_name', 'action', 'entity_id', 'details'],
      cheques: ['supplier', 'number', 'bank', 'amount', 'due_date', 'status'],
      reorder: [
        'supplier',
        'name_en',
        'name_si',
        'sku',
        'unit',
        'stock',
        'reorder_level',
        'suggested_qty',
      ],
    };
    return { title: name, columns: columns[name], rows };
  }
}
