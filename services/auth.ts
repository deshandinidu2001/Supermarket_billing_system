import bcrypt from 'bcryptjs';
import { Store, now } from '../db/database';
import type { User } from '../shared/types';
import { AppError, requireValue } from './errors';
import { can } from './calculations';
export class Auth {
  userId: string | null = null;
  lastActivity = Date.now();
  private failures = new Map<string, { count: number; until: number }>();
  constructor(public store: Store) {}
  private limited(key: string) {
    const entry = this.failures.get(key);
    if (entry && entry.until > Date.now() && entry.count >= 5) throw new AppError('tryLater');
  }
  private fail(key: string) {
    const old = this.failures.get(key);
    this.failures.set(key, {
      count: old && old.until > Date.now() ? old.count + 1 : 1,
      until: Date.now() + 60_000,
    });
  }
  current(allowPasswordChange = false): User {
    if (!this.userId) throw new AppError('sessionExpired');
    if (Date.now() - this.lastActivity > this.store.settings().idle_minutes * 60_000) {
      this.logout();
      throw new AppError('sessionExpired');
    }
    const user = this.store.get<User>(
      'SELECT id,username,display_name,role,language,must_change_password FROM users WHERE id=? AND active=1',
      this.userId,
    );
    if (!user) {
      this.userId = null;
      throw new AppError('sessionExpired');
    }
    if (user.must_change_password && !allowPasswordChange)
      throw new AppError('passwordChangeRequired');
    return user;
  }
  authorize(action: string): User {
    const user = this.current(['changePassword', 'logout', 'language'].includes(action));
    if (!can(user.role, action)) throw new AppError('forbidden');
    return user;
  }
  owner() {
    const user = this.current();
    if (user.role !== 'owner') throw new AppError('forbidden');
    return user;
  }
  login(username: string, password: string): User {
    const key = `login:${username.toLowerCase()}`;
    this.limited(key);
    const row = this.store.get(
      'SELECT * FROM users WHERE username=? COLLATE NOCASE AND active=1',
      username,
    );
    if (!row || !bcrypt.compareSync(password, String(row.password_hash))) {
      this.fail(key);
      this.store.audit(null, 'loginFailed', null, { username });
      throw new AppError('invalidCredentials');
    }
    this.failures.delete(key);
    this.userId = String(row.id);
    this.lastActivity = Date.now();
    this.store.audit(this.userId, 'login');
    return this.current(true);
  }
  logout() {
    if (this.userId) this.store.audit(this.userId, 'logout');
    this.userId = null;
    return true;
  }
  activity() {
    if (this.userId) {
      this.current(true);
      this.lastActivity = Date.now();
    }
    return true;
  }
  changePassword(current: string, password: string, pin?: string) {
    const user = this.current(true);
    const row = requireValue(this.store.get('SELECT password_hash FROM users WHERE id=?', user.id));
    this.limited(`password:${user.id}`);
    if (!bcrypt.compareSync(current, String(row.password_hash))) {
      this.fail(`password:${user.id}`);
      throw new AppError('invalidCredentials');
    }
    if (current === password) throw new AppError('passwordDifferent');
    if (user.role === 'owner' && user.must_change_password && !pin)
      throw new AppError('pinRequired');
    this.store.update('users', user.id, {
      password_hash: bcrypt.hashSync(password, 12),
      must_change_password: 0,
      ...(pin && user.role === 'owner' ? { pin_hash: bcrypt.hashSync(pin, 12) } : {}),
    });
    this.store.audit(user.id, 'passwordChanged');
    return this.current();
  }
  approve(pin?: string) {
    const user = this.current();
    if (user.role === 'owner') return user.id;
    this.limited('approval');
    if (!pin) throw new AppError('pinRequired');
    const owner = this.store
      .all('SELECT id,pin_hash FROM users WHERE role=? AND active=1', 'owner')
      .find((row) => row.pin_hash && bcrypt.compareSync(pin, String(row.pin_hash)));
    if (!owner) {
      this.fail('approval');
      this.store.audit(user.id, 'approvalFailed');
      throw new AppError('invalidPin');
    }
    this.failures.delete('approval');
    return String(owner.id);
  }
  language(language: 'en' | 'si') {
    const user = this.current(true);
    this.store.update('users', user.id, { language });
    return this.current(true);
  }
  saveUser(data: {
    id?: string;
    username: string;
    display_name: string;
    password?: string;
    active: boolean;
  }) {
    const owner = this.owner();
    if (data.id) {
      const existing = requireValue(this.store.get('SELECT * FROM users WHERE id=?', data.id));
      if (existing.role !== 'cashier') throw new AppError('ownerProtected');
      this.store.update('users', data.id, {
        username: data.username,
        display_name: data.display_name,
        active: Number(data.active),
        ...(data.password
          ? { password_hash: bcrypt.hashSync(data.password, 12), must_change_password: 1 }
          : {}),
      });
      this.store.audit(owner.id, 'userUpdated', data.id);
      return data.id;
    }
    if (!data.password) throw new AppError('passwordRequired');
    const id = this.store.insert('users', {
      username: data.username,
      display_name: data.display_name,
      password_hash: bcrypt.hashSync(data.password, 12),
      role: 'cashier',
      active: Number(data.active),
    });
    this.store.audit(owner.id, 'userCreated', id, { at: now() });
    return id;
  }
}
