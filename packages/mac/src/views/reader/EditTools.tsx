import { useEffect, useState } from 'react';
import type { ViewerState } from '@beluga/core/store.js';
import type { FormatterInfo } from '@beluga/core/workspace-files.js';
import { Alert } from '../../components/Alert.js';
import { Button, IconButton, Tip, cx } from '../../components/ui.js';
import { useBeluga } from '../../lib/beluga.js';
import { chordLabel } from '../../lib/shortcuts-model.js';
import { type EditSession, editSession, isDirty, markSaved, setDraft, startEditing, stopEditing, textToSave, updateSession, useEditSession } from './edit-store.js';
import { hasText } from './reader-model.js';
import r from './reader.module.css';
import { useT } from '../../lib/i18n.js';

/**
 * Edit, Format and Save for a file you're reading: in the header of the panel's preview and of the
 * file across the center. Files open read-only; Edit (always in sight, never a setting) makes this
 * one editable until Done. ⌘S saves; leaving with changes not saved asks first.
 */

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err)).replace(/^Error:\s*/, '');

/** Whether the project's Prettier formats this file (asked once per file while the window is open). */
const formatters = new Map<string, Promise<FormatterInfo>>();

function useFormatter(wsId: string, path: string, enabled: boolean): FormatterInfo | undefined {
  const { client } = useBeluga();
  const [info, setInfo] = useState<{ key: string; info: FormatterInfo }>();
  const key = `${wsId}\0${path}`;
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let p = formatters.get(key);
    if (!p) {
      p = client.api.files.formatter(wsId, path).catch((err: unknown): FormatterInfo => ({ available: false, reason: errorText(err) }));
      formatters.set(key, p);
    }
    void p.then((i) => alive && setInfo({ key, info: i }));
    return () => {
      alive = false;
    };
  }, [key, enabled]);
  return info?.key === key ? info.info : undefined;
}

/** A file of yours that can be edited here: text, read whole. */
export const canEdit = (viewer: ViewerState, selfId: string | undefined): boolean => viewer.owner === selfId && !viewer.loading && !viewer.truncated && hasText(viewer);

