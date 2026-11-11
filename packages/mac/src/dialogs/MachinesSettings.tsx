import { type KeyboardEvent, useCallback, useEffect, useState } from 'react';
import type { AlwaysOnView } from '@beluga/machines/always-on.js';
import type { ComputerOffer } from '@beluga/machines/enroll.js';
import type { MachineView } from '@beluga/machines/machines.js';
import type { Placement } from '@beluga/machines/placement.js';
import type { SettingsSyncView } from '@beluga/machines/sync.js';
import type { UpdateAnswer } from '@beluga/machines/versions.js';
import type { MachineIcon } from '@beluga/shared/settings-schema.js';
import type { EnvSendAlways } from '@beluga/shared/env-send.js';
import { Icon, type IconName } from '../components/Icon.js';
import { ActionsDropdown, type ActionItem } from '../components/SpecMenu.js';
import { Button, Dot, IconButton, Segmented } from '../components/ui.js';
import { useApp, useBeluga } from '../lib/beluga.js';
import { copyText } from '../lib/copy.js';
import { say, useT } from '../lib/i18n.js';
import { upFirst, thisComputer } from '../lib/os-words.js';
import { MachineMark } from '../machines/MachineMark.js';
import { onMachine, pageOfChannel } from '../machines/pane-model.js';
import { useActions } from '../lib/actions.js';
import { ICON_CHOICES, healthOf, kindLine, loadLine, runOnOptions } from '../machines/model.js';
import c from '../machines/machines.module.css';
import { Group, Row, Select, Switch } from './settings-controls.js';
import s from './settings.module.css';
import { everyWhileShown } from '../lib/window-active.js';

/**
 * Settings › Your Computers (BLG-780): where new work runs, adding a computer (over SSH, or with
 * the link or code `beluga pair --computer` printed there, after the four pictures match), and
 * each computer: its icon, name, kind, status, load and health with the fix for what isn't ready.
 * Renaming and the icon are kept on the computer, so every device shows the same. Forget is
 * behind •••, and reaches every device of yours. Your settings follow you to all of them by
 * themselves (BLG-805): a conflict is said under Your Settings, and your secrets go to a computer
 * only after you said Keep My Secrets in Sync for it (•••).
 *
 * You on the Network (BLG-796): this Mac, or the computer you made your Always On (•••, after one
 * plain confirmation of what moves), and Make This Mac Always On to bring it back.
 */
export function MachinesSettings() {
  const t = useT();
  const { client } = useBeluga();
  const runOn = useApp((st) => st.prefs.runOn);
  const [machines, setMachines] = useState<readonly MachineView[] | undefined>();
  const [placement, setPlacement] = useState<Placement | undefined>();
  const [sync, setSync] = useState<SettingsSyncView | undefined>();
  const [you, setYou] = useState<AlwaysOnView | undefined>();
  const refresh = useCallback(() => {
    void client.call('machines.alwaysOn.status').then((v) => setYou(v as AlwaysOnView), () => undefined);
    void client.call('machines.list').then((list) => setMachines(list as readonly MachineView[]), () => setMachines([]));
    void client.call('machines.placement').then((p) => setPlacement(p as Placement), () => undefined);
    void client.call('machines.settingsSync').then((v) => setSync(v as SettingsSyncView), () => undefined);
  }, [client]);
  useEffect(() => {
    refresh();
    // The daemon asks each computer every 30 s; what it has is read more often while you look (and not while the window can't be seen).
    return everyWhileShown(refresh, 5_000);
  }, [refresh, runOn]);
  const here = upFirst(thisComputer());
  return (
    <>
      <Group title={say('Where new work runs')}>
        <Row label={say('Run New Work On')} detail={placement?.why ?? t('prefs.machines.runOnDetail')}>
          <Select label={say('Run New Work On')} value={runOn} onChange={(v) => void client.api.session.setPrefs({ runOn: v })} options={runOnOptions(here, machines ?? [])} />
        </Row>
      </Group>
      {machines?.length ? <YouOnTheNetwork you={you} here={here} onChange={refresh} /> : null}
      <Group title={say('Your computers')}>
        <AddComputer onAdded={refresh} />
        {machines === undefined ? <div className={s.note}>{t('prefs.machines.looking')}</div> : machines.length === 0 ? <div className={s.note}>{t('prefs.machines.none')}</div> : machines.map((mc) => <Computer key={mc.id} machine={mc} moving={Boolean(you?.busy)} onChange={refresh} />)}
      </Group>
      <EnvSentAlways />
      {machines?.length ? <YourSettings sync={sync} onClear={() => void client.call('machines.settingsSync.clear').then(refresh, () => undefined)} /> : null}
    </>
  );
}

