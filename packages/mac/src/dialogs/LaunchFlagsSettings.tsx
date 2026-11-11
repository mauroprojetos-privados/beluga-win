import { useEffect, useState } from 'react';
import { type ArgsRuntime, MAX_AGENT_ARGS, agentArgsProblem } from '@beluga/shared/agent-args.js';
import { joinArgs, splitArgs } from '@beluga/shared/shells.js';
import { cx } from '../components/ui.js';
import { useApi, useApp } from '../lib/beluga.js';
import { Group, Row } from './settings-controls.js';
import s from './settings.module.css';
import ts from './terminal-settings.module.css';
import { say, useT } from '../lib/i18n.js';
import { t } from '@beluga/shared/i18n/index.js';

type Flags = { readonly runtime: ArgsRuntime; readonly field: 'claudeArgs' | 'codexArgs'; readonly label: string; readonly example: string; readonly detail: string };
const FLAGS = (): readonly Flags[] => [
  // i18n-ignore
  { runtime: 'claude', field: 'claudeArgs', label: 'Claude Code', example: '--dangerously-skip-permissions', detail: t('prefs.launchFlags.claudeDetail') },
  // i18n-ignore
  { runtime: 'codex', field: 'codexArgs', label: 'Codex', example: '-c key=value', detail: t('prefs.launchFlags.codexDetail') },
];

/**
 * Settings › Agents › Launch flags: your own flags for `claude` and `codex`, as you'd type them in
 * Terminal. Only your own runs get them, never a friend's; Beluga's rules (secrets, a friend's
 * trust) still come first.
 */
export function LaunchFlagsSettings() {
  useT();
  return (
    <Group title={say('Launch flags')}>
      {FLAGS().map((f) => (
        <FlagsRow key={f.runtime} {...f} />
      ))}
    </Group>
  );
}

function FlagsRow({ runtime, field, label, example, detail }: Flags) {
  const t = useT();
  const api = useApi();
  const saved = useApp((st) => st.prefs[field]);
  const [text, setText] = useState(joinArgs(saved));
  useEffect(() => setText(joinArgs(saved)), [saved]);
  const args = splitArgs(text).slice(0, MAX_AGENT_ARGS);
  const problem = agentArgsProblem(runtime, args);
  const save = (): void => {
    if (!problem && joinArgs(args) !== joinArgs(saved)) void api.session.setPrefs({ [field]: args });
  };
  return (
    <Row label={label} detail={problem ?? t('prefs.launchFlags.ownRuns', { detail })}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <input className={cx(s.text, ts.mono)} aria-label={t('prefs.launchFlags.aria', { label })} aria-invalid={Boolean(problem)} value={text} placeholder={example} spellCheck={false} onChange={(e) => setText(e.target.value)} onBlur={save} />
      </form>
    </Row>
  );
}
