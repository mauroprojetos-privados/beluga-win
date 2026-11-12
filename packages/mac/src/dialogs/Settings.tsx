import { baseName } from '@beluga/shared/os-path.js';
import * as Dialog from '@radix-ui/react-dialog';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { trustOf } from '@beluga/core/trust.js';
import { BRANCH_PREFIX_RE, EFFORTS, type LowPower } from '@beluga/shared/settings-schema.js';
import { agentChoices, agentForChoice, choiceForAgent } from '@beluga/ui/agent-choice.js';
import { EFFORT_INFO, agentEntries, modelInfo, myModel, myRuntime, setMyAgent } from '../chat/ModelPicker.js';
import { HIDEABLE_BUTTONS, TUNNEL_LABELS, TUNNEL_ORDER } from '@beluga/ui/settings-menus.js';
import { Icon } from '../components/Icon.js';
import { Avatar, Button, Dot, cx } from '../components/ui.js';
import { runtimeMark } from '@beluga/shared/agent-marks.js';
import type { RuntimeState } from '@beluga/shared/agent-runtimes.js';
import { CopyCommand, LOCAL_MODELS_ID, useAgents } from '../onboarding/AgentsStep.js';
import { fixLabel } from '../onboarding/agent-setup.js';
import { APP_VERSION, webServed } from '../lib/boot.js';
import { revealInFinder } from '../lib/files.js';
import { type SettingsPane, useApi, useApp, useBeluga, useUi } from '../lib/beluga.js';
import { ACCENTS, type Accent, setPrefs, useChosenPrefs, usePrefs } from '../lib/prefs.js';
import { themeFor } from '../lib/themes.js';
import { useDocTheme } from '../components/markdown/use-doc-theme.js';
import { ThemeGroups } from './ThemePicker.js';
import { foldsForCategories } from '../layout/attention-model.js';
import { EnvironmentSettings } from './EnvironmentSettings.js';
import { ReportProblemRow } from './ReportProblemRow.js';
import { ContextSettings } from './ContextSettings.js';
import { UsageLimitSettings } from './UsageLimitSettings.js';
import { ParallelSettings } from './ParallelSettings.js';
import { AgentThreadsSettings, ThreadLimitsSettings } from './AgentThreadsSettings.js';
import { StackSettings } from './StackSettings.js';
import { EngineLocationSettings } from './EngineLocationSettings.js';
import { ChatLimitSettings } from './ChatLimitSettings.js';
import { McpSettings } from './McpSettings.js';
import { ExternalAgentsSettings } from './ExternalAgentsSettings.js';
import { LaunchFlagsSettings } from './LaunchFlagsSettings.js';
import { CombosSettings } from './CombosSettings.js';
import { BotsSettings } from '../bots/BotsSettings.js';
import { LocalModelsSettings } from './LocalModelsSettings.js';
import { EarningsSettings } from './EarningsSettings.js';
import { NotificationSettings } from './NotificationSettings.js';
import { VoiceSettings } from './VoiceSettings.js';
import { KeyboardSettings } from './KeyboardSettings.js';
import { ExperimentalSettings } from './ExperimentalSettings.js';
import { WebAccessSettings } from './WebAccessSettings.js';
import { Group, Row, Select, Switch } from './settings-controls.js';
import { PANES } from './settings-index.js';
import { SettingsSearchField, SettingsSearchResults, useSettingsSearch } from './SettingsSearch.js';
import { MaintainerChip } from './SupportSheets.js';
import s from './settings.module.css';
import { TerminalSettings } from './TerminalSettings.js';
import { FireSettings } from './FireSettings.js';
import { MenuBarSettings } from './MenuBarSettings.js';
import { NetworkSettings } from '../network/NetworkSettings.js';
import { befriend, openFriendCard } from '../network/use-net.js';
import { PhoneSettings } from '../phone/Phone.js';
import { MachinesSettings } from './MachinesSettings.js';
import { AccessSettings } from '../gateway/AccessSettings.js';
import { UpdateAboutRow, UpdateSettingsGroup } from './UpdateSettings.js';
import { GITHUB_URL, openSupport } from '../lib/support.js';
import { openExternal } from '../lib/system.js';
import { shortcutKeys } from '../lib/shortcuts.js';
import { keyPlatform } from '../lib/shortcuts-model.js';
import { cmdReturn, returnName, revealLabel, yourComputer } from '../lib/os-words.js';
import { LANGUAGE_CHOICES, LOCALE_NAMES, type LanguageChoice, resolveLocale } from '@beluga/shared/i18n/locales.js';
import { systemLanguages, useT } from '../lib/i18n.js';
import { type Key, t } from '@beluga/shared/i18n/index.js';
import { en as SETTINGS_WORDS } from '@beluga/shared/i18n/areas/settings.js';
import { trustWords } from '@beluga/shared/i18n/words.js';