/** Projects whose .env files go to your computers without asking (BLG-800): Ask Again takes it back. */
function EnvSentAlways() {
  const t = useT();
  const { client } = useBeluga();
  const [always, setAlways] = useState<readonly EnvSendAlways[]>([]);
  useEffect(() => {
    void client.call('machines.env.always').then((list) => setAlways(list as readonly EnvSendAlways[]), () => undefined);
  }, [client]);
  if (!always.length) return null;
  return (
    <Group title={say('Env files sent without asking')}>
      {always.map((a) => (
        <Row key={a.root} label={a.name} detail={t('prefs.machines.envDetail')}>
          <Button size="small" variant="quiet" onClick={() => void client.call('machines.env.forget', a.root).then((list) => setAlways(list as readonly EnvSendAlways[]), () => undefined)}>
            {t('prefs.machines.askAgain')}
          </Button>
        </Row>
      ))}
    </Group>
  );
}

const when = (at: number): string => new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Your settings on every computer (BLG-805): what follows you, what stays, and conflicts said. */
function YourSettings({ sync, onClear }: { sync: SettingsSyncView | undefined; onClear: () => void }) {
  const t = useT();
  const conflicts = sync?.conflicts ?? [];
  return (
    <Group title={say('Your settings')}>
      <Row label={say('Your settings on every computer')} detail={t('prefs.machines.settingsDetail')}>
        <span className={c.kind}>{sync ? t('prefs.machines.inSync', { count: sync.synced }) : ''}</span>
      </Row>
      {conflicts.length ? (
        <div className={c.add} data-testid="sync-conflicts">
          {conflicts.map((k) => (
            <div key={`${k.key}-${k.at}-${k.kept.at}`} className={c.kind}>
              <Icon name="alert" size={11} />{' '}
              {t('prefs.machines.conflict', {
                what: k.secret ? t('prefs.machines.conflictSecret', { label: k.label }) : k.label,
                kept: k.kept.name,
                lost: k.lost.name,
                value: k.kept.value ? t('prefs.machines.conflictValue', { value: k.kept.value }) : '',
                when: when(k.kept.at),
                over: k.secret ? '' : t('prefs.machines.conflictOver', { value: k.lost.value ?? t('prefs.machines.conflictIts'), when: when(k.lost.at) }),
              })}
            </div>
          ))}
          <div className={c.addRow}>
            <Button size="small" variant="quiet" onClick={onClear}>
              {t('prefs.machines.gotIt')}
            </Button>
          </div>
        </div>
      ) : null}
    </Group>
  );
}

