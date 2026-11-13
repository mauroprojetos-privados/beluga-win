import { useEffect, useState } from 'react';
import { type EndpointView, OLLAMA_URL, modelsOfEndpoint } from '@beluga/shared/local-endpoints.js';
import { Button, Dot } from '../components/ui.js';
import { useApi } from '../lib/beluga.js';
import { Group, Row } from './settings-controls.js';
import s from './settings.module.css';
import { thisComputer } from '../lib/os-words.js';
import { t } from '@beluga/shared/i18n/index.js';
import { say, useT } from '../lib/i18n.js';

interface Draft {
  readonly id?: string;
  readonly label: string;
  readonly baseUrl: string;
  /** Typed here; empty keeps the saved one. */
  readonly key: string;
  readonly clearKey: boolean;
  readonly models: string;
  readonly hasKey: boolean;
}

// i18n-ignore: a product name
const blank: Draft = { label: 'Ollama', baseUrl: OLLAMA_URL, key: '', clearKey: false, models: '', hasKey: false };
const errorText = (err: unknown): string => (err instanceof Error ? err.message.replace(/^Bad arguments for [\w.]+: /, '') : String(err));

function statusOf(e: EndpointView): { tone: 'ok' | 'warn' | 'error' | 'muted'; words: string } {
  if (e.reachable === undefined) return { tone: 'muted', words: t('prefs.localModels.notLooked') };
  if (!e.reachable) return { tone: 'error', words: e.builtIn ? t('prefs.localModels.notRunning', { computer: thisComputer() }) : t('prefs.localModels.notAnswering') };
  const models = modelsOfEndpoint(e);
  return models.length ? { tone: 'ok', words: t('prefs.localModels.models', { count: models.length, list: models.slice(0, 3).join(', '), more: models.length > 3 ? '…' : '' }) } : { tone: 'warn', words: t('prefs.localModels.noModels') };
}

/**
 * Settings › Claude › Local models (BLG-449): Anthropic-compatible endpoints your agent can run on
 * instead of Anthropic. Ollama first: running on this Mac, it shows up by itself. Each endpoint is
 * kept on this Mac with your other secrets; its key is never shown again, only whether it has one.
 */