/** One of the Settings area's plain sentences, by its English words. */
type Said = Extract<(typeof SETTINGS_WORDS)[keyof typeof SETTINGS_WORDS], string>;
const KEY_OF = new Map<string, Key>(Object.entries(SETTINGS_WORDS).flatMap(([key, words]) => (typeof words === 'string' ? [[words, key as Key] as const] : [])));
/**
 * A row's label or a group's title, written here in English and said in the app's language
 * (src/shared/i18n/areas/settings.ts). The English stays in this file because Settings search
 * indexes it (settings-index.ts) and tests/mac-settings-search.test.ts reads it from here.
 */
const say = (english: Said): string => t(KEY_OF.get(english) ?? (english as Key));

/** A pane's name in the sidebar and over the pane (settings-index.ts keeps the English the search matches). */
const PANE_KEYS: Partial<Record<SettingsPane, Key>> = {
  general: 'settings.panes.general',
  appearance: 'settings.panes.appearance',
  claude: 'settings.panes.claude',
  notifications: 'settings.panes.notifications',
  workspaces: 'settings.panes.workspaces',
  terminal: 'settings.panes.terminal',
  fire: 'settings.panes.fire',
  environment: 'settings.panes.environment',
  people: 'settings.panes.people',
  phone: 'settings.panes.phone',
  external: 'settings.panes.external',
  computers: 'settings.panes.computers',
  voice: 'settings.panes.voice',
  keyboard: 'settings.panes.keyboard',
  advanced: 'settings.panes.advanced',
  experimental: 'settings.panes.experimental',
  about: 'settings.panes.about' };
const paneName = (p: { id: SettingsPane; label: string }): string => {
  const key = PANE_KEYS[p.id];
  return key ? t(key) : p.label;
};

