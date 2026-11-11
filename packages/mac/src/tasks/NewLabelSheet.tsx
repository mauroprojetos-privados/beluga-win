import { useState } from 'react';
import { LABEL_COLORS, LABEL_COLOR_INFO, LABEL_ICONS, LABEL_NAME, type LabelColor, type LabelIcon, cleanLabelName, labelTitle, labelsFor } from '@beluga/core/board/labels.js';
import { issueById } from '@beluga/core/board/model.js';
import { Field, FormSheet, TextInput } from '../components/FormSheet.js';
import { Icon } from '../components/Icon.js';
import { IconButton, cx } from '../components/ui.js';
import { toast, useBeluga } from '../lib/beluga.js';
import { LabelMark } from './marks.js';
import { useBoard, useTaskActions } from './use-tasks.js';
import n from './NewTaskSheet.module.css';
import { useT } from '../lib/i18n.js';

/**
 * A new label for a project's set, made on purpose: a name, an icon and a named color (and what
 * it's for, which Claude reads too). Opened from a task's Labels menu, the task gets it at once.
 * The project's own labels are listed under it, each with a remove button.
 */
export function NewLabelSheet({ projectId, issueId, close }: { projectId: string; issueId?: string; close: () => void }) {
  const board = useBoard();
  const t = useT();
  const { client } = useBeluga();
  const { api, act } = useTaskActions();
  const [name, setName] = useState('');
  const [icon, setIcon] = useState<LabelIcon>('tag');
  const [color, setColor] = useState<LabelColor>('blue');
  const [hint, setHint] = useState('');
  const set = labelsFor(board, projectId);
  const own = board.projects[projectId]?.labels ?? [];
  const clean = cleanLabelName(name);
  const taken = set.some((l) => l.name === clean);
  const error = !clean ? undefined : taken ? t('tasks.l.taken') : !LABEL_NAME.test(clean) ? t('tasks.l.badName') : undefined;
  const def = { name: clean || 'label', icon, color };
  const tone = { ['--hue' as string]: String(LABEL_COLOR_INFO[color].hue), ['--sat' as string]: `${LABEL_COLOR_INFO[color].sat}%` };
  return (
    <FormSheet
      title={t('tasks.l.newLabel')}
      icon="tag"
      intro={t('tasks.l.intro')}
      submitLabel={issueId ? t('tasks.l.createAdd') : t('tasks.l.create')}
      canSubmit={Boolean(clean) && !error}
      onCancel={close}
      onSubmit={async () => {
        const made = await api.createLabel(projectId, { name: clean, icon, color, ...(hint.trim() ? { hint: hint.trim() } : {}) });
        const issue = issueId ? issueById(board, issueId) : undefined;
        close();
        if (issue) await act(() => api.update(issue.id, { labels: [...issue.labels, made.name] }));
        else toast(client, t('tasks.l.added', { name: labelTitle(made.name) }), 'success');
      }}
    >
      <Field label={t('tasks.l.name')} htmlFor="label-name" error={error} aside={<span className={n.labelPreview} style={tone}><LabelMark def={def} label={def.name} />{labelTitle(def.name)}</span>}>
        <TextInput id="label-name" autoFocus value={name} placeholder={t('tasks.l.namePlaceholder')} invalid={Boolean(error)} onChange={setName} maxLength={24} />
      </Field>
      <Field label={t('tasks.l.icon')}>
        <div className={n.iconGrid} role="radiogroup" aria-label={t('tasks.l.icon')}>
          {LABEL_ICONS.map((i) => (
            <button key={i} type="button" role="radio" aria-checked={i === icon} aria-label={i} className={cx(n.iconPick, i === icon && n.iconPickOn)} style={tone} onClick={() => setIcon(i)}>
              <Icon name={i} size={14} />
            </button>
          ))}
        </div>
      </Field>
      <Field label={t('tasks.l.color')}>
        <div className={n.colorRow} role="radiogroup" aria-label={t('tasks.l.color')}>
          {LABEL_COLORS.map((c) => (
            <button key={c} type="button" role="radio" aria-checked={c === color} title={LABEL_COLOR_INFO[c].label} aria-label={LABEL_COLOR_INFO[c].label} className={cx(n.swatch, c === color && n.swatchOn)} style={{ ['--hue' as string]: String(LABEL_COLOR_INFO[c].hue), ['--sat' as string]: `${LABEL_COLOR_INFO[c].sat}%` }} onClick={() => setColor(c)} />
          ))}
          <span className={n.colorName}>{LABEL_COLOR_INFO[color].label}</span>
        </div>
      </Field>
      <Field label={t('tasks.l.whatFor')} hint={t('tasks.l.whatForHint')} htmlFor="label-hint">
        <TextInput id="label-hint" value={hint} placeholder={t('tasks.l.hintPlaceholder')} onChange={setHint} maxLength={80} />
      </Field>
      {own.length ? (
        <Field label={t('tasks.l.projectLabels')}>
          <div className={n.ownLabels}>
            {own.map((l) => (
              <span key={l.name} className={n.ownLabel}>
                <LabelMark def={l} label={l.name} />
                {labelTitle(l.name)}
                <IconButton icon="x" label={t('tasks.l.remove', { name: labelTitle(l.name) })} onClick={() => void act(() => api.removeLabel(projectId, l.name), t('tasks.l.removed', { name: labelTitle(l.name) }))} />
              </span>
            ))}
          </div>
        </Field>
      ) : null}
    </FormSheet>
  );
}
