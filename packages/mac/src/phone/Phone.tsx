import * as Popover from '@radix-ui/react-popover';
import { useState } from 'react';
import type { DeviceView, PhoneUse } from '../../../../src/companion/protocol.js';
import { Icon } from '../components/Icon.js';
import { Button, cx } from '../components/ui.js';
import { useApp, useBeluga } from '../lib/beluga.js';
import { sameDeep } from '../lib/stable.js';
import { useClock } from '../lib/window-active.js';
import { QrCode } from '../network/QrCode.js';
import { errorText, quietly } from '../network/use-net.js';
import { Group, Row, Select } from '../dialogs/settings-controls.js';
import type { KeepAwake } from '@beluga/shared/settings-schema.js';
import { pathLabelKey } from '../../../../src/companion/diagnose.js';
import { leftText, markOf, seenText } from './phone-model.js';
import p from '../dialogs/native/person.module.css';
import s from './phone.module.css';
import { computerWord, thisComputer, upFirst, yourComputer } from '../lib/os-words.js';
import { say, useT } from '../lib/i18n.js';
import { type Key, t } from '@beluga/shared/i18n/index.js';

/**
 * Your phone on the Mac (docs/companion.md, "On the Mac"): a small mark in the sidebar's footer
 * while a phone is paired (lit with a dot while it's linked, outlined while it's away), its
 * popover with the phones and Pair a Phone…, and Settings › Phone with the same.
 */

/** A clock for "last seen 12 min ago" (it rests while you look away). */
const useMinute = (): number => useClock(true, 30_000);

const useDevices = (): readonly DeviceView[] => useApp((st) => st.companion.devices, sameDeep);
const usePairing = () => useApp((st) => st.companion.pairing, sameDeep);
const useRelay = () => useApp((st) => st.companion.relay);
const useAdb = () => useApp((st) => st.companion.adb, sameDeep);

/** How Claude may use this phone (BLG-150): the preset, the route it's reached by, and adb pairing. */
const useOptions = (): ReadonlyArray<{ value: PhoneUse; label: string }> => [
  { value: 'off', label: t('common.off') },
  { value: 'ask', label: t('project.phone.askEachTime') },
  { value: 'use', label: t('project.phone.use') },
  { value: 'full', label: t('project.phone.full') },
];
const routeWords = (): Record<string, string> => ({ usb: t('project.phone.route.usb'), wifi: t('project.phone.route.wifi'), link: t('project.phone.route.link'), accessibility: t('project.phone.route.accessibility') });

function PhoneClaude({ d }: { d: DeviceView }) {
  const { client } = useBeluga();
  const t = useT();
  const c = d.control;
  if (!c || d.platform === 'ios') return null;
  const route = c.routes[0];
  return (
    <div className={s.control}>
      <Row label={say('Let your agent use this phone')} detail={route ? t('project.phone.reachedBy', { how: routeWords()[route] ?? route }) : (c.note ?? t('project.phone.notReachable'))}>
        <Select label={say('Let your agent use this phone')} value={c.use} onChange={(v) => void client.api.companion['phone.use'](d.id, v as PhoneUse)} options={useOptions().map((o) => ({ ...o }))} />
      </Row>
      {c.use !== 'off' && c.accessibility !== true ? <BelugaLink id={d.id} reachable={c.usb === true || c.adb === 'connected' || c.adb === 'ready'} /> : null}
      {c.use !== 'off' && (c.usb || c.adb !== 'off') ? <OverWifi id={d.id} on={c.adb !== undefined && c.adb !== 'off'} cable={c.usb === true} path={c.wifiPath} /> : null}
      {c.use !== 'off' && c.adb === 'unpaired' ? (
        <Row label={say('Wireless debugging')} detail={t('project.phone.wirelessDebuggingDetail')}>
          <Button size="small" onClick={() => void quietly(client, client.api.companion['phone.pairAdb'](d.id))}>
            {t('project.phone.connect')}
          </Button>
        </Row>
      ) : null}
    </div>
  );
}

/**
 * Beluga Link (BLG-391): the phone's small add-on app with the Accessibility service, which lets
 * Claude tap and type without a cable. Installed from here over adb, Play Protect doesn't block it
 * and it's turned on too.
 */