/** Your profile picture: friends and people in your groups get it once and keep it (net/mesh/avatars.ts). */
function PictureRow() {
  const t = useT();
  const api = useApi();
  const me = useApp((st) => st.network.self);
  const on = useApp((st) => st.network.enabled);
  const fallbackName = useApp((st) => st.self?.name ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const input = useRef<HTMLInputElement>(null);
  const run = (b64: string | null): void => {
    setBusy(true);
    setError(undefined);
    api.network['avatar.set'](b64).then(
      () => setBusy(false),
      (err: unknown) => {
        setBusy(false);
        setError(err instanceof Error ? err.message : String(err));
      },
    );
  };
  const pick = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    try {
      run(await squarePicture(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  const detail = !on ? t('settings.general.pictureOff') : (error ?? t('settings.general.pictureDetail'));
  return (
    <Row label={say('Your picture')} detail={detail}>
      <span className={s.pictureRow}>
        {me ? <Avatar name={me.name || fallbackName} id={me.peerId} size={32} /> : null}
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/heic" hidden onChange={(e) => void pick(e.target.files?.[0]).finally(() => (e.target.value = ''))} />
        <Button size="small" icon="image" disabled={!on || busy} onClick={() => input.current?.click()}>
          {me?.avatar ? t('settings.general.pictureChange') : t('settings.general.pictureChoose')}
        </Button>
        {me?.avatar ? (
          <Button size="small" variant="quiet" disabled={busy} onClick={() => run(null)}>
            {t('settings.general.pictureRemove')}
          </Button>
        ) : null}
      </span>
    </Row>
  );
}

/** A picture cropped to its middle square and shrunk to 256 px, small enough to send (base64). */
async function squarePicture(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error(t('settings.general.pictureUnopenable'));
  });
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = Math.min(256, side);
  const g = canvas.getContext('2d');
  if (!g) throw new Error(t('settings.general.pictureUndrawable'));
  g.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const encode = (type: string, quality: number): Promise<Blob | null> => new Promise((done) => canvas.toBlob(done, type, quality));
  // WebP where the browser writes it (WebKit doesn't: JPEG there), a little rougher until it fits.
  for (const quality of [0.88, 0.78, 0.65, 0.5]) {
    let blob = await encode('image/webp', quality);
    if (blob?.type !== 'image/webp') blob = await encode('image/jpeg', quality);
    if (blob && blob.size <= 90 * 1024) {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let bin = '';
      for (const b of bytes) bin += String.fromCharCode(b);
      return btoa(bin);
    }
  }
  throw new Error(t('settings.general.pictureTooBig'));
}

/** Settings › General › Language (docs/i18n.md): the system's, or one of ours, each named in itself. */
function LanguageRow() {
  const api = useApi();
  const t = useT();
  const choice = useApp((st) => st.prefs.language ?? 'auto');
  const system = LOCALE_NAMES[resolveLocale('auto', systemLanguages())];
  return (
    <Row label={t('language.title')} detail={t('language.hint')}>
      <Select<LanguageChoice>
        label={t('language.title')}
        value={choice}
        onChange={(v) => void api.settings.language(v)}
        options={LANGUAGE_CHOICES.map((c) => ({ value: c, label: c === 'auto' ? t('language.auto', { language: system }) : LOCALE_NAMES[c] }))}
      />
    </Row>
  );
}

function General() {
  const t = useT();
  const api = useApi();
  const state = useApp((st) => st);
  const prefs = usePrefs();
  const [name, setName] = useState(state.self?.name ?? '');
  return (
    <>
      <Group>
        <Row label={say('Your name')} detail={t('settings.general.yourNameDetail')}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void api.session.rename(name);
            }}
          >
            <input id="settings-name" aria-label={say('Your name')} className={s.text} value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name !== state.self?.name && void api.session.rename(name)} />
          </form>
        </Row>
        <PictureRow />
        <LanguageRow />
        <Row label={say("Friends' requests for your agent")} detail={t('settings.general.friendsRequestsDetail')}>
          <Select
            label={t('settings.general.defaultPolicy')}
            value={state.policy}
            onChange={(v) => void api.session.setClaudeSharing(v)}
            options={[
              { value: 'ask', label: t('settings.general.policyAsk') },
              { value: 'auto', label: t('settings.general.policyAuto') },
              { value: 'deny', label: t('settings.general.policyDeny') },
            ]}
          />
        </Row>
      </Group>
      {/* A browser runs the build its server serves: the server's Beluga updates, not the page. */}
      {webServed() ? null : <UpdateSettingsGroup />}
      <Group title={say('Writing')}>
        <Row label={say('Send with')} detail={prefs.sendWith === 'enter' ? t('settings.general.sendWithEnter') : t('settings.general.sendWithCmd')}>
          <Select
            label={say('Send with')}
            value={prefs.sendWith}
            onChange={(v) => setPrefs({ sendWith: v })}
            options={[
              { value: 'enter', label: returnName() },
              { value: 'cmd-enter', label: cmdReturn(' ') },
            ]}
          />
        </Row>
        <Row label={say('Send during a turn')} detail={t('settings.general.sendDuringTurnDetail')}>
          <Select
            label={say('Send during a turn')}
            value={prefs.sendDuringTurn}
            onChange={(v) => setPrefs({ sendDuringTurn: v })}
            options={[
              { value: 'queue', label: t('settings.general.queue') },
              { value: 'steer', label: t('settings.general.steer') },
            ]}
          />
        </Row>
        <Row label={say('Show times next to messages')}>
          <Switch label={t('settings.general.timesSwitch')} on={prefs.timestamps} onChange={(v) => setPrefs({ timestamps: v })} />
        </Row>
        <Row label={say("The agent's steps once it answers")} detail={t('settings.general.stepsDetail')}>
          <Select
            label={t('settings.general.stepsSelect')}
            value={prefs.doneSteps}
            onChange={(v) => setPrefs({ doneSteps: v })}
            options={[
              { value: 'fold', label: t('settings.general.stepsFold') },
              { value: 'show', label: t('settings.general.stepsShow') },
            ]}
          />
        </Row>
      </Group>
      <EarningsSettings />
    </>
  );
}

const lowPowerOptions = (): ReadonlyArray<{ value: LowPower; label: string }> => [
  { value: 'off', label: t('common.off') },
  { value: 'battery', label: t('settings.appearance.lowPowerBattery') },
  { value: 'always', label: t('settings.appearance.lowPowerAlways') },
];

const IDLE_DAYS: readonly number[] = [0, 1, 3, 7, 14, 30];
const idleWords = (days: number): string => (days === 0 ? t('settings.appearance.idleNever') : t('settings.appearance.idleAfter', { count: days }));