export function EditTools({ viewer, wsId, selfId, compact = false }: { viewer: ViewerState; wsId: string; selfId: string | undefined; compact?: boolean }) {
  const t = useT();
  const { client } = useBeluga();
  const session = useEditSession(viewer);
  const editable = canEdit(viewer, selfId);
  const formatter = useFormatter(wsId, viewer.path, editable || Boolean(session));
  const [asking, setAsking] = useState<'discard' | 'conflict'>();
  const dirty = isDirty(session);
  const toast = (text: string, level: 'error' | 'info' | 'success' = 'error'): void => client.store.dispatch({ type: 'toast', text, level });

  const save = async (force = false): Promise<void> => {
    const now = editSession(viewer);
    if (!now || now.busy) return;
    updateSession(now.key, { busy: 'saving' });
    try {
      const text = textToSave(now);
      const res = await client.api.files.save(wsId, now.path, text, { expect: await now.baseHash, ...(force ? { force: true } : {}) });
      if (res.ok) markSaved(now.key, text, res.hash);
      else {
        updateSession(now.key, { busy: undefined, conflict: true });
        setAsking('conflict');
      }
    } catch (err) {
      updateSession(now.key, { busy: undefined, error: errorText(err) });
      toast(t('views.edit.saveFailed', { path: now.path, error: errorText(err) }));
    }
  };

  const format = async (): Promise<void> => {
    if (!formatter?.available) return;
    const now = editSession(viewer) ?? startEditing(viewer, wsId, viewer.content);
    if (now.busy) return;
    updateSession(now.key, { busy: 'formatting' });
    try {
      const out = await client.api.files.format(wsId, now.path, now.draft);
      const latest = editSession(viewer);
      if (!latest) return;
      updateSession(latest.key, { busy: undefined });
      // You kept typing while it ran: keep what you typed.
      if (latest.draft !== now.draft) return toast(t('views.edit.changedWhileFormatting'), 'info');
      if (out.replace(/\r\n/g, '\n') === now.draft) return toast(t('views.edit.alreadyFormatted'), 'info');
      setDraft(latest.key, out);
    } catch (err) {
      updateSession(now.key, { busy: undefined });
      toast(errorText(err));
    }
  };

  const done = (): void => {
    if (!session) return;
    if (isDirty(session)) setAsking('discard');
    else stopEditing(session.key);
  };

  // ⌘S saves the file you're editing, wherever the keyboard is in the window.
  useEffect(() => {
    if (!session) return;
    const onKey = (e: KeyboardEvent): void => {
      // ⌘S only (⌃⌘S is the app's own shortcut).
      if (e.metaKey === e.ctrlKey || e.shiftKey || e.altKey || e.key.toLowerCase() !== 's') return;
      e.preventDefault();
      void save();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [session?.key]);

  if (!session && !editable) return null;

  const formatLabel = !formatter ? t('views.edit.formatWithPrettier') : formatter.available ? (formatter.version ? t('views.edit.formatWithPrettierVersion', { version: formatter.version }) : t('views.edit.formatWithPrettier')) : (formatter.reason ?? t('views.edit.noPrettier'));
  const formatBtn = <IconButton icon="wand" label={formatLabel} aria-disabled={!formatter?.available || Boolean(session?.busy)} className={cx(!formatter?.available && r.toolOff)} onClick={() => void format()} />;

  return (
    <>
      {session ? (
        <span className={r.editState} role="status">
          {session.busy === 'saving' ? (
            t('views.edit.saving')
          ) : session.busy === 'formatting' ? (
            t('views.edit.formatting')
          ) : dirty ? (
            <>
              <span className={r.dirtyDot} aria-hidden="true" title={t('views.edit.notSaved')} />
              {compact ? <span className="visually-hidden">{t('views.edit.edited')}</span> : t('views.edit.notSaved')}
            </>
          ) : (
            t('views.edit.editing')
          )}
        </span>
      ) : null}
      {/* The panel is narrow: there, Format comes with Edit. */}
      {session || !compact ? formatBtn : null}
      {session ? (
        <>
          <Tip label={t('common.save')} keys={chordLabel('Cmd+S')}>
            <Button size="small" variant={dirty ? 'primary' : 'quiet'} disabled={!dirty || Boolean(session.busy)} onClick={() => void save()}>
              {t('common.save')}
            </Button>
          </Tip>
          <Tip label={t('views.edit.stopEditing')}>
            <Button size="small" variant="quiet" onClick={done}>
              {t('common.done')}
            </Button>
          </Tip>
        </>
      ) : (
        <Tip label={t('views.edit.editTip')}>
          <Button size="small" variant="quiet" icon="pencil" className={r.editButton} onClick={() => startEditing(viewer, wsId, viewer.content)}>
            {t('views.edit.edit')}
          </Button>
        </Tip>
      )}
      {asking === 'discard' && session ? (
        <Alert
          title={t('views.edit.discardTitle', { name: viewer.path.split('/').pop() ?? '' })}
          message={t('views.edit.discardMessage')}
          tone="danger"
          confirm={{ label: t('views.edit.discard'), destructive: true, onClick: () => (setAsking(undefined), stopEditing(session.key)) }}
          alternative={{ label: t('common.save'), onClick: () => (setAsking(undefined), void save().then(() => !isDirty(editSession(viewer)) && stopEditing(session.key))) }}
          onCancel={() => setAsking(undefined)}
        />
      ) : null}
      {asking === 'conflict' && session ? <ConflictAlert session={session} onCancel={() => setAsking(undefined)} onOverwrite={() => (setAsking(undefined), void save(true))} /> : null}
    </>
  );
}

function ConflictAlert({ session, onCancel, onOverwrite }: { session: EditSession; onCancel: () => void; onOverwrite: () => void }) {
  const t = useT();
  return (
    <Alert
      title={t('views.edit.conflictTitle', { name: session.path.split('/').pop() ?? '' })}
      message={t('views.edit.conflictMessage')}
      tone="caution"
      confirm={{ label: t('views.edit.saveAnyway'), destructive: true, onClick: onOverwrite }}
      onCancel={onCancel}
    />
  );
}
