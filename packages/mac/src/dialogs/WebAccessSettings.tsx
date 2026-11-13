import { useCallback, useEffect, useState } from 'react';
import type { BelugaClient } from '@beluga/ipc/client.js';
import { Icon } from '../components/Icon.js';
import { Button } from '../components/ui.js';
import { webServed } from '../lib/boot.js';
import { copyText } from '../lib/copy.js';
import { useClock } from '../lib/window-active.js';
import { useBeluga } from '../lib/beluga.js';
import { QrCode } from '../network/QrCode.js';
import { ago } from '../phone/phone-model.js';
import p from '../phone/phone.module.css';
import { Group, Row, Select, Switch } from './settings-controls.js';
import s from './settings.module.css';
import { say, useT } from '../lib/i18n.js';
import { t } from '@beluga/shared/i18n/index.js';
import { formatDateWith } from '@beluga/shared/i18n/format.js';

type WebApi = BelugaClient['api']['web'];
type Status = Awaited<ReturnType<WebApi['sessions.list']>>;
type Link = Awaited<ReturnType<WebApi['link']>>;
type Ways = Awaited<ReturnType<WebApi['ways']>>;
/** How browsers reach Beluga: this computer (and an SSH tunnel to it), the tailnet, or a public link. */
type Way = 'local' | 'tailscale' | 'public';

/** How often the list refreshes while it shows (last seen moves; a browser may join; a public address may move). */
const REFRESH_MS = 10_000;
const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));
const wayOf = (st: Status | undefined): Way => (st?.public ? 'public' : st?.tailscale ? 'tailscale' : 'local');

/** What each way means, under the choice. */
function wayDetail(way: Way, st: Status | undefined): string {
  if (way === 'tailscale') return st?.tailscale?.login ? t('prefs.web.tailscaleLogin', { login: st.tailscale.login }) : t('prefs.web.tailscale');
  if (way === 'public') return t('prefs.web.public');
  return t('prefs.web.local');
}

/**
 * Settings › Advanced › Web access (BLG-650, BLG-659): your whole Beluga in any browser, off until
 * you turn it on. One switch, then how browsers reach it: this computer only, your tailnet
 * (offered when Tailscale is installed and logged in) or a public link; a join link as a QR with
 * Copy; the browsers let in, each with Remove. A browser itself only sees the list: who gets in is
 * decided from the Mac app or `beluga web` (BLG-653).
 */