function Appearance() {
  const t = useT();
  const prefs = useChosenPrefs();
  const api = useApi();
  const lowPower = useApp((st) => st.prefs.lowPower ?? 'off');
  const saving = useApp((st) => st.powerSaving);
  const savingNote = saving ? t('settings.appearance.savingNote') : undefined;
  const theme = themeFor(useDocTheme(), prefs);
  const themeAccent = theme.accent !== undefined;
  const daemonPrefs = useApp((st) => st.prefs);
  const idleChoices = [...new Set([...IDLE_DAYS, daemonPrefs.settleIdleDays])].sort((x, y) => x - y);
  // Your folds come back when it's off.
  const turnCategories = (on: boolean): void => {
    setPrefs(foldsForCategories(on, prefs));
    void api.session.setPrefs({ chatCategories: on });
  };
  return (
    <>
      <Group>
        <Row label={say('Appearance')} {...(prefs.appearance === 'system' ? { detail: t('settings.appearance.appearanceDetail', { computer: yourComputer() }) } : {})}>
          <Select
            label={say('Appearance')}
            value={prefs.appearance}
            onChange={(v) => setPrefs({ appearance: v })}
            options={[
              { value: 'system', label: t('settings.appearance.system') },
              { value: 'light', label: t('settings.appearance.light') },
              { value: 'dark', label: t('settings.appearance.dark') },
            ]}
          />
        </Row>
        <Row label={say('Accent')} detail={themeAccent ? t('settings.appearance.accentDetailTheme', { computer: yourComputer(), theme: theme.name }) : t('settings.appearance.accentDetail', { computer: yourComputer() })}>
          <div className={s.swatches}>
            {(Object.keys(ACCENTS) as Accent[]).filter((a) => a !== 'theme' || themeAccent || prefs.accent === 'theme').map((a) => (
              <button key={a} type="button" aria-label={a === 'theme' ? t('settings.appearance.themeOwn', { theme: theme.name }) : a} {...(a === 'theme' ? { title: t('settings.appearance.themeOwn', { theme: theme.name }) } : {})} aria-pressed={prefs.accent === a} className={cx(s.swatch, prefs.accent === a && s.swatchOn)} style={{ background: a === 'system' ? 'conic-gradient(#3b82f6, #8b5cf6, #e11d48, #d97706, #059669, #3b82f6)' : ACCENTS[a] }} onClick={() => setPrefs({ accent: a })} />
            ))}
          </div>
        </Row>
      </Group>
      <ThemeGroups />
      <Group title={say('Low Power')}>
        <Row label={say('Low Power mode')} detail={saving ? t('settings.appearance.lowPowerDetailSaving') : t('settings.appearance.lowPowerDetail')}>
          <Select label={say('Low Power mode')} value={lowPower} onChange={(v) => void api.session.setPrefs({ lowPower: v })} options={lowPowerOptions().map((o) => ({ ...o }))} />
        </Row>
      </Group>
      <Group title={say('Layout')}>
        <Row label={say('Text size')} detail={t('settings.appearance.textSizeDetail', { size: prefs.textSize, keys: [shortcutKeys('zoom-in'), shortcutKeys('zoom-out')].filter(Boolean).join(` ${t('common.and')} `) || t('settings.appearance.textSizeMenu') })}>
          <input className={s.slider} type="range" min={11} max={17} step={1} value={prefs.textSize} onChange={(e) => setPrefs({ textSize: Number(e.target.value) })} />
        </Row>
        <Row label={say('Density')}>
          <Select
            label={say('Density')}
            value={prefs.density}
            onChange={(v) => setPrefs({ density: v })}
            options={[
              { value: 'comfortable', label: t('settings.appearance.comfortable') },
              { value: 'compact', label: t('settings.appearance.compact') },
            ]}
          />
        </Row>
        <Row label={say('Conversation width')}>
          <Select
            label={t('settings.appearance.width')}
            value={prefs.chatWidth}
            onChange={(v) => setPrefs({ chatWidth: v, chatWidthPicked: true })}
            options={[
              { value: 'narrow', label: t('settings.appearance.narrow') },
              { value: 'wide', label: t('settings.appearance.wide') },
              { value: 'full', label: t('settings.appearance.fullWindow') },
            ]}
          />
        </Row>
        <Row label={say('Sidebar categories')} detail={t('settings.appearance.categoriesDetail')}>
          <Switch label={say('Sidebar categories')} on={daemonPrefs.chatCategories} onChange={turnCategories} />
        </Row>
        {daemonPrefs.chatCategories ? (
          <>
            <Row label={say('Settle when a pull request merges')} detail={t('settings.appearance.settleOnMergeDetail')}>
              <Switch label={say('Settle when a pull request merges')} on={daemonPrefs.settleOnMerge} onChange={(v) => void api.session.setPrefs({ settleOnMerge: v })} />
            </Row>
            <Row label={say('Settle idle chats')} detail={t('settings.appearance.settleIdleDetail')}>
              <Select label={say('Settle idle chats')} value={String(daemonPrefs.settleIdleDays)} onChange={(v) => void api.session.setPrefs({ settleIdleDays: Number(v) })} options={idleChoices.map((d) => ({ value: String(d), label: idleWords(d) }))} />
            </Row>
          </>
        ) : (
          <Row label={say('Unread in the sidebar')} detail={t('settings.appearance.unreadDetail')}>
            <Switch label={say('Unread in the sidebar')} on={prefs.unreadSection} onChange={(v) => setPrefs({ unreadSection: v })} />
          </Row>
        )}
        <Row label={say('Sidebar width')}>
          <input className={s.slider} type="range" min={200} max={360} step={4} value={prefs.sidebarWidth} onChange={(e) => setPrefs({ sidebarWidth: Number(e.target.value) })} />
        </Row>
        <Row label={say('Reduce motion')} {...(savingNote ? { detail: savingNote } : {})}>
          <Switch label={say('Reduce motion')} on={prefs.reduceMotion} onChange={(v) => setPrefs({ reduceMotion: v })} />
        </Row>
        {keyPlatform() === 'mac' && !webServed() && (
          <Row label={say('Reduce transparency')} detail={savingNote ?? t('settings.appearance.reduceTransparencyDetail')}>
            <Switch label={say('Reduce transparency')} on={prefs.reduceTransparency} onChange={(v) => setPrefs({ reduceTransparency: v })} />
          </Row>
        )}
      </Group>
    </>
  );
}

