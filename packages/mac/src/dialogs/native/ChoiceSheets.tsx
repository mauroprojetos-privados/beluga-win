import { useEffect, useState } from 'react';
import { runtimeMark } from '@beluga/shared/agent-marks.js';
import { agentPicker } from '@beluga/shared/agent-picker.js';
import { findWorkspace } from '@beluga/ui/workspace-models.js';
import { foreignMark, myRuntime, pickerState, samePicker, setMyAgent } from '../../chat/ModelPicker.js';
import { Field, FormSheet, PickList, formStyles as f } from '../../components/FormSheet.js';
import { Icon } from '../../components/Icon.js';
import { useMyAgentName } from '../../lib/agent-words.js';
import { useApi, useApp, useBeluga } from '../../lib/beluga.js';
import type { NativeMenuProps } from './index.js';
import { usePick } from './pick.js';
import { revealLabel, thisComputer } from '../../lib/os-words.js';
import { useT } from '../../lib/i18n.js';
import { rich } from './parts.js';

/**
 * The model for one conversation (or for new ones): the models of the agent it runs on, the
 * current one selected, each with its mark. Another agent is picked in the composer's agent picker.
 */
export function ModelSheet({ menu, close }: NativeMenuProps<'model'>) {
  const api = useApi();
  const t = useT();
  const picker = useApp((st) => agentPicker(pickerState(st), menu.channel ?? 'draft', myRuntime(st.prefs)), samePicker);
  const group = picker.groups.find((g) => g.current);
  const models = group?.models ?? [];
  const current = picker.model;
  const [value, setValue] = useState(current);
  const use = (v: string): void => {
    if (!group || models.find((m) => m.value === v)?.why) return;
    if (menu.channel === undefined) setMyAgent(api, group.runtime, group.label, v);
    else void api.workbench.setModel(menu.channel, v);
    close();
  };
  const who = group?.label ?? t('native.model.yourAgent');
  return (
    <FormSheet
      title={menu.channel === undefined ? t('native.model.titleNew') : t('native.model.titleThis')}
      icon={runtimeMark(picker.runtime)}
      intro={menu.channel === undefined ? t('native.model.introNew', { who }) : t('native.model.introThis', { who })}
      submitLabel={t('native.model.use')}
      canSubmit={value !== current && !models.find((m) => m.value === value)?.why}
      onSubmit={() => use(value)}
      onCancel={close}
      width={500}
    >
      <PickList
        label={t('native.model.models', { who })}
        value={value}
        onChange={setValue}
        onChoose={use}
        rows={models.map((m) => ({
          value: m.value,
          leading: <Icon name={foreignMark(m.value, picker.runtime) ?? runtimeMark(picker.runtime)} size={13} />,
          name: m.label,
          detail: m.why ?? m.description,
          trailing: m.value === current ? <Icon name="check" size={13} /> : undefined,
        }))}
      />
    </FormSheet>
  );
}

/** First thing after joining a room: may people here use your agent? */
export function WelcomeSheet({ menu, close }: NativeMenuProps<'welcome'>) {
  const pick = usePick(menu);
  const t = useT();
  const agent = useMyAgentName();
  const room = useApp((st) => st.room);
  const self = useApp((st) => st.self?.name);
  const peers = useApp((st) => st.peers);
  const others = peers.filter((p) => p.name !== self).map((p) => p.name);
  const [policy, setPolicy] = useState<'share-ask' | 'share-auto' | 'share-deny'>('share-ask');
  return (
    <FormSheet
      title={t('native.welcome.title', { room })}
      icon="people"
      intro={
        <>
          <p>{others.length ? t('native.welcome.here', { count: others.length, names: others.join(', ') }) : t('native.welcome.nobody')}</p>
          <p>{t('native.welcome.friendsCanAsk', { agent, computer: thisComputer() })}</p>
        </>
      }
      submitLabel={t('native.work.continue')}
      onSubmit={() => void pick(policy)}
      onCancel={close}
      cancelLabel={t('native.welcome.later')}
      width={520}
    >
      <Field label={t('native.shareFolder.yourAgent')}>
        <PickList
          label={t('native.welcome.canUse')}
          value={policy}
          onChange={setPolicy}
          onChoose={(v) => pick(v)}
          rows={[
            { value: 'share-ask', name: t('native.person.policyAsk'), detail: t('native.welcome.askDetail') },
            { value: 'share-auto', name: t('native.welcome.everyone'), detail: t('native.welcome.everyoneDetail') },
            { value: 'share-deny', name: t('native.welcome.private'), detail: t('native.welcome.privateDetail') },
          ]}
        />
      </Field>
    </FormSheet>
  );
}

/** The inbox is the notification centre here (the bell). */
export function InboxRedirect({ close }: NativeMenuProps<'inbox'>) {
  const { ui } = useBeluga();
  useEffect(() => {
    close();
    ui.patch({ notices: true });
  }, []);
  return null;
}

/** An archived workspace: restore it (the usual thing), read it, or delete it for good. */
export function ArchivedSheet({ menu, close }: NativeMenuProps<'archived'>) {
  const pick = usePick(menu);
  const t = useT();
  const ws = useApp((st) => findWorkspace(st.projects, menu.id));
  if (!ws) return null;
  const worktree = ws.kind === 'worktree';
  return (
    <FormSheet
      title={t('native.archived.title', { name: ws.name })}
      icon="archive"
      intro={worktree ? rich(t('native.archived.introWorktree'), { branch: <code>{ws.branch ?? ''}</code> }) : t('native.archived.introChat')}
      submitLabel={t('native.archived.restore')}
      onSubmit={() => void pick('a-restore')}
      onCancel={close}
      width={580}
      footer={
        <>
          <button type="button" className={f.linkButton} onClick={() => pick('a-open')}>
            {t('native.archived.read')}
          </button>
          <button type="button" className={f.linkButton} onClick={() => pick('a-finder')}>
            {revealLabel('Project')}
          </button>
          <button type="button" className={f.linkDanger} onClick={() => pick('a-delete')}>
            {t('native.archived.delete')}
          </button>
        </>
      }
    />
  );
}