/** Where you are on the network (BLG-796): this Mac, or your Always On, with Make This Mac Always On to bring it back. */
function YouOnTheNetwork({ you, here, onChange }: { you: AlwaysOnView | undefined; here: string; onChange: () => void }) {
  const t = useT();
  const { client } = useBeluga();
  const [asking, setAsking] = useState(false);
  const [said, setSaid] = useState<string | undefined>();
  if (!you) return null;
  const back = (): void => {
    setAsking(false);
    setSaid(t('prefs.machines.movingBack', { here }));
    void client.call('machines.alwaysOn', 'here').then(
      () => {
        setSaid(t('prefs.machines.backAgain', { here }));
        onChange();
      },
      (err: unknown) => setSaid(err instanceof Error ? err.message : String(err)),
    );
  };
  const detail = you.busy
    ? you.busy
    : you.standIn
      ? t('prefs.machines.standIn', { name: you.standIn.name, here })
      : you.here
      ? t('prefs.machines.hereDetail', { here })
      : t('prefs.machines.awayDetail', { name: you.name ?? '', here, pending: you.pending ? t('prefs.machines.pending', { name: you.name ?? '' }) : '' });
  return (
    <Group title={say('You on the network')}>
      <Row label={you.here ? here : (you.name ?? t('prefs.machines.yourAlwaysOn'))} detail={detail}>
        {you.here || you.busy ? (
          <span className={c.kind} data-testid={you.standIn ? 'standing-in' : undefined}>
            {you.standIn ? t('prefs.machines.standingIn') : you.here ? t('prefs.machines.alwaysOn') : ''}
          </span>
        ) : (
          <Button size="small" onClick={() => setAsking(true)}>
            {t('prefs.machines.makeHereAlwaysOn', { computer: upFirst(thisComputer()) })}
          </Button>
        )}
      </Row>
      {asking ? (
        <div className={c.add} data-testid="always-on-back">
          <div className={c.kind}>{t('prefs.machines.backText', { name: you.name ?? '', here })}</div>
          <div className={c.addRow}>
            <Button variant="quiet" onClick={() => setAsking(false)}>
              {t('common.notNow')}
            </Button>
            <Button variant="primary" onClick={back}>
              {t('prefs.machines.moveBack')}
            </Button>
          </div>
        </div>
      ) : null}
      {said ? <div className={s.note}>{said}</div> : null}
    </Group>
  );
}

type How = 'ssh' | 'code';