const TONE: Record<RuntimeState, 'ok' | 'warn' | 'muted'> = { ready: 'ok', signed_out: 'warn', missing: 'muted', no_endpoint: 'muted' };

/**
 * Your agents (BLG-507): each one Beluga can run with where it stands on this Mac, and its one fix
 * (Sign In, Get Codex, Set Up…); Check Again asks them all now. The same rows as onboarding's.
 */
function AgentsGroup({ mine }: { mine: string }) {
  const t = useT();
  const { rows, checking, check, act } = useAgents();
  return (
    <Group title={say('Your agents')}>
      {rows.map((row) => (
        <div key={row.id} className={s.row} data-testid={`settings-agent-${row.id}`}>
          <Icon name={runtimeMark(row.id)} size={18} />
          <div className={s.rowText}>
            <div className={s.rowLabel}>
              {row.label}
              {row.id === mine && row.state === 'ready' ? <span className={s.agentYours}> · {t('settings.agent.yours')}</span> : null}
            </div>
            <div className={s.rowDetail}>
              {row.detail}
              {row.fix === 'install' ? (
                <>
                  {' '}
                  <CopyCommand className={s.agentCommand} runtime={row.id} />
                </>
              ) : null}
            </div>
          </div>
          <div className={s.control}>
            <Dot tone={row.state ? TONE[row.state] : 'muted'} />
            {row.words}
            {row.fix ? (
              <Button size="small" onClick={() => act(row)}>
                {fixLabel(row)}
              </Button>
            ) : null}
          </div>
        </div>
      ))}
      <Row label={say('Signed in or installed one just now?')} detail={t('settings.agent.checkAgainDetail')}>
        <Button variant="quiet" icon="refresh" disabled={checking} onClick={() => void check()}>
          {checking ? t('settings.agent.checking') : t('settings.agent.checkAgain')}
        </Button>
      </Row>
    </Group>
  );
}

/**
 * Your agent (BLG-497): one pick of runtime and model, for every conversation that picked none of
 * its own and for @you; then how hard it thinks (only the levels its model takes) and the rest.
 */
