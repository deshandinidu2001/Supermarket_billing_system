import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Scale } from 'lucide-react';
import type { Product } from '../../shared/types';
import { roundMoney } from '../../services/calculations';
import {
  measuredQuantity,
  measurementStep,
  measurementUnits,
  type MeasuredUnit,
} from '../lib/measurement';
import { money, safe } from '../lib/utils';
import { Modal } from './ui/dialog';
import { Button } from './ui/button';

export default function MeasuredItemDialog({
  product,
  initialQuantity,
  onSave,
  onClose,
}: {
  product: Product & { unit: MeasuredUnit };
  initialQuantity?: number;
  onSave: (quantity: number) => Promise<void>;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [value, setValue] = useState(initialQuantity == null ? '' : String(initialQuantity));
  const [unit, setUnit] = useState<MeasuredUnit>(product.unit);
  const [busy, setBusy] = useState(false);
  const quantity = value.trim() ? measuredQuantity(Number(value), unit, product.unit) : null;
  const weighted = product.unit === 'kg' || product.unit === 'g';
  const price = quantity == null ? 0 : roundMoney(product.selling_price * quantity);
  const presets = weighted
    ? [
        { value: 250, unit: 'g' },
        { value: 500, unit: 'g' },
        { value: 1, unit: 'kg' },
        { value: 2, unit: 'kg' },
      ]
    : [
        { value: 250, unit: 'ml' },
        { value: 500, unit: 'ml' },
        { value: 1, unit: 'l' },
        { value: 2, unit: 'l' },
      ];
  return (
    <Modal
      open
      onClose={() => {
        if (!busy) onClose();
      }}
      title={t(weighted ? 'enterWeight' : 'enterVolume')}
      description={t('measurementHint')}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (quantity == null || busy) return;
          safe(async () => {
            setBusy(true);
            try {
              await onSave(quantity);
              onClose();
            } finally {
              setBusy(false);
            }
          });
        }}
      >
        <div className="measured-product">
          <div className="measured-product-icon">
            {product.image ? <img src={product.image} alt="" /> : <Scale size={26} />}
          </div>
          <div>
            <h3>{i18n.language === 'si' ? product.name_si : product.name_en}</h3>
            <p>
              {money(product.selling_price)} / {t(`units.${product.unit}`)}
            </p>
          </div>
        </div>
        <div className="measurement-inputs">
          <label className="field">
            <span>{t(weighted ? 'measurementWeight' : 'measurementVolume')}</span>
            <input
              type="number"
              value={value}
              min={measurementStep(unit, product.unit)}
              step={measurementStep(unit, product.unit)}
              autoFocus
              required
              inputMode="decimal"
              aria-invalid={!!value && quantity == null}
              onChange={(event) => setValue(event.target.value)}
            />
          </label>
          <label className="field">
            <span>{t('measurementUnit')}</span>
            <select
              value={unit}
              onChange={(event) => {
                const nextUnit = event.target.value as MeasuredUnit;
                if (value && quantity != null) {
                  // Preserve the physical quantity when switching kg/g or l/ml.
                  const currentLarge = unit === 'kg' || unit === 'l';
                  const nextLarge = nextUnit === 'kg' || nextUnit === 'l';
                  setValue(
                    String(
                      Number(
                        (
                          (Number(value) * (currentLarge ? 1000 : 1)) /
                          (nextLarge ? 1000 : 1)
                        ).toFixed(6),
                      ),
                    ),
                  );
                }
                setUnit(nextUnit);
              }}
            >
              {measurementUnits(product.unit).map((option) => (
                <option key={option} value={option}>
                  {t(`units.${option}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="measurement-presets" role="group" aria-label={t('commonMeasurements')}>
          {presets.map((preset) => (
            <Button
              key={`${preset.value}-${preset.unit}`}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setUnit(preset.unit as MeasuredUnit);
                setValue(String(preset.value));
              }}
            >
              {preset.value} {t(`units.${preset.unit}`)}
            </Button>
          ))}
        </div>
        {value && quantity == null && (
          <p className="error-text" role="alert">
            {t('invalidMeasurement')}
          </p>
        )}
        <div className="measurement-price" aria-live="polite">
          <div>
            <span>{t('calculatedPrice')}</span>
            <small>
              {quantity == null
                ? '—'
                : `${quantity} ${t(`units.${product.unit}`)} × ${money(product.selling_price)}`}
            </small>
          </div>
          <strong>{money(price)}</strong>
        </div>
        <p className="measurement-note">{t('measurementDiscountHint')}</p>
        <div className="modal-actions">
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button disabled={quantity == null || busy}>
            {t(initialQuantity == null ? 'addToBill' : 'updateQuantity')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
