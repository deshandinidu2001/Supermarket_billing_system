export class AppError extends Error {
  constructor(
    public code: string,
    public details?: string,
  ) {
    super(code);
  }
}
export function requireValue<T>(value: T, code = 'notFound'): NonNullable<T> {
  if (value == null) throw new AppError(code);
  return value as NonNullable<T>;
}
