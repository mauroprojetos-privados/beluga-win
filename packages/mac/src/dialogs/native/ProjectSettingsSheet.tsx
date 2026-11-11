import { useEffect, useState } from 'react';
import type { ResolvedScripts } from '@beluga/workspaces/scripts.js';
import { agentMark } from '@beluga/shared/agent-marks.js';
import { agentChoices, agentForChoice, choiceForAgent } from '@beluga/ui/agent-choice.js';
import { agentEntries } from '../../chat/ModelPicker.js';
import { Checkbox, Field, FormSheet, Popup, SourceTag, TextInput } from '../../components/FormSheet.js';
import { agentName, useMyAgent } from '../../lib/agent-words.js';
import { useApi, useApp } from '../../lib/beluga.js';
import { LOCALES, LOCALE_NAMES, type Locale } from '@beluga/shared/i18n/locales.js';
import { useT } from '../../lib/i18n.js';
import type { NativeMenuProps } from './index.js';
import { t as say } from '@beluga/shared/i18n/index.js';

type Kind = 'setup' | 'run';
type Source = NonNullable<ResolvedScripts['setup']>['source'];

const SOURCE = (): Record<Source, { label: string; tone: 'team' | 'mine' | 'guess'; detail: string }> => ({
  yours: { label: say('native.project.sourceYours'), tone: 'mine', detail: say('native.project.sourceYoursDetail') },
  claude: { label: say('native.project.sourceAgent'), tone: 'guess', detail: say('native.project.sourceAgentDetail') },
  'beluga.json': { label: 'beluga.json', tone: 'team', detail: say('native.project.sourceShared') }, // i18n-ignore
  'klaud.json': { label: 'klaud.json', tone: 'team', detail: say('native.project.sourceShared') }, // i18n-ignore
  'conductor.json': { label: 'conductor.json', tone: 'team', detail: say('native.project.sourceSetupFile') }, // i18n-ignore
  detected: { label: say('native.project.sourceGuessed'), tone: 'guess', detail: say('native.project.sourceGuessedDetail') },
});

/**
 * A project's Setup and Run commands, as a form: where each one comes from now, and whether to
 * keep yours to yourself or save them in the project's beluga.json for the whole team.
 */