function AgentPane() {
  const t = useT();
  const api = useApi();
  const macPrefs = usePrefs();
  const { ui } = useBeluga();
  const state = useApp((st) => st);
  const p = state.prefs;
  const runtime = myRuntime(p);
  const model = myModel(p);
  const choices = agentChoices(state.runtimes, state.models);
  // A model its runtime doesn't list (yet) takes every level.
  const efforts = new Set<string>(modelInfo(state, runtime, model)?.efforts ?? EFFORTS);
  const effortOptions = EFFORTS.filter((e) => efforts.has(e) || e === p.effort);
  return (
    <>
      <Group>
        <Row label={say('Your agent')} detail={t('settings.agent.yourAgentDetail')}>
          <Select
            label={say('Your agent')}
            value={choiceForAgent({ runtime, label: '', ...(model ? { model } : {}) })}
            onChange={(v) => {
              const ref = agentForChoice(v, state.runtimes);
              setMyAgent(api, ref.runtime, ref.label, ref.model ?? '');
            }}
            options={agentEntries(choices)}
            placeholder={choices.find((c) => c.runtime === runtime)?.group ?? runtime}
          />
        </Row>
        <Row label={say('Thinking effort')} detail={efforts.size < EFFORTS.length ? t('settings.agent.effortDetail') : undefined}>
          <Select label={t('settings.agent.effort')} value={p.effort ?? ''} onChange={(v) => void api.session.setPrefs({ effort: (v || null) as (typeof EFFORTS)[number] | null })} options={[{ value: '', label: t('settings.agent.effortAuto'), description: t('settings.agent.effortAutoDetail') }, ...effortOptions.map((e) => ({ value: e, label: EFFORT_INFO[e].label, description: EFFORT_INFO[e].detail, ...(efforts.has(e) ? {} : { disabled: true }) }))]} />
        </Row>
        <Row label={say('Ask before running commands')} detail={t('settings.agent.askBeforeDetail')}>
          <Switch label={t('settings.agent.selfApproval')} on={p.selfApproval === 'ask'} onChange={(v) => void api.session.setPrefs({ selfApproval: v ? 'ask' : 'never' })} />
        </Row>
      </Group>
      <AgentsGroup mine={runtime} />
      <CombosSettings />
      <LaunchFlagsSettings />
      <McpSettings />
      <div id={LOCAL_MODELS_ID}>
        <LocalModelsSettings />
      </div>
      <Group title={say('In the chat')}>
        <Row label={say('Sub-agents')}>
          <Select
            label={say('Sub-agents')}
            value={p.subagents}
            onChange={(v) => void api.session.setPrefs({ subagents: v })}
            options={[
              { value: 'full', label: t('settings.agent.subagentsFull') },
              { value: 'compact', label: t('settings.agent.subagentsCompact') },
              { value: 'hidden', label: t('settings.agent.subagentsHidden') },
            ]}
          />
        </Row>
      </Group>
      <ContextSettings />
      <UsageLimitSettings />
      <ParallelSettings />
      <ChatLimitSettings />
      {p.agentThreads ? <ThreadLimitsSettings /> : null}
      <Group title={say('Scratch folder')}>
        <Row label={say('Give your agent a scratch folder')} detail={t('settings.agent.scratchGiveDetail')}>
          <Switch label={say('Scratch folder')} on={p.scratchFolder} onChange={(v) => void api.session.setPrefs({ scratchFolder: v })} />
        </Row>
        <Row label={say('Show the Scratch tab')} detail={shortcutKeys('panel-scratch') ? t('settings.agent.scratchTabDetailKeys', { keys: shortcutKeys('panel-scratch') ?? '' }) : t('settings.agent.scratchTabDetail')}>
          <Switch label={t('settings.agent.scratchTabSwitch')} on={macPrefs.scratchTab} onChange={(v) => setPrefs({ scratchTab: v })} />
        </Row>
      </Group>
      <Group title={say('Pull requests and templates')}>
        <Row label={say('Pull request instructions')} detail={state.prCustom ? t('settings.agent.prCustomized') : t('settings.agent.prBuiltIn')}>
          <Button onClick={() => void api.workbench.editPrPrompt()}>{t('settings.agent.edit')}</Button>
          {state.prCustom ? (
            <Button variant="quiet" onClick={() => void api.workbench.resetPrPrompt()}>
              {t('settings.agent.reset')}
            </Button>
          ) : null}
        </Row>
        <Row label={say('Templates')} detail={t('settings.agent.templatesDetail', { count: state.templates.length })}>
          <Button onClick={() => ui.patch({ settings: undefined, menu: { menu: { kind: 'templates', manage: true }, selected: 0 } })}>{t('settings.agent.manage')}</Button>
        </Row>
      </Group>
    </>
  );
}

/** Projects you hid from the sidebar, each with Show (it comes back where it was). */
function HiddenProjectsGroup() {
  const t = useT();
  const api = useApi();
  const hidden = useApp((st) => st.hiddenProjects);
  return (
    <Group title={say('Hidden projects')}>
      {hidden.length ? (
        hidden.map((root) => (
          <Row key={root} label={baseName(root) || root} detail={root}>
            <Button onClick={() => void api.workspaces.showProject(root)} aria-label={t('settings.workspaces.showAria', { name: baseName(root) || root })}>
              {t('settings.workspaces.show')}
            </Button>
          </Row>
        ))
      ) : (
        <Row label={say('None')} detail={t('settings.workspaces.noneDetail')}>
          {null}
        </Row>
      )}
    </Group>
  );
}

/** What new worktrees' branches start with: saved when you leave the field, if git would take it. */
function BranchPrefixRow() {
  const t = useT();
  const api = useApi();
  const saved = useApp((st) => st.prefs.branchPrefix);
  const [value, setValue] = useState(saved);
  useEffect(() => setValue(saved), [saved]);
  const ok = BRANCH_PREFIX_RE.test(value);
  const save = (): void => {
    if (ok && value !== saved) void api.session.setPrefs({ branchPrefix: value });
  };
  return (
    <Row label={say('Branch prefix')} detail={ok ? t('settings.workspaces.branchPrefixDetail', { prefix: value }) : t('settings.workspaces.branchPrefixBad')}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <input aria-label={say('Branch prefix')} className={s.text} value={value} placeholder={t('settings.workspaces.branchPrefixNone')} spellCheck={false} onChange={(e) => setValue(e.target.value.trim())} onBlur={save} />
      </form>
    </Row>
  );
}