function BelugaLink({ id, reachable }: { id: string; reachable: boolean }) {
  const { client } = useBeluga();
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string>();
  const go = async (): Promise<void> => {
    setBusy(true);
    setSaid(undefined);
    try {
      setSaid(await client.api.companion['phone.setUpLink'](id));
    } catch (err) {
      setSaid(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  const detail = reachable
    ? t('project.phone.linkDetailReachable', { computer: upFirst(thisComputer()) })
    : t('project.phone.linkDetailCable');
  return (
    <Row label={say('Beluga Link')} detail={said ?? detail}>
      <Button size="small" disabled={busy || !reachable} onClick={() => void go()}>
        {busy ? t('project.phone.settingUp') : t('project.phone.setUpLink')}
      </Button>
    </Row>
  );
}

/**
 * Wireless debugging (BLG-187): on over the cable so Claude and the mirror carry on unplugged, or
 * off. It's only ever reached through Beluga's encrypted link, and goes off by itself when unused.
 */
function OverWifi({ id, on, cable, path }: { id: string; on: boolean; cable: boolean; path?: 'direct' | 'blocked' }) {
  const { client } = useBeluga();
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string>();
  const go = async (next: boolean): Promise<void> => {
    setBusy(true);
    setSaid(undefined);
    try {
      setSaid(await client.api.companion['phone.wifi'](id, next));
    } catch (err) {
      setSaid(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  const way =
    path === 'blocked'
      ? t('project.phone.wayBlocked', { computer: computerWord() })
      : path === 'direct'
        ? t('project.phone.wayDirect', { computer: computerWord() })
        : t('project.phone.wayEither');
  const detail = on ? t('project.phone.wifiOn', { way }) : t('project.phone.wifiOff', { way });
  return (
    <Row label={say('Over Wi‑Fi')} detail={said ?? detail}>
      {on ? (
        <Button size="small" disabled={busy} onClick={() => void go(false)}>
          {busy ? t('project.phone.turningOff') : t('project.phone.turnOff')}
        </Button>
      ) : (
        <Button size="small" disabled={busy || !cable} onClick={() => void go(true)}>
          {busy ? t('project.phone.waitingPhone') : t('project.phone.useOverWifi')}
        </Button>
      )}
    </Row>
  );
}

/** How phones on other networks (a dorm's or a café's Wi-Fi, mobile data) reach this Mac, in a line (BLG-126). */
export function relayText(relay: 'ready' | 'starting' | 'off' | undefined): { readonly text: string; readonly ok: boolean } | undefined {
  if (relay === 'ready') return { text: t('project.phone.relayReady', { computer: thisComputer() }), ok: true };
  if (relay === 'starting') return { text: t('project.phone.relayStarting'), ok: false };
  if (relay === 'off') return { text: t('project.phone.relayOff', { computer: thisComputer() }), ok: false };
  return undefined;
}

const keepAwakeOptions = (): ReadonlyArray<{ value: KeepAwake; label: string }> => [
  { value: 'off', label: t('project.phone.never') },
  { value: 'power', label: t('project.phone.onPower') },
  { value: 'always', label: t('project.phone.always') },
];

/** Whether phones reach this Mac from anywhere now, and keeping it awake for them. */
function Reaching() {
  const { client } = useBeluga();
  const t = useT();
  const relay = relayText(useRelay());
  const keepAwake = useApp((st) => st.prefs.keepAwake ?? 'off');
  return (
    <>
      {relay ? (
        <Row label={say('From other networks')} detail={relay.text}>
          <span className={cx(s.relayDot, relay.ok && s.relayOk)} aria-label={relay.ok ? t('project.phone.ready') : t('project.phone.notReady')} />
        </Row>
      ) : null}
      <Row label={t('project.phone.keepAwake', { computer: thisComputer() })} detail={t('project.phone.keepAwakeDetail', { computer: computerWord() })}>
        <Select label={t('project.phone.keepAwake', { computer: thisComputer() })} value={keepAwake} onChange={(v) => void client.api.session.setPrefs({ keepAwake: v })} options={keepAwakeOptions().map((o) => ({ ...o }))} />
      </Row>
    </>
  );
}

/** The phones you paired: each with how it is now, Remove, and (in Settings) how Claude may use it. */
function DeviceList({ now, control = false }: { now: number; control?: boolean }) {
  const { client } = useBeluga();
  const t = useT();
  const devices = useDevices();
  if (!devices.length) return <div className={s.empty}>{t('project.phone.noPhone')}</div>;
  return (
    <ul className={s.devices} aria-label={t('project.phone.yourPhones')}>
      {devices.map((d) => (
        <li key={d.id} className={s.device}>
          <div className={s.deviceHead}>
            <span className={cx(s.deviceMark, d.linked && s.lit)} aria-hidden="true">
              <Icon name="phone" size={16} />
            </span>
            <span className={s.deviceText}>
              <span className={s.deviceName}>{d.name}</span>
              <span className={s.dim}>
                {d.platform === 'ios' ? 'iPhone' : 'Android' /* i18n-ignore */}
                {d.app ? ` · ${t('project.phone.app', { version: d.app })}` : ''} · {seenText(d, now)}
              </span>
              {d.path ? (
                <span className={s.path} title={d.note}>
                  {d.path === 'relay' ? (d.note ?? t(pathLabelKey(d.path) as Key)) : t(pathLabelKey(d.path) as Key)}
                </span>
              ) : null}
            </span>
            <Button size="small" variant="quiet" onClick={() => void client.api.companion['devices.remove'](d.id)}>
              {t('project.phone.remove')}
            </Button>
          </div>
          {control ? <PhoneClaude d={d} /> : null}
        </li>
      ))}
    </ul>
  );
}

/** Pair a Phone…: the QR and the code while a pairing is open, and "Pair this phone?" once one is waiting (also on the welcome's phone step). */
export function Pairing({ now }: { now: number }) {
  const { client } = useBeluga();
  const t = useT();
  const pairing = usePairing();
  const devices = useDevices();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const start = async (): Promise<void> => {
    setBusy(true);
    setError(undefined);
    try {
      await quietly(client, client.api.companion['pair.start']());
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  if (!pairing) {
    // While it opens it stays the same button, the same size (both labels take the room): a spinner and "Opening…", readable.
    return (
      <div className={s.pairRow}>
        {error ? <div className={s.error}>{error}</div> : null}
        <Button variant={devices.length ? 'plain' : 'primary'} className={cx(s.pairButton, busy && s.opening, busy && devices.length > 0 && s.openingPlain)} disabled={busy || devices.length >= 4} aria-busy={busy || undefined} onClick={() => void start()}>
          <span className={s.pairFace} data-shown={busy ? undefined : 'true'}>
            <Icon name="phone" size={14} />
            {t('project.phone.pairPhone')}
          </span>
          <span className={s.pairFace} data-shown={busy ? 'true' : undefined}>
            <span className={s.spinner} aria-hidden="true" />
            {t('project.phone.opening')}
          </span>
        </Button>
      </div>
    );
  }
  if (pairing.waiting) {
    return (
      <div className={s.pairing}>
        <div className={s.pairTitle}>{t('project.phone.pairName', { name: pairing.waiting.name })}</div>
        <div className={s.fingerprint} aria-label={t('project.phone.fingerprint', { fingerprint: pairing.waiting.fingerprint })}>
          {pairing.waiting.fingerprint}
        </div>
        <div className={s.dim}>{t('project.phone.samePictures')}</div>
        <div className={s.buttons}>
          <Button onClick={() => void client.api.companion['pair.cancel']()}>{t('project.phone.dontPair')}</Button>
          <Button variant="primary" onClick={() => void client.api.companion['pair.approve']()}>
            {t('project.phone.pair')}
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className={s.pairing}>
      <div className={s.qr}>
        <QrCode text={pairing.link} size={148} label={t('project.phone.scanLabel')} />
      </div>
      <div className={s.dim}>{t('project.phone.scanOrType')}</div>
      <div className={s.code}>{pairing.code}</div>
      <div className={s.dim}>{t('project.phone.worksOnce', { left: leftText(pairing.expiresAt, now) })}</div>
      <div className={s.buttons}>
        <Button onClick={() => void client.api.companion['pair.cancel']()}>{t('common.cancel')}</Button>
      </div>
    </div>
  );
}

/** The popover's line about the relay, only when it isn't ready (that's the news). */
function RelayLine() {
  const relay = useRelay();
  const said = relay === 'ready' ? undefined : relayText(relay);
  return said ? <div className={s.relayLine}>{said.text}</div> : null;
}

/** The sidebar footer's phone mark (only once a phone is paired, or while pairing one). */
export function PhoneMark() {
  const devices = useDevices();
  const pairing = usePairing();
  const now = useMinute();
  const t = useT();
  if (!devices.length && !pairing) return null;
  const { lit, title } = markOf(devices, now);
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" className={cx(s.mark, lit && s.lit)} title={title} aria-label={t('project.phone.yourPhoneTitle', { title })}>
          <Icon name="phone" size={14} />
          {lit ? <span className={s.markDot} aria-hidden="true" /> : null}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className={cx(p.card, s.card)} side="top" align="end" sideOffset={8} collisionPadding={10} aria-label={t('project.phone.yourPhone')}>
          <div className={s.head}>{t('project.phone.phone')}</div>
          <DeviceList now={now} />
          <RelayLine />
          <Pairing now={now} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Whether adb (Android platform-tools) is on this Mac — needed for Wireless debugging, screenshots and shell. */
function AdbLine() {
  const adb = useAdb();
  const t = useT();
  if (!adb) return null;
  const detail = adb.path
    ? t('project.phone.adbFound', { version: adb.version ?? '', computer: thisComputer() })
    : adb.fetching
      ? t('project.phone.adbFetching')
      : t('project.phone.adbMissing');
  return (
    <Row label={t('project.phone.adbOn', { computer: thisComputer() })} detail={detail}>
      {adb.path ? <span className={cx(s.relayDot, s.relayOk)} aria-label={t('project.phone.found')} /> : <span className={s.relayDot} aria-label={t('project.phone.notFound')} />}
    </Row>
  );
}

/**
 * A phone on this Mac's USB cable (BLG-190): what to switch on, said plainly (and shown on the phone
 * when its Beluga can), or pair it over the cable.
 */
function OnTheCable() {
  const { client } = useBeluga();
  const t = useT();
  const cable = useAdb()?.cable;
  const devices = useDevices();
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string>();
  if (!cable) return null;
  const linked = devices.find((d) => d.platform !== 'ios' && d.linked);
  const run = async (work: () => Promise<string | void>): Promise<void> => {
    setBusy(true);
    setSaid(undefined);
    try {
      setSaid((await work()) || undefined);
    } catch (err) {
      setSaid(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  // Developer options, or About phone when they aren't on yet (tap Build number seven times there).
  const showOnPhone = (): Promise<string> =>
    client.api.companion['phone.settings'](linked!.id, 'developer').then(
      () => t('project.phone.devOptionsOpen'),
      () => client.api.companion['phone.settings'](linked!.id, 'about').then(() => t('project.phone.aboutOpen')),
    );
  const name = cable.name;
  if (cable.state === 'no-debugging')
    return (
      <Row label={say('On the cable')} detail={said ?? t('project.phone.cableNoDebugging', { name })}>
        {linked ? (
          <Button size="small" disabled={busy} onClick={() => void run(showOnPhone)}>
            {t('project.phone.openOnPhone')}
          </Button>
        ) : (
          <span />
        )}
      </Row>
    );
  if (cable.state === 'unauthorized') return <Row label={say('On the cable')} detail={t('project.phone.cableUnauthorized', { name })}><span /></Row>;
  if (cable.canPair)
    return (
      <Row label={say('On the cable')} detail={said ?? t('project.phone.cableCanPair', { name, computer: thisComputer() })}>
        <Button size="small" disabled={busy} onClick={() => void run(() => client.api.companion['phone.pairCable']())}>
          {busy ? t('project.phone.opening') : t('project.phone.pairOverCable')}
        </Button>
      </Row>
    );
  return <Row label={say('On the cable')} detail={t('project.phone.cableReady', { name })}><span /></Row>;
}

/** Settings › Phone. */
export function PhoneSettings() {
  const now = useMinute();
  const t = useT();
  const cable = useAdb()?.cable;
  return (
    <>
      {cable ? (
        <Group title={say('On the cable')}>
          <OnTheCable />
        </Group>
      ) : null}
      <Group title={say('Your phones')}>
        <div className={s.inSettings}>
          <DeviceList now={now} />
        </div>
      </Group>
      {useDevices().some((d) => d.platform !== 'ios') ? (
        <Group title={say('Let your agent use your phone')}>
          <Row label={say('How it works')} detail={t('project.phone.howItWorksDetail', { computer: thisComputer() })}>
            <span />
          </Row>
          <AdbLine />
          <div className={s.inSettings}>
            <DeviceList now={now} control />
          </div>
        </Group>
      ) : null}
      {useDevices().length ? (
        <Group title={t('project.phone.reaching', { computer: yourComputer() })}>
          <Reaching />
        </Group>
      ) : null}
      <Group title={say('Pair a phone')}>
        <Row label={say('The Beluga app')} detail={t('project.phone.belugaAppDetail', { computer: yourComputer() })}>
          <span />
        </Row>
        <div className={s.inSettings}>
          <Pairing now={now} />
        </div>
      </Group>
    </>
  );
}
