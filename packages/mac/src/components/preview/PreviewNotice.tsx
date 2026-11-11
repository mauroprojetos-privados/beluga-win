import { experimentOn } from '@beluga/shared/experiments.js';
import { parsePreviewRef, previewTitle } from '@beluga/shared/preview/ref.js';
import { webServed } from '../../lib/boot.js';
import { useApp, useBeluga } from '../../lib/beluga.js';
import { Icon } from '../Icon.js';
import { Button, cx } from '../ui.js';
import { useT } from '../../lib/i18n.js';
import s from './preview.module.css';

/**
 * What a preview block shows where it won't draw (Live previews off, a friend's answer, outside a
 * worktree, a browser): a quiet card. Small on purpose: the chat shows it without loading any of
 * the previews themselves (PreviewBlock.tsx loads only when one can draw).
 */

/** A quiet card in the preview's place. */
export function Notice({ title, icon = 'eye', detail, action }: { title: string; icon?: 'eye' | 'info' | 'lock'; detail: string; action?: { label: string; run: () => void } }) {
  return (
    <figure className={cx(s.preview, s.notice)}>
      <Icon name={icon} size={13} />
      <div className={s.noticeText}>
        <strong>{title}</strong>
        <span>{detail}</span>
      </div>
      {action ? (
        <Button size="small" onClick={action.run}>
          {action.label}
        </Button>
      ) : null}
    </figure>
  );
}

/** Whether a block can draw here: on, your own agent's, in a worktree's conversation, in the app. */
export function usePreviewHere(local: boolean): { readonly draws: boolean; readonly wsId: string | undefined; readonly on: boolean } {
  const on = useApp((st) => experimentOn(st.prefs.experiments, 'previews'));
  const wsId = useApp((st) => (st.view.kind === 'workspace' ? st.view.id : undefined));
  return { draws: on && local && Boolean(wsId) && !webServed(), wsId, on };
}

/** The card for a block that can't draw here, saying why (and Turn On… when it's only off). */
export function PreviewNotice({ code, local }: { code: string; local: boolean }) {
  const t = useT();
  const { ui } = useBeluga();
  const { wsId, on } = usePreviewHere(local);
  const ref = parsePreviewRef(code);
  if (!ref) return <Notice icon="info" title={t('components.preview.cantRead')} detail={t('components.preview.cantReadDetail')} />;
  const named = t('components.preview.aPreviewOf', { title: previewTitle(ref) });
  if (!local) return <Notice icon="lock" title={named} detail={t('components.preview.onlyYours')} />;
  if (webServed()) return <Notice title={named} detail={t('components.preview.onlyInApp')} />;
  if (!wsId) return <Notice title={named} detail={t('components.preview.inWorktree')} />;
  if (!on) return <Notice title={named} detail={t('components.preview.experimental')} action={{ label: t('components.preview.turnOn'), run: () => ui.patch({ settings: 'experimental' }) }} />;
  return null;
}