function Workspaces() {
  const t = useT();
  const api = useApi();
  const p = useApp((st) => st.prefs);
  return (
    <>
      <Group>
        <Row label={say('Run setup in new worktrees')} detail={t('settings.workspaces.runSetupDetail')}>
          <Switch label={t('settings.workspaces.autoSetup')} on={p.autoSetup} onChange={(v) => void api.session.setPrefs({ autoSetup: v })} />
        </Row>
        <BranchPrefixRow />
        <Row label={say('Keep open pull requests current')} detail={t('settings.workspaces.keepPrsDetail')}>
          <Switch label={say('Keep open pull requests current')} on={p.pushToPr} onChange={(v) => void api.session.setPrefs({ pushToPr: v })} />
        </Row>
        <Row label={say('Friends may start work here')} detail={t('settings.workspaces.friendsStartDetail')}>
          <Switch label={t('settings.workspaces.friendWorktrees')} on={p.friendWorktrees === 'ask'} onChange={(v) => void api.session.setFriendWorktrees(v ? 'ask' : 'off')} />
        </Row>
      </Group>
      <HiddenProjectsGroup />
      <Group title={say('Toolbar buttons')}>
        {HIDEABLE_BUTTONS.map(([id, label]) => (
          <Row key={id} label={label}>
            <Switch label={label} on={!p.hiddenButtons.includes(id)} onChange={(v) => void api.session.setPrefs({ hiddenButtons: v ? p.hiddenButtons.filter((b) => b !== id) : [...p.hiddenButtons, id] })} />
          </Row>
        ))}
      </Group>
    </>
  );
}

function People() {
  const t = useT();
  const api = useApi();
  const { client, ui } = useBeluga();
  const state = useApp((st) => st);
  const others = state.peers.filter((p) => p.peerId !== state.selfId);
  const remembered = Object.entries(state.remembered).filter(([id]) => !others.some((p) => p.peerId === id));
  return (
    <>
      <NetworkSettings />
      <AccessSettings />
      {/* Trust is shown here and set on each friend's card (BLG-202). */}
      <Group title={say('In the room')}>
        {others.length ? (
          others.map((p) => {
            const friend = state.network.friends.some((f) => f.peerId === p.peerId);
            return (
              <Row key={p.peerId} label={p.name} detail={t(friend ? 'settings.people.trustFriend' : 'settings.people.trustOther', { trust: trustWords(trustOf(state, p.peerId)).label })}>
                <Avatar name={p.name} id={p.peerId} size={20} />
                {friend ? (
                  <Button
                    variant="quiet"
                    onClick={() => {
                      ui.patch({ settings: undefined });
                      openFriendCard(client, p.peerId);
                    }}
                  >
                    {t('settings.people.theirCard')}
                  </Button>
                ) : p.guest || state.guests[p.peerId] ? null : (
                  <Button variant="quiet" onClick={() => void befriend(client, p.peerId, p.name)}>
                    {t('settings.people.addFriend')}
                  </Button>
                )}
              </Row>
            );
          })
        ) : (
          <div className={s.note}>{t('settings.people.nobody')}</div>
        )}
      </Group>
      {remembered.length ? (
        <Group title={say('Remembered from before')}>
          {remembered.map(([id, r]) => (
            <Row key={id} label={r.name} detail={trustWords(r.trust).label}>
              <Button variant="quiet" onClick={() => void api.people.forget(id)}>
                {t('settings.people.forget')}
              </Button>
            </Row>
          ))}
        </Group>
      ) : null}
      <Group title={say('Remote access')}>
        <Row label={say('How friends reach you')} detail={t('settings.people.reachDetail')}>
          <Select label={t('settings.people.tunnel')} value={state.prefs.tunnel} onChange={(v) => void api.session.setPrefs({ tunnel: v })} options={TUNNEL_ORDER.map((tunnel) => ({ value: tunnel, label: TUNNEL_LABELS[tunnel] }))} />
        </Row>
        {state.isHost ? (
          <Row label={say('Take new people')} detail={state.roomOpen ? t('settings.people.roomOpenDetail') : t('settings.people.roomClosedDetail')}>
            <Switch label={t('settings.people.roomOpen')} on={state.roomOpen} onChange={(v) => void api.session.setRoomOpen(v)} />
          </Row>
        ) : null}
        <Row label={say('Invite link')}>
          <Button onClick={() => void api.session.copyInvite()}>{t('settings.people.copy')}</Button>
          {state.isHost ? (
            <Button variant="quiet" onClick={() => void api.session.newInviteLink()}>
              {t('settings.people.newLink')}
            </Button>
          ) : null}
        </Row>
      </Group>
    </>
  );
}

