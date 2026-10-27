import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
export function cn(...values: ClassValue[]) {
  return twMerge(clsx(values));
}
export const money = (value: number) =>
  `Rs. ${(value / 100).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const dateString = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export function rangeFor(preset: string) {
  const end = new Date(),
    start = new Date();
  if (preset === 'week') start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  if (preset === 'month') start.setDate(1);
  return { from: dateString(start), to: dateString(end) };
}
export const displayDate = (value: string, time = false) =>
  value
    ? new Date(value.length === 10 ? `${value}T00:00:00` : value).toLocaleString(
        'en-GB',
        time
          ? {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
              hour12: true,
            }
          : { day: '2-digit', month: '2-digit', year: 'numeric' },
      )
    : '—';
export const safe = (task: () => Promise<unknown>) => {
  void task().catch(() => {});
};
