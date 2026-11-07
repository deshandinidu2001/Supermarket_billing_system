import { dialog } from 'electron';
import { writeFile } from 'node:fs/promises';
import { Auth } from '../services/auth';
import { AppError } from '../services/errors';
import { CloudSync } from './cloud-sync';
import { csv, type OwnerData, type OwnerStore, type Answer } from '../packages/analytics/client';
import type { OwnerAnalyticsStatus, SaleDetails, AnalyticsDevice } from '../shared/owner-analytics';
import type { ForecastSettings } from '../shared/analytics';

// A separate cloud-owner session lives only in the main process. Neither tokens
// nor arbitrary URLs/paths are exposed through the renderer invocation bridge.
export class OwnerAnalytics {
  private url = '';
  private token = '';
  private ownerId = '';
  private stores: OwnerStore[] = [];
  private storeId = '';
  private online = false;
  private error: string | null = null;
  private generation = 0;
  private controllers = new Set<AbortController>();
  private disposed = false;
  constructor(
    private auth: Auth,
    private cloud: CloudSync,
  ) {}
  clear() {
    const token = this.token,
      url = this.url;
    this.generation++;
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();
    this.token = '';
    this.ownerId = '';
    this.stores = [];
    this.storeId = '';
    this.error = null;
    if (token)
      void fetch(`${url}/api/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: '{}',
        redirect: 'error',
        signal: AbortSignal.timeout(3000),
      }).catch(() => {});
  }
  dispose() {
    this.disposed = true;
    this.clear();
  }
  private identity() {
    const owner = this.auth.owner();
    if (this.ownerId && owner.id !== this.ownerId) this.clear();
    return owner;
  }
  private async request<T>(path: string, body?: unknown, anonymous = false): Promise<T> {
    const generation = this.generation,
      controller = new AbortController();
    this.controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), 15000);
    timeout.unref();
    try {
      const response = await fetch(`${this.url}/api${path}`, {
        cache: 'no-store',
        method: body === undefined ? 'GET' : 'POST',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(!anonymous ? { Authorization: `Bearer ${this.token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (generation !== this.generation) throw new AppError('analyticsCancelled');
      this.online = true;
      const payload = await response.json();
      if (!response.ok) {
        if (!anonymous && (response.status === 401 || response.status === 403)) {
          this.clear();
          throw new AppError('analyticsSignIn');
        }
        throw new AppError(
          'analyticsRequest',
          String(payload.error ?? 'The analytics request failed.'),
        );
      }
      this.error = null;
      return payload as T;
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (generation !== this.generation) throw new AppError('analyticsCancelled');
      this.online = false;
      this.error = 'analyticsOffline';
      throw new AppError('analyticsOffline');
    } finally {
      clearTimeout(timeout);
      this.controllers.delete(controller);
    }
  }
  private async probe() {
    const generation = this.generation;
    if (!this.url) {
      this.online = false;
      return;
    }
    try {
      const response = await fetch(`${this.url}/api/health`, {
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(3500),
      });
      const health = await response.json();
      if (generation !== this.generation) return;
      this.online = response.ok && health.ok === true;
      this.error = this.online ? null : 'analyticsOffline';
    } catch {
      if (generation === this.generation) {
        this.online = false;
        this.error = 'analyticsOffline';
      }
    }
  }
  async status(probe = true): Promise<OwnerAnalyticsStatus> {
    this.identity();
    if (!this.url) this.url = this.cloud.status().url;
    if (probe) await this.probe();
    if (this.disposed) throw new AppError('analyticsCancelled');
    return {
      url: this.url,
      online: this.online,
      signedIn: !!this.token,
      stores: this.stores,
      storeId: this.storeId,
      error: this.error,
      sync: this.cloud.status(),
    };
  }
  async login(input: { url: string; email: string; password: string }) {
    const owner = this.identity(),
      url = new URL(input.url);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/' ||
      (url.protocol !== 'https:' &&
        !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)))
    )
      throw new AppError('analyticsServer');
    this.clear();
    this.url = url.origin;
    const generation = this.generation;
    const session = await this.request<{ token: string }>(
      '/auth/login',
      { email: input.email, password: input.password, client: 'desktop' },
      true,
    );
    if (generation !== this.generation) throw new AppError('analyticsCancelled');
    this.token = session.token;
    this.ownerId = owner.id;
    try {
      this.stores = await this.request<OwnerStore[]>('/stores');
    } catch (error) {
      this.clear();
      throw error;
    }
    const linked = this.cloud.status();
    this.storeId =
      this.stores.find((s) => s.id === linked.storeId && linked.url === this.url)?.id ??
      this.stores[0]?.id ??
      '';
    return this.status(false);
  }
  async logout() {
    this.identity();
    this.clear();
    return this.status(false);
  }
  async select(storeId: string) {
    this.identity();
    if (!this.stores.some((s) => s.id === storeId)) throw new AppError('forbidden');
    this.generation++;
    for (const c of this.controllers) c.abort();
    this.storeId = storeId;
    return this.status(false);
  }
  private scope() {
    this.identity();
    if (!this.token) throw new AppError('analyticsSignIn');
    if (!this.storeId) throw new AppError('analyticsNoStore');
    return `/stores/${this.storeId}`;
  }
  data(range: { from: string; to: string }) {
    return this.request<OwnerData>(`${this.scope()}/analytics?from=${range.from}&to=${range.to}`);
  }
  sale(saleId: string) {
    return this.request<SaleDetails>(`${this.scope()}/sales/${saleId}`);
  }
  question(question: string) {
    return this.request<Answer>(`${this.scope()}/questions`, { question });
  }
  history() {
    return this.request<{ question: string; created_at: string }[]>(`${this.scope()}/questions`);
  }
  forecast(settings: ForecastSettings) {
    return this.request<ForecastSettings>(`${this.scope()}/forecast-settings`, settings);
  }
  devices() {
    return this.request<AnalyticsDevice[]>(`${this.scope()}/devices`);
  }
  async revoke(deviceId: string) {
    await this.request(`${this.scope()}/devices/${deviceId}/revoke`, {});
    return true;
  }
  async link() {
    const path = this.scope(),
      selected = this.storeId,
      generation = this.generation,
      current = this.cloud.status();
    if (current.connected && current.storeId === selected && current.url === this.url)
      return this.status();
    if (current.connected) throw new AppError('analyticsAlreadyLinked');
    const enrollment = await this.request<{ code: string }>(`${path}/enrollment`, {});
    if (generation !== this.generation || selected !== this.storeId)
      throw new AppError('analyticsCancelled');
    try {
      await this.cloud.enroll(this.url, enrollment.code);
    } catch (error) {
      throw new AppError('analyticsRequest', error instanceof Error ? error.message : undefined);
    }
    return this.status(false);
  }
  async export(input: {
    from: string;
    to: string;
    report: 'sales' | 'products' | 'daily' | 'forecasts';
  }) {
    const generation = this.generation,
      data = await this.data(input);
    const rows =
      input.report === 'forecasts'
        ? data.forecasts
        : input.report === 'daily'
          ? data.report.daily
          : input.report === 'sales'
            ? data.report.sales
            : data.report.products.map(({ nearExpiry: _batches, ...p }) => p);
    const picked = await dialog.showSaveDialog({
      title: 'Export analytics CSV',
      defaultPath: `analytics-${input.report}-${input.from}-${input.to}.csv`,
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    });
    if (picked.canceled || !picked.filePath) return null;
    this.identity();
    if (generation !== this.generation || !this.token) throw new AppError('analyticsCancelled');
    await writeFile(picked.filePath, csv(rows as unknown as Record<string, unknown>[]), 'utf8');
    return picked.filePath;
  }
}
