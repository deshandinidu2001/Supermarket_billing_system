import { roundQty } from '../../services/calculations';

export type MeasuredUnit = 'kg' | 'g' | 'l' | 'ml';
const factors: Record<MeasuredUnit, number> = { kg: 1000, g: 1, l: 1000, ml: 1 };
export function isMeasuredUnit(unit: string): unit is MeasuredUnit {
  return ['kg', 'g', 'l', 'ml'].includes(unit);
}
export function measurementUnits(unit: MeasuredUnit): MeasuredUnit[] {
  return unit === 'kg' || unit === 'g' ? ['kg', 'g'] : ['l', 'ml'];
}
/** Convert to the product's pricing unit without silently rounding a customer's measurement. */
export function measuredQuantity(
  value: number,
  enteredUnit: MeasuredUnit,
  productUnit: MeasuredUnit,
) {
  if (!Number.isFinite(value) || !measurementUnits(productUnit).includes(enteredUnit)) return null;
  const converted = (value * factors[enteredUnit]) / factors[productUnit];
  const rounded = roundQty(converted);
  if (rounded <= 0 || rounded > 1_000_000 || Math.abs(converted - rounded) > 0.0000001) return null;
  return rounded;
}
export function measurementStep(enteredUnit: MeasuredUnit, productUnit: MeasuredUnit) {
  return (0.001 * factors[productUnit]) / factors[enteredUnit];
}