/** Add a Computer: over SSH (a host from your ssh config, or user@host), or with a link or code. */
function AddComputer({ onAdded }: { onAdded: () => void }) {
  const t = useT();
  const { client } = useBeluga();
  const [open, setOpen] = useState(false);
  const [how, setHow] = useState<How>('ssh');
  const [hosts, setHosts] = useState<readonly string[]>([]);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [offer, setOffer] = useState<ComputerOffer | undefined>();
  const [said, setSaid] = useState<string | undefined>();
  useEffect(() => {
    if (open && how === 'ssh') void client.call('machines.ssh.hosts').then((h) => setHosts(h as string[]), () => setHosts([]));
  }, [client, open, how]);
  const reset = (): void => {
    setOffer(undefined);
    setBusy(false);
    setTyped('');
  };
  const find = (): void => {
    const what = typed.trim();
    if (!what) return;
    setBusy(true);
    setSaid(how === 'ssh' ? t('prefs.machines.reachingSsh', { what }) : t('prefs.machines.lookingComputer'));
    void client.call(how === 'ssh' ? 'machines.ssh.pair' : 'machines.join.start', what).then(
      (o) => {
        setOffer(o as ComputerOffer);
        setSaid(undefined);
      },
      (err: unknown) => {
        setBusy(false);
        setSaid(err instanceof Error ? err.message : String(err));
      },
    );
  };
  const join = (): void => {
    void client.call('machines.join.approve').then(
      (added) => {
        setSaid(t('prefs.machines.added', { name: (added as MachineView).name }));
        reset();
        setOpen(false);
        onAdded();
      },
      (err: unknown) => {
        setSaid(err instanceof Error ? err.message : String(err));
        reset();
      },
    );
  };
  const cancel = (): void => {
    void client.call('machines.join.cancel').catch(() => undefined);
    reset();
    setSaid(undefined);
  };
  const enter = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') find();
  };
  // i18n-ignore: product names
  const platform = offer ? (offer.platform === 'macos' ? 'Mac' : offer.platform === 'windows' ? 'Windows' : 'Linux') : '';
  return (
    <>
      <div className={c.head}>
        <div className={c.headText}>{t('prefs.machines.joinOnce')}</div>
        {open ? null : (
          <Button variant="primary" icon="plus" onClick={() => setOpen(true)}>
            {t('prefs.machines.addComputer')}
          </Button>
        )}
      </div>
      {said && !open ? <div className={s.note}>{said}</div> : null}
      {open ? (
        <div className={c.add}>
          {offer ? (
            <div className={c.offer}>
              <div>{t('prefs.machines.offer', { name: offer.name, platform, version: offer.version, check: offer.sshChecked ? t('prefs.machines.sshChecked') : t('prefs.machines.checkShows') })}</div>
              <div className={c.pictures} aria-label={t('prefs.machines.fingerprint', { fingerprint: offer.fingerprint })}>
                {offer.fingerprint}
              </div>
              <div className={c.addRow}>
                <Button variant="quiet" onClick={cancel}>
                  {t('common.cancel')}
                </Button>
                <Button variant="primary" onClick={join}>
                  {t('prefs.machines.join')}
                </Button>
              </div>
            </div>
          ) : (
            <>
              <Segmented
                label={t('prefs.machines.howAdd')}
                radio
                value={how}
                onChange={(v) => {
                  setHow(v);
                  setTyped('');
                }}
                options={[
                  { value: 'ssh', label: t('prefs.machines.overSsh'), icon: 'terminal' },
                  { value: 'code', label: t('prefs.machines.linkOrCode'), icon: 'link' },
                ]}
              />
              <div className={c.addRow}>
                {how === 'ssh' && hosts.length ? <Select label={t('prefs.machines.sshHost')} value={hosts.includes(typed) ? typed : ''} placeholder={t('prefs.machines.yourHosts')} onChange={(v) => setTyped(v)} options={hosts.map((h) => ({ value: h, label: h }))} /> : null}
                {/* i18n-ignore: user@host and you@host are address shapes */}
                <input className={s.text} aria-label={how === 'ssh' ? 'user@host' : t('prefs.machines.linkOrCodeAria')} placeholder={how === 'ssh' ? 'you@host' : t('prefs.machines.codePlaceholder')} value={typed} disabled={busy} onChange={(e) => setTyped(e.target.value)} onKeyDown={enter} autoFocus />
                <Button variant="quiet" onClick={() => (setOpen(false), cancel())}>
                  {t('common.close')}
                </Button>
                <Button variant="primary" disabled={busy || !typed.trim()} onClick={find}>
                  {busy ? t('prefs.machines.looking') : t('prefs.machines.add')}
                </Button>
              </div>
              {how === 'code' ? <div className={c.kind}>{t('prefs.machines.codeHint')}</div> : null}
              {said ? <div className={c.kind}>{said}</div> : null}
            </>
          )}
        </div>
      ) : null}
    </>
  );
}