export function LocalModelsSettings() {
  const t = useT();
  const api = useApi();
  const [list, setList] = useState<readonly EndpointView[] | undefined>(undefined);
  const [draft, setDraft] = useState<Draft | undefined>(undefined);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api.env.checkEndpoints().then(setList, () => setList([]));
  }, [api]);

  const run = async (work: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    setError('');
    try {
      await work();
      setList(await api.env.endpoints());
      setDraft(undefined);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const save = (d: Draft): Promise<void> =>
    run(() =>
      api.env.saveEndpoint({
        ...(d.id ? { id: d.id } : {}),
        label: d.label,
        baseUrl: d.baseUrl,
        ...(d.key ? { key: d.key } : d.clearKey ? { key: '' } : {}),
        models: d.models.split(/[,\n]/).map((m) => m.trim()).filter(Boolean),
      }),
    );

  const edit = (e: EndpointView): void => {
    setError('');
    setDraft({ ...(e.builtIn ? {} : { id: e.id }), label: e.label, baseUrl: e.baseUrl, key: '', clearKey: false, models: e.models.join(', '), hasKey: e.hasKey });
  };

  const form = draft ? (
    <form
      className={s.endpointForm}
      onSubmit={(ev) => {
        ev.preventDefault();
        void save(draft);
      }}
    >
      <label className={s.endpointField}>
        <span>{t('prefs.localModels.name')}</span>
        <input className={s.text} aria-label={t('prefs.localModels.name')} value={draft.label} onChange={(ev) => setDraft({ ...draft, label: ev.target.value })} autoFocus />
      </label>
      <label className={s.endpointField}>
        <span>{t('prefs.localModels.address')}</span>
        <input className={s.text} aria-label={t('prefs.localModels.address')} value={draft.baseUrl} spellCheck={false} placeholder={OLLAMA_URL} onChange={(ev) => setDraft({ ...draft, baseUrl: ev.target.value })} />
      </label>
      <label className={s.endpointField}>
        <span>{t('prefs.localModels.key')}</span>
        <input
          className={s.text}
          aria-label={t('prefs.localModels.key')}
          type="password"
          autoComplete="off"
          value={draft.key}
          placeholder={draft.hasKey && !draft.clearKey ? t('prefs.localModels.keySavedPlaceholder') : t('prefs.localModels.keyNonePlaceholder')}
          onChange={(ev) => setDraft({ ...draft, key: ev.target.value })}
        />
        {draft.hasKey && !draft.key ? (
          <Button size="small" variant="quiet" onClick={() => setDraft({ ...draft, clearKey: !draft.clearKey })}>
            {draft.clearKey ? t('prefs.localModels.keepKey') : t('prefs.localModels.removeKey')}
          </Button>
        ) : null}
      </label>
      <label className={s.endpointField}>
        <span>{t('prefs.localModels.modelsField')}</span>
        <input className={s.text} aria-label={t('prefs.localModels.modelsField')} value={draft.models} spellCheck={false} placeholder={t('prefs.localModels.modelsPlaceholder')} onChange={(ev) => setDraft({ ...draft, models: ev.target.value })} />
      </label>
      {error ? <div className={s.endpointError}>{error}</div> : null}
      <div className={s.endpointBar}>
        <Button size="small" variant="quiet" onClick={() => setDraft(undefined)}>
          {t('common.cancel')}
        </Button>
        <Button size="small" variant="primary" type="submit" disabled={busy || !draft.label.trim() || !draft.baseUrl.trim()}>
          {busy ? t('prefs.localModels.saving') : t('common.save')}
        </Button>
      </div>
    </form>
  ) : null;

  return (
    <Group title={say('Local models')}>
      <Row label={say('Run on your own models')} detail={t('prefs.localModels.runDetail', { computer: thisComputer() })}>
        <Button variant="quiet" icon="refresh" disabled={busy} onClick={() => void run(() => api.env.checkEndpoints())}>
          {t('prefs.localModels.checkAgain')}
        </Button>
        <Button
          icon="plus"
          disabled={busy}
          onClick={() => {
            setError('');
            setDraft(list?.some((e) => !e.builtIn && e.baseUrl === OLLAMA_URL) ? { ...blank, label: '', baseUrl: '' } : blank);
          }}
        >
          {t('prefs.localModels.addEndpoint')}
        </Button>
      </Row>
      {draft && !draft.id ? form : null}
      {list === undefined ? (
        <div className={s.note}>{t('prefs.localModels.looking')}</div>
      ) : (
        list.map((e) => {
          const status = statusOf(e);
          if (draft?.id === e.id && !e.builtIn) return <div key={e.id}>{form}</div>;
          return (
            <Row key={e.id} label={e.builtIn ? t('prefs.localModels.ollamaOn', { computer: thisComputer() }) : e.label} detail={e.builtIn && !e.reachable ? t('prefs.localModels.install') : t('prefs.localModels.rowDetail', { url: e.baseUrl, key: e.hasKey ? t('prefs.localModels.keySaved') : '', status: status.words })}>
              <Dot tone={status.tone} />
              <Button size="small" variant="quiet" disabled={busy} onClick={() => edit(e)}>
                {e.builtIn ? t('prefs.localModels.setUp') : t('prefs.localModels.edit')}
              </Button>
              {e.builtIn ? null : (
                <Button size="small" variant="quiet" disabled={busy} onClick={() => void run(() => api.env.removeEndpoint(e.id))}>
                  {t('prefs.localModels.remove')}
                </Button>
              )}
            </Row>
          );
        })
      )}
      {error && !draft ? <div className={s.endpointError}>{error}</div> : null}
    </Group>
  );
}
