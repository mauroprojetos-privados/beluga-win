import { useEffect, useState } from 'react';
import { Button, Tip } from '../components/ui.js';
import { Icon } from '../components/Icon.js';
import { findWorkspace } from '@beluga/ui/workspace-models.js';
import { useApi, useApp } from '../lib/beluga.js';
import { type Key } from '@beluga/shared/i18n/index.js';
import { useT } from '../lib/i18n.js';
import s from './pr-strip.module.css';

const LEVEL_WORDS: Readonly<Record<string, Key>> = { ask: 'chat.driven.ask', trusted: 'chat.driven.trusted', full: 'chat.driven.full' };

/**
 * Above a chat an external agent started: which agent drives it and at what level. Stop ends all
 * the agent has going. Revoke also ends its grant. A level of nothing: its grant is gone.
 */
export function DrivenStrip({ workspaceId }: { workspaceId: string }) {
  const api = useApi();
  const t = useT();
  const agent = useApp((st) => findWorkspace(st.projects, workspaceId)?.startedByAgent);
  const running = useApp((st) => st.log.some((l) => l.type === 'agent' && l.channel === `ws:${workspaceId}` && !['done', 'error', 'denied', 'interrupted'].includes(l.status)));
  const [level, setLevel] = useState<string | undefined>();
  const id = agent?.id;
  useEffect(() => {
    if (!id) return;
    void api.external.agents().then((list) => setLevel((list as ReadonlyArray<{ id: string; level: string }>).find((a) => a.id === id)?.level), () => undefined);
  }, [api, id]);
  if (!agent) return null;
  return (
    <div className={s.strip} data-driven-strip={agent.id}>
      <div className={s.row}>
        <span className={s.main}>
          <Icon name="plug" size={13} />
          <span className={s.title}>
            {t('chat.driven.by', { name: agent.name, level: level ? (LEVEL_WORDS[level] ? t(LEVEL_WORDS[level]) : level) : t('chat.driven.gone') })}
          </span>
        </span>
        <Tip label={t('chat.driven.stopTip', { name: agent.name })}>
          <Button size="small" disabled={!running} onClick={() => void api.external.stopAgent(agent.id)}>{t('common.stop')}</Button>
        </Tip>
        {level ? (
          <Tip label={t('chat.driven.revokeTip', { name: agent.name })}>
            <Button size="small" tone="error" onClick={() => void api.external.revoke(agent.id).then(() => setLevel(undefined))}>{t('chat.driven.revoke')}</Button>
          </Tip>
        ) : null}
      </div>
    </div>
  );
}
