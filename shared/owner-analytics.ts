import { z } from 'zod';
import { forecastSettingsSchema, type CloudStatus } from './analytics';
import type { OwnerStore, OwnerData, Answer } from '../packages/analytics/client';
const id = z.string().uuid();
const range = z
  .object({ from: z.string().date(), to: z.string().date() })
  .refine(
    (r) => r.from <= r.to && (Date.parse(r.to) - Date.parse(r.from)) / 86400000 <= 366,
    'Choose a reporting period of at most 367 days.',
  );
export const ownerAnalyticsSchemas = {
  analyticsStatus: z.object({}),
  analyticsLogin: z.object({
    url: z.string().url().max(250),
    email: z.string().email().max(200),
    password: z.string().min(1).max(200),
  }),
  analyticsLogout: z.object({}),
  analyticsSelectStore: z.object({ storeId: id }),
  analyticsData: range,
  analyticsSale: z.object({ saleId: id }),
  analyticsQuestion: z.object({ question: z.string().trim().min(3).max(500) }),
  analyticsHistory: z.object({}),
  analyticsForecastSettings: forecastSettingsSchema,
  analyticsDevices: z.object({}),
  analyticsRevokeDevice: z.object({ deviceId: id }),
  analyticsLink: z.object({ confirm: z.literal('CONNECT') }),
  analyticsExport: range.and(
    z.object({ report: z.enum(['sales', 'products', 'daily', 'forecasts']) }),
  ),
};
export interface OwnerAnalyticsStatus {
  url: string;
  online: boolean;
  signedIn: boolean;
  stores: OwnerStore[];
  storeId: string;
  error: string | null;
  sync: CloudStatus;
}
export interface SaleDetails {
  sale: Record<string, unknown>;
  items: Record<string, unknown>[];
  payments: Record<string, unknown>[];
  returns: Record<string, unknown>[];
}
export interface AnalyticsDevice {
  id: string;
  revoked: boolean;
  last_sequence: number | string;
}
export interface OwnerAnalyticsOutputs {
  analyticsStatus: OwnerAnalyticsStatus;
  analyticsLogin: OwnerAnalyticsStatus;
  analyticsLogout: OwnerAnalyticsStatus;
  analyticsSelectStore: OwnerAnalyticsStatus;
  analyticsData: OwnerData;
  analyticsSale: SaleDetails;
  analyticsQuestion: Answer;
  analyticsHistory: { question: string; created_at: string }[];
  analyticsForecastSettings: z.infer<typeof forecastSettingsSchema>;
  analyticsDevices: AnalyticsDevice[];
  analyticsRevokeDevice: boolean;
  analyticsLink: OwnerAnalyticsStatus;
  analyticsExport: string | null;
}