export function WebAccessSettings() {
  useT();
  const { client } = useBeluga();
  const [status, setStatus] = useState<Status>();
  const [ways, setWays] = useState<Ways>({});
  const [link, setLink] = useState<Link>();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const [now, setNow] = useState(Date.now());
  const manage = !webServed();

  const refresh = useCallback(() => {
    client.api.web['sessions.list']().then(
      (st) => {
        setStatus(st);
        setNow(Date.now());
      },
      (err: unknown) => setError(errorText(err)),
    );
  }, [client]);

  // Every REFRESH_MS while you're looking (the clock rests while the window is hidden), and at once when you look back.
  const tick = useClock(true, REFRESH_MS);
  useEffect(() => refresh(), [refresh, tick]);
  useEffect(() => {
    if (manage) void client.api.web.ways().then(setWays, () => undefined);
  }, [client, manage]);

  const run = async (doing: string, work: () => Promise<unknown>): Promise<void> => {
    setBusy(doing);
    setError(undefined);
    try {
      await work();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(undefined);
      refresh();
    }
  };

  const show = (next: Link | undefined): void => {
    setCopied(false);
    setLink(next);
  };

  const on = status?.on ?? false;
  const way = wayOf(status);

  const turn = (want: boolean): Promise<void> =>
    want
      ? run(t('prefs.web.opening'), async () => show(await client.api.web.link()))
      : run(t('prefs.web.closing'), async () => {
          show(undefined);
          await client.api.web.stop();
        });

  const choose = (next: Way): Promise<void> =>
    run(next === 'public' ? t('prefs.web.openingPublic') : next === 'tailscale' ? t('prefs.web.servingTailnet') : t('prefs.web.closingOthers'), async () => {
      show(undefined);
      if (way === 'tailscale' && next !== 'tailscale') await client.api.web.tailscale(false);
      if (way === 'public' && next !== 'public') await client.api.web.public(false);
      if (next === 'tailscale') show((await client.api.web.tailscale(true))?.link);
      else if (next === 'public') show((await client.api.web.public(true))?.link);
      else show(await client.api.web.link());
    });

  const newLink = (): Promise<void> => run(t('prefs.web.makingLink'), async () => show(await client.api.web.link(way === 'local' ? undefined : { via: way })));

  const live = link && link.expiresAt > now ? link : undefined;
  const sessions = status?.sessions ?? [];
  const address = way === 'tailscale' ? status?.tailscale?.url : way === 'public' ? status?.public?.url : status?.url;
  const reopening = way === 'public' && status?.public && status.public.state !== 'on';
  const options = [
    { value: 'local' as const, label: t('prefs.web.thisComputerOnly') },
    // i18n-ignore
    ...(ways.tailscale || way === 'tailscale' ? [{ value: 'tailscale' as const, label: 'Tailscale' }] : []),
    { value: 'public' as const, label: t('prefs.web.publicLink') },
  ];
  const intro = t('prefs.web.intro');
  return (
    <Group title={say('Web access')}>
      <Row label={say('Open Beluga in a browser')} detail={manage ? t('prefs.web.introManage', { intro }) : t('prefs.web.introRemote', { intro })}>
        {manage ? <Switch on={on} onChange={(v) => void turn(v)} label={say('Open Beluga in a browser')} /> : <span />}
      </Row>
      {manage && on ? (
        <>
          <Row label={say('Reached from')} detail={wayDetail(way, status)}>
            <Select label={t('prefs.web.howReach')} value={way} options={options} disabled={!!busy} onChange={(v) => void choose(v)} />
          </Row>
          {address ? (
            <Row label={say('Address')} detail={way === 'local' ? t('prefs.web.addressLocal') : t('prefs.web.addressLink')}>
              <code className={s.webLink} title={address}>
                {address}
              </code>
            </Row>
          ) : reopening ? (
            <Row label={say('Address')} detail={t('prefs.web.addressReopening')}>
              <span />
            </Row>
          ) : null}
          <Row label={say('Let a browser in')} detail={t('prefs.web.letInDetail')}>
            <Button variant={sessions.length ? 'plain' : 'primary'} icon="link" disabled={!!busy} onClick={() => void newLink()}>
              {t('prefs.web.newLink')}
            </Button>
          </Row>
        </>
      ) : null}
      {busy ? <div className={s.webBusy}>{busy}</div> : null}
      {manage && on && live ? (
        <div className={s.webQr}>
          <QrCode text={live.url} size={132} label={t('prefs.web.scanAria')} />
          <div className={s.webQrText}>
            <span>{t('prefs.web.openLink', { time: formatDateWith(live.expiresAt, { hour: 'numeric', minute: '2-digit' }) })}</span>
            <span className={s.pictureRow}>
              <code className={s.webLink} title={live.url}>
                {live.url}
              </code>
              <Button
                size="small"
                icon={copied ? 'check' : 'copy'}
                onClick={() =>
                  void copyText(live.url).then(
                    () => setCopied(true),
                    (err: unknown) => setError(errorText(err)),
                  )
                }
              >
                {copied ? t('prefs.web.copied') : t('prefs.web.copy')}
              </Button>
            </span>
          </div>
        </div>
      ) : null}
      {error ? <div className={p.error}>{error}</div> : null}
      <div className={p.inSettings}>
        <div className={p.devices} aria-label={t('prefs.web.browsersAria')} role="list">
          {sessions.length === 0 ? (
            <div className={p.empty}>{t('prefs.web.noBrowsers')}</div>
          ) : (
            sessions.map((b) => (
              <div key={b.id} className={p.device} role="listitem">
                <div className={p.deviceHead}>
                  <span className={p.deviceMark} aria-hidden="true">
                    <Icon name="globe" size={16} />
                  </span>
                  <span className={p.deviceText}>
                    <span className={p.deviceName}>{b.name}</span>
                    <span className={p.dim}>
                      {t('prefs.web.letInSeen', { created: ago(b.createdAt, now), seen: ago(b.lastSeenAt, now) })}
                    </span>
                  </span>
                  {manage ? (
                    <Button size="small" variant="quiet" disabled={!!busy} aria-label={t('prefs.web.removeName', { name: b.name })} onClick={() => void run(t('prefs.web.removing'), () => client.api.web['sessions.revoke'](b.id))}>
                      {t('prefs.web.remove')}
                    </Button>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </Group>
  );
}
