import { useEffect, useState } from 'react';
import { findWorkspace } from '@beluga/ui/workspace-models.js';
import { Field, FormSheet, Popup, TextArea, TextInput } from '../../components/FormSheet.js';
import { useApi, useApp } from '../../lib/beluga.js';
import { Select } from '../../components/Select.js';
import { YOUR_AGENT, useAgentEntries } from '../../components/agent-options.js';
import { useMyAgent } from '../../lib/agent-words.js';
import { agentForChoice, choiceForAgent } from '@beluga/ui/agent-choice.js';
import { agentName } from '@beluga/shared/agent-label.js';
import { cmdReturn } from '../../lib/os-words.js';
import { useT } from '../../lib/i18n.js';

/**
 * Continue a questions-only chat (a project's main folder) in a new worktree: what Claude should
 * do there (what you asked last, to start with), the branch it starts from, an optional name.
 * The conversation comes along; Claude starts right away. Agent (BLG-506): who goes on there; one
 * that can't pick the conversation up (another runtime) starts fresh, handed the conversation so far.
 */
export function ContinueSheet({ wsId, close }: { wsId: string; close: () => void }) {
  const api = useApi();
  const t = useT();
  const ws = useApp((st) => findWorkspace(st.projects, wsId));
  const project = useApp((st) => st.projects.find((p) => p.workspaces.some((w) => w.id === wsId)));
  const asked = useApp((st) => {
    const mine = st.log.filter((l) => l.channel === `ws:${wsId}` && l.type === 'chat' && l.from === st.selfId);
    const last = mine[mine.length - 1];
    return last?.type === 'chat' ? last.text : '';
  });
  const [task, setTask] = useState(asked);
  const [name, setName] = useState('');
  const [branches, setBranches] = useState<{ base: string; branches: readonly string[] }>();
  const [base, setBase] = useState('');
  const agents = useAgentEntries();
  const runtimes = useApp((st) => st.runtimes);
  const mine = useMyAgent();
  const own = ws?.agent ? choiceForAgent(ws.agent) : YOUR_AGENT;
  const [agent, setAgent] = useState(own);
  useEffect(() => {
    if (!project?.id) return;
    let alive = true;
    api.workspaces.branches(project.id).then(
      (b) => alive && b && (setBranches(b), setBase((cur) => cur || b.base)),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [project?.id]);
  if (!ws || !project) return null;
  const chosen = base || project.base;
  const options = (branches?.branches.length ? branches.branches : [chosen]).map((b) => ({ value: b, label: b === branches?.base ? t('native.continue.defaultBranch', { branch: b }) : b }));
  // Picked another agent: sent only when it changed. Another runtime than the session's starts fresh (resumeFor).
  const picked = agent === YOUR_AGENT ? mine : agentForChoice(agent, runtimes);
  const fresh = agent !== own && Boolean(ws.sessionId) && picked.runtime !== (ws.sessionRuntime ?? 'claude');
  return (
    <FormSheet
      title={t('native.continue.title')}
      icon="branch"
      intro={t('native.continue.intro')}
      submitLabel={t('native.work.continue')}
      onSubmit={() => {
        // Git fetches and makes the worktree behind the chat ("Making this chat a worktree…"); a failure comes back as a toast.
        void api.workspaces.continueInWorktree(ws.id, { ...(task.trim() ? { task: task.trim() } : {}), ...(chosen !== project.base ? { base: chosen } : {}), ...(name.trim() ? { name: name.trim() } : {}), ...(agent !== own ? { agent: picked } : {}) }).catch(() => undefined);
        close();
      }}
      onCancel={close}
      width={540}
    >
      <Field label={t('native.continue.task')} htmlFor="continue-task" hint={t('native.continue.taskHint', { keys: cmdReturn() })}>
        <TextArea id="continue-task" value={task} onChange={setTask} rows={4} placeholder={t('native.continue.taskPlaceholder')} data-autofocus />
      </Field>
      <Field label={t('native.continue.basedOn')} htmlFor="continue-base" hint={t('native.continue.basedOnHint')}>
        <Popup id="continue-base" label={t('native.continue.basedOn')} value={chosen} options={options} onChange={setBase} />
      </Field>
      <Field label={t('native.project.agent')} htmlFor="continue-agent" hint={fresh ? t('native.continue.agentFresh', { agent: agentName(picked) }) : t('native.continue.agentHint')}>
        <Select id="continue-agent" label={t('native.continue.agentLabel')} value={agent} options={agents} onChange={setAgent} />
      </Field>
      <Field label={t('native.fork.name')} htmlFor="continue-name" hint={t('native.continue.nameHint')}>
        <TextInput id="continue-name" value={name} onChange={setName} maxLength={60} placeholder={t('native.continue.namePlaceholder')} spellCheck={false} />
      </Field>
    </FormSheet>
  );
}