function About() {
  const t = useT();
  const { client, ui } = useBeluga();
  const home = useApp((st) => st.home);
  const logPath = `${home}/.beluga/logs/daemon.log`;
  return (
    <>
      <Group>
        <Row label={say('The Beluga app')}>{APP_VERSION}</Row>
        {webServed() ? null : <UpdateAboutRow />}
        <Row label={say('Beluga (the part that runs your room)')}>{client.daemonVersion}</Row>
        <Row label={say('Windows attached')} detail={t('settings.about.windowsDetail')}>
          {client.clients}
        </Row>
        {/* i18n-ignore */}
        <Row label={say('Log')} detail="~/.beluga/logs/daemon.log">
          <Button size="small" onClick={() => void client.api.local.openFolder(logPath)}>
            {t('settings.about.openConsole')}
          </Button>
          <Button size="small" variant="quiet" onClick={() => void revealInFinder(client, logPath)}>
            {revealLabel()}
          </Button>
        </Row>
        <ReportProblemRow />
      </Group>
      <Group title={say('Support Beluga')}>
        <Row label={say('Beluga is free, and a passion project')} detail={
            <>
              {t('settings.about.builtBy')} <MaintainerChip />
              {t('settings.about.builtByAfter')}
            </>
          }>
          <Button size="small" icon="star" onClick={() => void openExternal(GITHUB_URL)}>
            {t('settings.about.star')}
          </Button>
          <Button
            size="small"
            icon="cup"
            onClick={() => {
              // The sheet opens where Settings was (Settings sits above sheets).
              ui.patch({ settings: undefined });
              openSupport('coffee');
            }}
          >
            {t('settings.about.coffee')}
          </Button>
        </Row>
      </Group>
    </>
  );
}

const BODY: Record<SettingsPane, () => ReactNode> = {
  general: General,
  appearance: Appearance,
  claude: AgentPane,
  bots: BotsSettings,
  notifications: NotificationSettings,
  workspaces: Workspaces,
  terminal: TerminalSettings,
  fire: FireSettings,
  menubar: MenuBarSettings,
  environment: EnvironmentSettings,
  people: People,
  phone: PhoneSettings,
  external: ExternalAgentsSettings,
  computers: MachinesSettings,
  voice: VoiceSettings,
  keyboard: KeyboardSettings,
  stack: StackSettings,
  advanced: Advanced,
  experimental: ExperimentalSettings,
  about: About,
};

function Advanced() {
  return (
    <>
      <EngineLocationSettings />
      <WebAccessSettings />
      <AgentThreadsSettings />
    </>
  );
}

/** The app's own panes a browser has no use for (it has no menu bar icon). */
const APP_ONLY: ReadonlySet<SettingsPane> = new Set(['menubar']);

/** Beluga's settings: this window's look on the left panes, Beluga's shared settings on the rest. */
export function Settings() {
  const pane = useUi((u) => u.settings);
  return pane ? <SettingsWindow pane={pane} /> : null;
}

/**
 * The window, with the search above the panes (BLG-740): opened, the field has focus; ⌘F comes
 * back to it, Esc clears it, and a second Esc closes the window.
 */
function SettingsWindow({ pane }: { pane: SettingsPane }) {
  const t = useT();
  const { ui } = useBeluga();
  const panes = useMemo(() => (webServed() ? PANES.filter((p) => !APP_ONLY.has(p.id)) : PANES), []);
  const scroll = useRef<HTMLDivElement>(null);
  const search = useSettingsSearch(panes, pane, (id) => ui.patch({ settings: id }), scroll);
  const Body = BODY[pane];
  // Opened from the welcome (Set Up… on Your agents): over it, not hidden behind it.
  const overWelcome = document.querySelector('[data-welcome]') ? '' : undefined;
  return (
    <Dialog.Root open onOpenChange={(v) => (v ? undefined : ui.patch({ settings: undefined }))}>
      <Dialog.Portal>
        <Dialog.Overlay className={s.overlay} data-over-welcome={overWelcome} />
        <Dialog.Content
          className={s.window}
          data-over-welcome={overWelcome}
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            search.field.current?.focus();
          }}
          onEscapeKeyDown={(e) => {
            if (!search.query) return;
            e.preventDefault();
            search.clear();
          }}
        >
          <nav className={s.nav}>
            <Dialog.Title className={s.title}>{t('common.settings')}</Dialog.Title>
            <SettingsSearchField search={search} />
            {panes.map((p) => (
              <button
                key={p.id}
                type="button"
                className={cx(s.navItem, p.id === pane && !search.showing && s.navOn, search.showing && !search.matched.has(p.id) && s.navDim)}
                onClick={() => {
                  ui.patch({ settings: p.id });
                  search.browse();
                }}
              >
                <Icon name={p.icon} size={14} />
                {paneName(p)}
              </button>
            ))}
          </nav>
          <div className={s.body}>
            <div className={s.bodyHead}>
              <h2 className={s.paneTitle}>{search.showing ? t('common.search') : paneName(PANES.find((p) => p.id === pane) ?? { id: pane, label: '' })}</h2>
              <Dialog.Close className={s.close} aria-label={t('common.close')}>
                <Icon name="x" size={12} />
              </Dialog.Close>
            </div>
            <div ref={scroll} className={s.scroll}>
              {search.showing ? <SettingsSearchResults search={search} panes={panes} /> : <Body />}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
