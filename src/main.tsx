import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/noto-sans-sinhala/sinhala-400.css';
import '@fontsource/noto-sans-sinhala/sinhala-600.css';
import './i18n';
import './styles.css';
import App from './App';
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
