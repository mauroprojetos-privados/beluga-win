import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useClock } from '../lib/window-active.js';
import { REMOTE_FULL_WARNING } from '@beluga/shared/remote-full.js';
import { Button } from '../components/ui.js';
import { useApi, useApp } from '../lib/beluga.js';
import { copyText } from '../lib/copy.js';
import { Group, Row, Select, Switch } from './settings-controls.js';
import s from './settings.module.css';
import { say, useT } from '../lib/i18n.js';
import { t } from '@beluga/shared/i18n/index.js';
import { formatDateWith } from '@beluga/shared/i18n/format.js';

/** In a grant's projects: all your chats with no project. */
const STANDALONE_CHATS = 'chats';

type Level = 'ask' | 'trusted' | 'full';
type ActivityShown = 'all' | 'allowed' | 'asked' | 'refused';

interface Activity {
  readonly ts: number;
  readonly agent: string;
  readonly tool: string;
  readonly target: string;
  readonly decidedBy: 'rule' | 'person';
  readonly argsHash: string;
  readonly kind: Exclude<ActivityShown, 'all'>;
}

const ACTIVITY_SHOWN = (): ReadonlyArray<{ value: ActivityShown; label: string }> => [
  { value: 'all', label: t('prefs.external.all') },
  { value: 'allowed', label: t('prefs.external.allowed') },
  { value: 'asked', label: t('prefs.external.asked') },
  { value: 'refused', label: t('prefs.external.refused') },
];
const KIND_WORDS = (): Readonly<Record<Activity['kind'], string>> => ({ allowed: t('prefs.external.allowed'), asked: t('prefs.external.asked'), refused: t('prefs.external.refused') });

type RouteKind = 'tailscale' | 'public';

interface Route {
  readonly kind: RouteKind;
  readonly state: 'opening' | 'on' | 'reopening';
  readonly url?: string;
  readonly error?: string;
}

interface Status {
  readonly on: boolean;
  readonly paused?: boolean;
  readonly url?: string;
  readonly routes?: readonly Route[];
  readonly error?: string;
}

interface Agent {
  readonly id: string;
  readonly name: string;
  readonly level: string;
  readonly route: 'local' | 'remote';
  readonly lastSeen: number;
  readonly expiresAt: number;
  readonly suspendedAt?: number;
}

const LEVELS = (): ReadonlyArray<{ value: Level; label: string }> => [
  { value: 'ask', label: t('prefs.external.levelAsk') },
  { value: 'trusted', label: t('prefs.external.levelTrusted') },
  { value: 'full', label: t('prefs.external.levelFull') },
];
const LEVEL_WORDS = (): Readonly<Record<string, string>> => ({ blocked: t('prefs.external.levelBlocked'), ask: t('prefs.external.levelAsk'), trusted: t('prefs.external.levelTrusted'), full: t('prefs.external.levelFull') });
const REFRESH_MS = 5000;
const ROUTE_ROWS = (): ReadonlyArray<{ kind: RouteKind; label: string; off: string; on: string }> => [
  { kind: 'tailscale', label: say('On your tailnet'), off: t('prefs.external.tailnetOff'), on: t('prefs.external.tailnetOn') },
  { kind: 'public', label: say('Public address'), off: t('prefs.external.publicOff'), on: t('prefs.external.publicOn') },
];

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));
const seenWords = (at: number): string => formatDateWith(at, { dateStyle: 'medium', timeStyle: 'short' });

/**
 * Settings › External agents: other agents (a Claude Code in your terminal, GrokBot, a local model)
 * reaching Beluga through its MCP server. Turn it on, hand over its URL, make a pairing code (what it
 * gives is chosen here, and the sign-in page only spends it), see who connected, and revoke them.
 */
