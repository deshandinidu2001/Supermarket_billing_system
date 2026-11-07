import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Cloud, RefreshCw } from 'lucide-react';
import { api } from '../lib/api';
import { Button } from '../components/ui/button';
import { labels } from '../../packages/analytics/locales';
import type { CloudStatus } from '../../shared/analytics';

export default function CloudSettings() {
  const { i18n } = useTranslation(),
    t = labels[i18n.language === 'si' ? 'si' : 'en'];
  const [status, setStatus] = useState<CloudStatus>(),
    [url, setUrl] = useState(''),
    [code, setCode] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    const load = () =>
      void api('cloudStatus', {})
        .then((s) => {
          if (active) setStatus(s);
        })
        .catch(() => {});
    load();
    const timer = setInterval(load, 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  const act = async (fn: () => Promise<CloudStatus>) => {
    setBusy(true);
    setError('');
    try {
      setStatus(await fn());
      setCode('');
    } catch (e) {
      setError(e instanceof Error ? i18n.t(e.message) : 'Cloud connection failed.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel settings-section">
      <h2>
        <Cloud size={18} /> {t.cloudTitle}
      </h2>
      <p>{t.syncHint}</p>
      {status && (
        <p role="status">
          {t.pending}: {status.pending} · {t.lastSync}:{' '}
          {status.lastSync ? new Date(status.lastSync).toLocaleString() : '—'}
          {status.quarantined ? ` · ${status.quarantined} event(s) need a rebuild` : ''}
        </p>
      )}
      {(error || status?.error) && <p role="alert">{error || status?.error}</p>}
      {!status?.connected ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void act(() => api('cloudConnect', { url, code }));
          }}
          className="cloud-connect-form"
        >
          <label>
            {t.server}
            <input
              required
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://analytics.example.com"
            />
          </label>
          <label>
            {t.code}
            <input
              required
              autoComplete="off"
              type="password"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </label>
          <Button disabled={busy}>{t.connect}</Button>
        </form>
      ) : (
        <div className="cloud-actions">
          <p>{status.url}</p>
          <Button
            disabled={busy || status.busy}
            onClick={() => void act(() => api('cloudRetry', {}))}
          >
            <RefreshCw size={16} />
            {t.refresh}
          </Button>
          <Button
            variant="outline"
            disabled={busy || status.busy}
            onClick={() => {
              if (window.confirm(t.rebuildHint))
                void act(() => api('cloudRebuild', { confirm: 'REBUILD' }));
            }}
          >
            {t.rebuild}
          </Button>
          <Button
            variant="ghost"
            disabled={busy || status.busy}
            onClick={() => void act(() => api('cloudDisconnect', {}))}
          >
            {t.disconnect}
          </Button>
        </div>
      )}
    </section>
  );
}
