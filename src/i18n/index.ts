import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en.json';
import si from './si.json';
void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, si: { translation: si } },
  lng: localStorage.getItem('ajith-language') === 'si' ? 'si' : 'en',
  fallbackLng: 'en',
  keySeparator: false,
  interpolation: { escapeValue: false },
});
export default i18n;