export function ExternalAgentsSettings() {
  useT();
  const api = useApi();
  const projects = useApp((st) => st.projects.filter((p) => p.root && !p.error).map((p) => p.id + '\n' + p.name).join('\0'));
  const [status, setStatus] = useState<Status | undefined>();
  const [agents, setAgents] = useState<readonly Agent[]>([]);
  const [level, setLevel] = useState<Level>('full');
  const [allProjects, setAllProjects] = useState(true);
  const [remote, setRemote] = useState(false);
  // For one code only: it goes back to off when a code is made or the choice above changes.
  const [confirmFull, setConfirmFull] = useState(false);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [dms, setDms] = useState(true);
  const [groups, setGroups] = useState(true);
  const [code, setCode] = useState<{ code: string; expiresAt: number } | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [shown, setShownState] = useState<ActivityShown>('all');
  const [activity, setActivity] = useState<readonly Activity[]>([]);
  const filter = useRef<ActivityShown>('all');
  const setShown = (next: ActivityShown): void => {
    filter.current = next;
    setShownState(next);
    look();
  };

  const look = (): void => {
    void api.external.status().then((v) => setStatus(v as Status), (e: unknown) => setError(errorText(e)));
    void api.external.agents().then((v) => setAgents(v as readonly Agent[]), () => undefined);
    void api.external.activity(filter.current === 'all' ? {} : { kind: filter.current }).then((v) => setActivity(v as readonly Activity[]), () => undefined);
  };
  // An agent signs in from its own terminal while this pane is open.
  const tick = useClock(true, REFRESH_MS);
  useEffect(look, [tick]);

  const run = (work: Promise<unknown>): void => {
    setError(undefined);
    void work.then(look, (e: unknown) => setError(errorText(e)));
  };
  const makeCode = (): void => {
    if (remote && level === 'full' && !confirmFull) return setError(t('prefs.external.confirmFirst'));
    setError(undefined);
    setConfirmFull(false);
    void api.external.pairingCode({ level, projects: allProjects ? 'all' : [...chosen], chats: { dms, groups }, ...(remote ? { remote: true } : {}), ...(remote && level === 'full' ? { allowRemoteFull: true } : {}) }).then((v) => setCode(v as { code: string; expiresAt: number }), (e: unknown) => setError(errorText(e)));
  };
  const toggle = (id: string): void => {
    const next = new Set(chosen);
    if (!next.delete(id)) next.add(id);
    setChosen(next);
  };
  const [turning, setTurning] = useState<RouteKind | undefined>();
  const setRoute = (kind: RouteKind, on: boolean): void => {
    setError(undefined);
    setTurning(kind);
    void api.external.setRoute(kind, on).then(look, (e: unknown) => setError(errorText(e))).finally(() => setTurning(undefined));
  };
  const routeDetail = (row: ReturnType<typeof ROUTE_ROWS>[number], route: Route | undefined): ReactNode => {
    if (turning === row.kind && !route?.url) return t('prefs.external.routeOpening');
    if (route?.state === 'reopening') return route.error ? t('prefs.external.routeReopeningError', { error: route.error }) : t('prefs.external.routeDropped');
    return route?.url ? <>{route.url}<br />{row.on}</> : row.off;
  };
  const projectRows = projects ? projects.split('\0').map((line) => line.split('\n') as [string, string]) : [];

  return (
    <>
      <Group>
        <Row label={say('Let other agents connect')} detail={status?.error ?? (status?.on ? status.routes?.length ? t('prefs.external.connectEach') : t('prefs.external.connectLocal') : t('prefs.external.connectOff'))}>
          <Switch label={say('Let other agents connect')} on={status?.on ?? false} onChange={(on) => run(api.external.setEnabled(on))} />
        </Row>
        {status?.on ? (
          <Row label={say('Pause all agents')} detail={status.paused ? t('prefs.external.paused') : t('prefs.external.pauseDetail')}>
            <Switch label={say('Pause all agents')} on={status.paused ?? false} onChange={(on) => run(api.external.setPaused(on))} />
          </Row>
        ) : null}
        {status?.url ? (
          <Row label={say('MCP URL')} detail={status.url}>
            <Button onClick={() => void copyText(status.url!)}>{t('prefs.external.copyMcpUrl')}</Button>
          </Row>
        ) : null}
        {ROUTE_ROWS().map((row) => {
          const route = status?.routes?.find((r) => r.kind === row.kind);
          return (
            <Row key={row.kind} label={row.label} detail={routeDetail(row, route)}>
              {route?.url ? <Button onClick={() => void copyText(route.url!)}>{t('prefs.external.copyMcpUrl')}</Button> : null}
              <Switch label={row.label} on={route !== undefined} onChange={(on) => { if (!turning) setRoute(row.kind, on); }} />
            </Row>
          );
        })}
      </Group>
      {status?.on ? (
        <Group title={say('Connect an agent')}>
          <Row label={say('For an agent outside this Mac')} detail={t('prefs.external.outsideDetail')}>
            <Switch
              label={say('For an agent outside this Mac')}
              on={remote}
              onChange={(on) => {
                setRemote(on);
                setConfirmFull(false);
                if (on && level === 'full') setLevel('trusted');
              }}
            />
          </Row>
          <Row label={say('What it may do')} detail={t('prefs.external.mayDoDetail')}>
            <Select<Level> label={say('What it may do')} value={level} options={LEVELS()} onChange={(next) => { setLevel(next); setConfirmFull(false); }} />
          </Row>
          {remote && level === 'full' ? (
            <Row label={say('Full trust for this code')} detail={<span className={s.fullWarning} role="alert">{REMOTE_FULL_WARNING}</span>}>
              <Switch label={t('prefs.external.fullUnderstand')} on={confirmFull} onChange={setConfirmFull} />
            </Row>
          ) : null}
          <Row label={say('All projects and chats')} detail={t('prefs.external.allProjectsDetail')}>
            <Switch label={t('prefs.external.reachAll')} on={allProjects} onChange={setAllProjects} />
          </Row>
          {allProjects ? null : projectRows.map(([id, name]) => (
            <Row key={id} label={name} detail={t('prefs.external.projectReached')}>
              <Switch label={t('prefs.external.reachName', { name })} on={chosen.has(id)} onChange={() => toggle(id)} />
            </Row>
          ))}
          {allProjects ? null : (
            <Row label={say('Your chats with no project')} detail={t('prefs.external.noProjectChatsDetail')}>
              <Switch label={t('prefs.external.reachNoProjectChats')} on={chosen.has(STANDALONE_CHATS)} onChange={() => toggle(STANDALONE_CHATS)} />
            </Row>
          )}
          <Row label={say('Direct messages')} detail={t('prefs.external.dmsDetail')}>
            <Switch label={t('prefs.external.reachDms')} on={dms} onChange={setDms} />
          </Row>
          <Row label={say('Groups')} detail={t('prefs.external.groupsDetail')}>
            <Switch label={t('prefs.external.reachGroups')} on={groups} onChange={setGroups} />
          </Row>
          <Row label={say('Pairing code')} detail={code ? t('prefs.external.codeDetail') : t('prefs.external.noCodeDetail')}>
            {code ? <code data-pairing-code>{code.code}</code> : null}
            {code ? <Button onClick={() => void copyText(code.code)}>{t('prefs.external.copy')}</Button> : null}
            <Button onClick={makeCode}>{code ? t('prefs.external.makeAnother') : t('prefs.external.makeCode')}</Button>
          </Row>
        </Group>
      ) : null}
      {error ? <p className={s.endpointError} role="alert">{error}</p> : null}
      {agents.length ? (
        <Group title={say('Connected agents')}>
          <Row label={say('Stop all agents')} detail={t('prefs.external.stopAllDetail')}>
            <Button onClick={() => run(api.external.stopAll())}>{t('prefs.external.stopAllButton')}</Button>
          </Row>
          {agents.map((a) => (
            <Row key={a.id} label={a.name} detail={t('prefs.external.agentDetail', {
                suspended: a.suspendedAt === undefined ? '' : t('prefs.external.suspended'),
                what: a.route === 'remote' && a.level === 'full' ? t('prefs.external.fullOutside') : t('prefs.external.levelWhere', { level: LEVEL_WORDS()[a.level] ?? a.level, where: a.route === 'local' ? t('prefs.external.onThisMac') : t('prefs.external.outsideThisMac') }),
                when: seenWords(a.lastSeen),
              })}>
              {a.suspendedAt === undefined ? null : <Button onClick={() => run(api.external.resume(a.id))}>{t('prefs.external.resume')}</Button>}
              <Button onClick={() => run(api.external.stopAgent(a.id))}>{t('common.stop')}</Button>
              <Button tone="error" onClick={() => run(api.external.revoke(a.id))}>{t('prefs.external.revoke')}</Button>
            </Row>
          ))}
        </Group>
      ) : null}
      {agents.length ? (
        <Group title={say('Activity')}>
          <Row label={say('Show')} detail={t('prefs.external.showDetail')}>
            <Select<ActivityShown> label={say('Show')} value={shown} options={ACTIVITY_SHOWN()} onChange={setShown} />
          </Row>
          {activity.length ? activity.map((a) => (
            <Row key={`${a.ts} ${a.tool} ${a.argsHash}`} label={`${a.agent}: ${a.tool}`} detail={t('prefs.external.activityDetail', { kind: KIND_WORDS()[a.kind], who: a.decidedBy === 'person' ? t('prefs.external.byYou') : t('prefs.external.byLevel'), target: a.target ? ` · ${a.target}` : '', when: seenWords(a.ts) })}>
              {null}
            </Row>
          )) : (
            <Row label={say('Nothing yet')} detail={t('prefs.external.nothingYetDetail')}>
              {null}
            </Row>
          )}
        </Group>
      ) : null}
    </>
  );
}