export function ProjectSettingsSheet({ menu, close }: NativeMenuProps<'scripts'>) {
  const api = useApi();
  const project = useApp((st) => st.projects.find((p) => p.id === menu.projectId));
  const autoSetup = useApp((st) => st.prefs.autoSetup);
  const projectAgents = useApp((st) => st.prefs.projectAgents);
  const models = useApp((st) => st.models);
  const runtimes = useApp((st) => st.runtimes);
  const mine = useMyAgent();
  const t = useT();
  const commitLanguages = useApp((st) => st.prefs.commitLanguages);
  const scripts = project?.scripts ?? {};
  const [values, setValues] = useState<Record<Kind, string>>({ setup: scripts.setup?.command ?? '', run: scripts.run?.command ?? '' });
  const [team, setTeam] = useState(false);
  const [auto, setAuto] = useState(autoSetup);
  const [touched, setTouched] = useState(false);
  // '~': the same agent as yours (Settings); anything else is this project's own.
  const agentNow = project && projectAgents?.[project.name] ? choiceForAgent(projectAgents[project.name]) : '~';
  const [agent, setAgent] = useState(agentNow);
  // What its commits and PRs are written in (docs/i18n.md): English unless you pick another.
  const commitsNow: Locale = (project && commitLanguages?.[project.name]) || 'en';
  const [commits, setCommits] = useState<Locale>(commitsNow);
  // Until you type, the fields follow what's saved (it can arrive just after the sheet opens).
  const setupNow = scripts.setup?.command ?? '';
  const runNow = scripts.run?.command ?? '';
  useEffect(() => {
    if (!touched) setValues({ setup: setupNow, run: runNow });
  }, [setupNow, runNow]);
  if (!project) return null;

  const saved = (kind: Kind): string => scripts[kind]?.command ?? '';
  const edited = (kind: Kind): boolean => values[kind].trim() !== saved(kind);
  const tag = (kind: Kind) => {
    const s = scripts[kind];
    if (edited(kind)) return <SourceTag tone={team ? 'team' : 'mine'}>{team ? t('native.project.willGoInBeluga') : t('native.project.willBeYours')}</SourceTag>;
    const source = s ? SOURCE()[s.source] : undefined;
    return source ? (
      <span title={source.detail}>
        <SourceTag tone={source.tone}>{source.label}</SourceTag>
      </span>
    ) : (
      <SourceTag tone="guess">{t('native.project.none')}</SourceTag>
    );
  };
  // Guessed values say so (once), so you check them.
  const hint = (kind: Kind, what: string) => (!edited(kind) && scripts[kind]?.source === 'detected' ? t('native.project.guessedHint', { what }) : !edited(kind) && scripts[kind]?.source === 'claude' ? t('native.project.agentHint', { what }) : what);
  const changed = edited('setup') || edited('run') || team || auto !== autoSetup || agent !== agentNow || commits !== commitsNow;

  const save = (): void => {
    for (const kind of ['setup', 'run'] as const) {
      const value = values[kind].trim();
      // Saving for the team writes both commands into beluga.json, or the older klaud.json it has (and drops your own ones).
      if (team && (value || scripts[kind])) void api.workbench.setScript(project.id, kind, value, true);
      else if (!team && edited(kind)) void api.workbench.setScript(project.id, kind, value);
    }
    if (auto !== autoSetup) void api.session.setPrefs({ autoSetup: auto });
    if (agent !== agentNow) {
      const { [project.name]: _, ...others } = projectAgents ?? {};
      void api.session.setPrefs({ projectAgents: agent === '~' ? others : { ...others, [project.name]: agentForChoice(agent, runtimes) } });
    }
    if (commits !== commitsNow) void api.settings.commitLanguage(project.name, commits);
    close();
  };

  return (
    <FormSheet
      title={t('native.project.title', { name: project.name })}
      icon="terminal"
      intro={t('native.project.intro')}
      submitLabel={t('common.save')}
      canSubmit={changed}
      onSubmit={save}
      onCancel={close}
      width={560}
      footer={<Checkbox checked={team} onChange={setTeam} label={t('native.project.saveToBeluga')} detail={t('native.project.saveToBelugaDetail')} />}
    >
      <Field label={t('native.project.setup')} htmlFor="script-setup" hint={hint('setup', t('native.project.setupHint'))} aside={tag('setup')}>
        {/* i18n-ignore: a command */}
        <TextInput id="script-setup" value={values.setup} onChange={(v) => (setTouched(true), setValues({ ...values, setup: v }))} mono placeholder="npm install" />
      </Field>
      <Field label={t('native.project.run')} htmlFor="script-run" hint={hint('run', t('native.project.runHint'))} aside={tag('run')}>
        {/* i18n-ignore: a command */}
        <TextInput id="script-run" value={values.run} onChange={(v) => (setTouched(true), setValues({ ...values, run: v }))} mono placeholder="npm run dev" />
      </Field>
      <Field label={t('native.project.agent')} htmlFor="project-agent" hint={t('native.project.agentFieldHint')}>
        <Popup id="project-agent" value={agent} onChange={setAgent} options={[{ value: '~', label: t('native.project.sameAsYours', { agent: agentName(mine) }), icon: agentMark(mine) }, ...agentEntries(agentChoices(runtimes, models))]} />
      </Field>
      <Field label={t('language.commits')} htmlFor="project-commit-language" hint={t('language.commitsHint')}>
        <Popup id="project-commit-language" value={commits} onChange={(v) => setCommits(v as Locale)} options={LOCALES.map((l) => ({ value: l, label: LOCALE_NAMES[l] }))} />
      </Field>
      <Field label="">
        <Checkbox checked={auto} onChange={setAuto} label={t('native.project.autoSetup')} detail={t('native.project.autoSetupDetail')} />
      </Field>
    </FormSheet>
  );
}
