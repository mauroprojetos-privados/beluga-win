import { useState } from 'react';
import { MAX_PROJECT_CONTEXT } from '@beluga/core/board/model.js';
import { Field, FormSheet, TextArea } from '../components/FormSheet.js';
import { toast, useApp, useBeluga } from '../lib/beluga.js';
import { sameDeep } from '../lib/stable.js';
import { ago } from './tasks-model.js';
import { useBoard, useTaskActions } from './use-tasks.js';
import { useT } from '../lib/i18n.js';

/**
 * About This Project (BLG-298): a few paragraphs Claude reads whenever it writes a task here, so a
 * task makes sense without a look at the whole codebase. Teammates on the project share it.
 */
export function ProjectContextSheet({ projectId, close }: { projectId: string; close: () => void }) {
  const board = useBoard();
  const t = useT();
  const { client } = useBeluga();
  const { api } = useTaskActions();
  const mates = useApp((st) => st.team.teams[projectId]?.mates.map((m) => m.name) ?? [], sameDeep);
  const saved = board.projects[projectId]?.context;
  const [text, setText] = useState(saved?.text ?? '');
  const changed = text.trim() !== (saved?.text ?? '');
  const shared = mates.length ? t('tasks.pc.sharedWith', { names: mates.join(', ') }) : t('tasks.pc.matesToo');
  return (
    <FormSheet
      title={t('tasks.pc.title')}
      icon="book"
      intro={t('tasks.pc.intro')}
      submitLabel={t('common.save')}
      width={600}
      canSubmit={changed}
      onCancel={close}
      onSubmit={async () => {
        await api.setContext(projectId, text);
        close();
        toast(client, text.trim() ? t('tasks.pc.knows') : t('tasks.pc.cleared'), 'success');
      }}
    >
      <Field label={t('plans.d.context')} htmlFor="project-context" hint={`${shared}${saved?.text ? t('tasks.pc.lastEdited', { who: saved.by, when: ago(saved.at) }) : ''}`}>
        <TextArea id="project-context" autoFocus rows={12} value={text} placeholder={t('tasks.pc.placeholder')} maxLength={MAX_PROJECT_CONTEXT} onChange={setText} />
      </Field>
    </FormSheet>
  );
}