/** One computer: icon, name (rename in place), kind, status and load, health with fixes, and •••. */
function Computer({ machine, moving, onChange }: { machine: MachineView; moving: boolean; onChange: () => void }) {
  const t = useT();
  const { client } = useBeluga();
  const [naming, setNaming] = useState<string | undefined>();
  const [said, setSaid] = useState<string | undefined>();
  const [asked, setAsked] = useState<UpdateAnswer | undefined>();
  const [askSecrets, setAskSecrets] = useState(false);
  const [askAlwaysOn, setAskAlwaysOn] = useState(false);
  const [runThere, setRunThere] = useState(true);
  const fail = (err: unknown): void => setSaid(err instanceof Error ? err.message : String(err));
  const look = (patch: { name?: string; icon?: MachineIcon }): void =>
    void client.call('machines.look', machine.id, patch).then(() => {
      setSaid(undefined);
      onChange();
    }, fail);
  const rename = (): void => {
    const name = naming?.trim();
    setNaming(undefined);
    if (name && name !== machine.name) look({ name });
  };
  const update = (mode: 'ask' | 'when-idle' | 'now'): void =>
    void client.call('machines.update', machine.id, mode).then((a) => {
      const answer = a as UpdateAnswer;
      setAsked(answer.state === 'busy' ? answer : undefined);
      setSaid(answer.message);
    }, fail);
  const secrets = (on: boolean): void =>
    void client.call('machines.secrets', machine.id, on).then(() => {
      setAskSecrets(false);
      setSaid(on ? t('prefs.machines.secretsOn', { name: machine.name }) : t('prefs.machines.secretsOff', { name: machine.name }));
      onChange();
    }, fail);
  // Make Always On (BLG-796): asked once, here; Run New Work On follows when you leave it on.
  const makeAlwaysOn = (): void => {
    setAskAlwaysOn(false);
    setSaid(t('prefs.machines.movingTo', { name: machine.name }));
    void client.call('machines.alwaysOn', machine.id).then(() => {
      if (runThere) void client.api.session.setPrefs({ runOn: machine.id });
      setSaid(t('prefs.machines.nowAlwaysOn', { name: machine.name }));
      onChange();
    }, fail);
  };
  const forget = (): void =>
    void client.call('machines.forget', machine.id).then(() => {
      setSaid(undefined);
      onChange();
    }, fail);
  // Its ••• : each row with its icon; Icon ▸ shows each choice as it looks, the one in use ticked at the end.
  const iconNow = machine.icon ?? 'auto';
  const menu: ActionItem[] = [
    { label: t('prefs.machines.rename'), icon: 'pencil', onSelect: () => setNaming(machine.name) },
    {
      label: t('prefs.machines.icon'),
      mark: <MachineMark machine={machine} size={13} />,
      separate: true,
      submenu: ICON_CHOICES.map((choice) =>
        choice.value === 'auto'
          ? { label: t('prefs.machines.itsOwn'), hint: kindLine(machine), mark: <MachineMark machine={{ ...machine, icon: 'auto' }} size={13} />, checked: iconNow === 'auto', onSelect: () => look({ icon: 'auto' }) }
          : { label: choice.label, icon: choice.value as IconName, checked: iconNow === choice.value, separate: ICON_CHOICES[1] === choice, onSelect: () => look({ icon: choice.value }) },
      ),
      onSelect: () => undefined,
    },
    ...(machine.alwaysOn ? [] : [{ label: t('prefs.machines.makeAlwaysOn'), icon: 'power' as const, separate: true, disabled: moving, onSelect: () => setAskAlwaysOn(true) }]),
    { label: machine.secrets ? t('prefs.machines.stopSecrets') : t('prefs.machines.keepSecrets'), icon: 'lock', ...(machine.alwaysOn ? { separate: true } : {}), onSelect: () => (machine.secrets ? secrets(false) : setAskSecrets(true)) },
    { label: t('prefs.machines.forget', { name: machine.name }), icon: 'trash', danger: true, separate: true, onSelect: forget },
  ];
  const health = healthOf(machine);
  const fixes = health.filter((h) => !h.ok && h.fix);
  const tone = machine.status === 'online' ? (machine.readOnly ? 'warn' : 'ok') : 'muted';
  return (
    <div className={c.computer} data-machine={machine.id}>
      <MachineMark machine={machine} />
      <div className={c.main}>
        <div className={c.nameLine}>
          {naming !== undefined ? (
            <input className={c.nameInput} aria-label={t('prefs.machines.name')} value={naming} autoFocus onChange={(e) => setNaming(e.target.value)} onBlur={rename} onKeyDown={(e) => (e.key === 'Enter' ? rename() : e.key === 'Escape' ? setNaming(undefined) : undefined)} maxLength={64} />
          ) : (
            <span className={c.name} title={t('prefs.machines.renameTitle')} role="button" tabIndex={0} onClick={() => setNaming(machine.name)} onKeyDown={(e) => (e.key === 'Enter' ? setNaming(machine.name) : undefined)}>
              {machine.name}
            </span>
          )}
          <span className={c.kind}>{kindLine(machine)}</span>
          {machine.alwaysOn ? (
            <span className={c.kind} data-testid="always-on-tag">
              <Icon name="power" size={11} /> {t('prefs.machines.alwaysOn')}
            </span>
          ) : null}
        </div>
        {machine.secrets ? (
          <div className={c.kind}>
            <Icon name="lock" size={11} /> {t('prefs.machines.secretsTag')}
          </div>
        ) : null}
        <div className={c.load}>
          <Dot tone={tone} />
          {loadLine(machine)}
        </div>
        {health.length ? (
          <div className={c.health}>
            {health.map((h) => (
              <span key={h.key} className={h.ok ? c.ok : c.notOk}>
                <Icon name={h.ok ? 'check' : 'alert'} size={11} />
                {h.label}
                {h.usage ? ` · ${h.usage}` : ''}
              </span>
            ))}
          </div>
        ) : null}
        <Work machine={machine} />
        {fixes.map((h) => (
          <div key={h.key} className={c.fix}>
            {h.fix!.words}
            {h.fix!.command ? (
              <>
                : <code>{h.fix!.command}</code>
                <Button size="small" variant="quiet" icon="copy" onClick={() => void copyText(h.fix!.command!)}>
                  {t('prefs.machines.copy')}
                </Button>
              </>
            ) : null}
          </div>
        ))}
      </div>
      <div className={c.side}>
        {machine.update === 'computer' ? (
          <Button size="small" onClick={() => update('ask')}>
            {t('prefs.machines.updateIt')}
          </Button>
        ) : null}
        <ActionsDropdown items={menu}>
          <IconButton icon="more" label={t('prefs.machines.moreFor', { name: machine.name })} />
        </ActionsDropdown>
      </div>
      {askAlwaysOn ? (
        <div className={c.said} data-testid="always-on-ask">
          {t('prefs.machines.askAlwaysOn', { name: machine.name, computer: thisComputer() })}{' '}
          <Switch on={runThere} onChange={setRunThere} label={t('prefs.machines.runThereLabel', { name: machine.name })} /> {t('prefs.machines.runThereToo')}{' '}
          <Button size="small" variant="primary" onClick={makeAlwaysOn}>
            {t('prefs.machines.makeItAlwaysOn')}
          </Button>{' '}
          <Button size="small" variant="quiet" onClick={() => setAskAlwaysOn(false)}>
            {t('common.notNow')}
          </Button>
        </div>
      ) : null}
      {askSecrets ? (
        <div className={c.said}>
          {t('prefs.machines.askSecrets', { name: machine.name })}{' '}
          <Button size="small" variant="primary" onClick={() => secrets(true)}>
            {t('prefs.machines.keepThemSync')}
          </Button>{' '}
          <Button size="small" variant="quiet" onClick={() => setAskSecrets(false)}>
            {t('common.notNow')}
          </Button>
        </div>
      ) : null}
      {said ? (
        <div className={c.said}>
          {said}{' '}
          {asked ? (
            <>
              <Button size="small" onClick={() => update('when-idle')}>
                {t('prefs.machines.whenDone')}
              </Button>{' '}
              <Button size="small" variant="quiet" onClick={() => update('now')}>
                {t('prefs.machines.now')}
              </Button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** What runs on a computer now, each opening its page there (BLG-784): its chat, files, terminal and changes. */
function Work({ machine }: { machine: MachineView }) {
  const t = useT();
  const { ui } = useBeluga();
  const actions = useActions();
  const work = (machine.info?.work ?? []).flatMap((w) => {
    const page = pageOfChannel(w.channel);
    return page ? [{ ...w, page }] : [];
  });
  if (!work.length || machine.status !== 'online') return null;
  const open = (page: NonNullable<ReturnType<typeof pageOfChannel>>): void => {
    ui.patch({ settings: undefined });
    actions.run({ type: 'view', view: onMachine(machine.id, page) });
  };
  return (
    <div className={c.work}>
      {work.map((w) => (
        <Button key={w.channel} size="small" variant="quiet" icon="branch" onClick={() => open(w.page)} aria-label={t('prefs.machines.openOn', { worktree: w.worktree, name: machine.name })}>
          {w.worktree} · {w.project}
        </Button>
      ))}
    </div>
  );
}
