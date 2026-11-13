import { useEffect, useRef, useState } from 'react';
import type { InvitationView } from '@beluga/net/mesh/views.js';
import { Icon } from '../components/Icon.js';
import { Avatar, Button, cx } from '../components/ui.js';
import { inApp } from '../lib/boot.js';
import { copyText } from '../lib/copy.js';
import { useApp, useBeluga } from '../lib/beluga.js';
import { Sheet, useFlash } from '../dialogs/native/parts.js';
import { QrCode } from './QrCode.js';
import { acceptError, expiryLabel, findInvitation, openFriendInvitation, timeLeft } from './net-model.js';
import { closeNet } from './net-sheets.js';
import { errorText, openDm, openGroup, quietly, useSay } from './use-net.js';
import s from './network.module.css';
import { yourComputer } from '../lib/os-words.js';
import { useT } from '../lib/i18n.js';

/** A sentence whose `{name}` slot (said as \u0001) is drawn as a styled name. */
const withName = (text: string, name: string, className: string | undefined) => text.split('\u0001').flatMap((part, i) => (i ? [<span key={i} className={className}>{name}</span>, part] : [part]));

/** What's on the clipboard, if the window may read it (the app can; a browser may refuse). */
async function clipboardText(): Promise<string> {
  try {
    if (inApp()) {
      const { readText } = await import('@tauri-apps/plugin-clipboard-manager');
      return (await readText()) ?? '';
    }
    return (await navigator.clipboard?.readText?.()) ?? '';
  } catch {
    return '';
  }
}

/** A clock for "Expires in 12 minutes" (once a minute is enough). */
function useMinute(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/** The code in big letters, its dashes quieter. */
function Code({ code }: { code: string }) {
  const t = useT();
  return (
    <div className={s.code} aria-label={t('network.add.codeAria', { code })}>
      {code.split('-').map((part, i) => (
        <span key={i}>
          {i ? <span className={s.codeDash}>–</span> : null}
          {part}
        </span>
      ))}
    </div>
  );
}

/** Invite someone: one invitation (a code and a link), copyable, with when it ends and Cancel. */
function InviteHalf() {
  const t = useT();
  const { client } = useBeluga();
  const say = useSay();
  const now = useMinute();
  const invitations = useApp((st) => st.network.invitations);
  const friends = useApp((st) => st.network.friends);
  const open = openFriendInvitation(invitations, now);
  const [made, setMade] = useState<InvitationView>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [copied, flash] = useFlash();
  const opened = useRef(Date.now()).current;
  // Someone used it while the sheet is open: say who.
  const joined = friends.filter((f) => f.addedAt >= opened).at(-1);
  const shown = open ?? (made && invitations.some((i) => i.id === made.id) ? made : undefined);
  const create = async (): Promise<void> => {
    setBusy(true);
    setError(undefined);
    try {
      setMade(await quietly(client, client.api.network['friends.invite']()));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  const copy = (text: string, key: string, said: string): void =>
    void copyText(text).then(() => {
      flash(key);
      say(said);
    });
  const codeEnds = shown?.codeExpiresAt ?? shown?.expiresAt ?? 0;
  return (
    <section className={s.half} aria-label={t('network.add.invite')}>
      <h3 className={s.halfTitle}>
        <Icon name="link" size={13} />
        {t('network.add.invite')}
      </h3>
      <p className={s.halfText}>{t('network.add.inviteText')}</p>
      {joined && !shown ? (
        <div className={s.done}>
          <Avatar name={joined.name} id={joined.peerId} size={40} />
          <div>
            {withName(t('network.add.isFriendNow', { name: '\u0001' }), joined.name, s.doneName)}
          </div>
          <Button
            variant="primary"
            icon="chat"
            onClick={() => {
              closeNet();
              openDm(client, joined.peerId);
            }}
          >
            {t('network.conv.messageTo', { name: joined.name })}
          </Button>
        </div>
      ) : shown ? (
        <>
          <Code code={shown.code} />
          <div className={s.qrRow}>
            <div className={s.qr}>
              <QrCode text={shown.link} size={92} label={t('network.add.qrLabel')} />
            </div>
            <div className={s.qrSide}>
              <Button icon={copied === 'code' ? 'check' : 'copy'} onClick={() => copy(shown.code, 'code', t('network.add.copiedCode'))}>
                {copied === 'code' ? t('network.add.copied') : t('network.add.copyCode')}
              </Button>
              <Button icon={copied === 'link' ? 'check' : 'link'} onClick={() => copy(shown.link, 'link', t('network.add.copiedLink'))}>
                {copied === 'link' ? t('network.add.copied') : t('network.add.copyLink')}
              </Button>
            </div>
          </div>
          <div className={s.expiry} style={{ marginTop: 12 }}>
            <Icon name="clock" size={11} />
            {codeEnds <= now ? t('network.add.codeExpired', { left: timeLeft(shown.expiresAt, now) }) : codeEnds < shown.expiresAt ? t('network.add.codeAndLink', { code: timeLeft(codeEnds, now), link: timeLeft(shown.expiresAt, now) }) : expiryLabel(shown.expiresAt, now)}
          </div>
          <button type="button" className={s.cancelInvite} style={{ marginTop: 8 }} onClick={() => void client.api.network['friends.cancelInvite'](shown.id).then(() => setMade(undefined))}>
            {t('network.add.cancelInvitation')}
          </button>
        </>
      ) : (
        <div className={s.inviteStart}>
          <span className={s.inviteArt}>
            <Icon name="people" size={26} />
          </span>
          <Button variant="primary" disabled={busy} onClick={() => void create()}>
            {busy ? t('network.add.creating') : t('network.add.createInvitation')}
          </Button>
          {error ? (
            <div className={s.acceptError} role="alert">
              <Icon name="alert" size={12} />
              {error}
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

type Result = { readonly kind: 'friend'; readonly peerId: string; readonly name: string } | { readonly kind: 'group'; readonly groupId: string; readonly name: string; readonly status: 'joined' | 'waiting' };

/** Have a code or link: paste it (it pastes itself if one is on the clipboard), Add. */
function AcceptHalf({ preset, group }: { preset?: string; group?: boolean }) {
  const t = useT();
  const { client } = useBeluga();
  const [text, setText] = useState(preset ?? '');
  const [pasted, setPasted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<Result>();
  const field = useRef<HTMLInputElement>(null);
  const add = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (preset) return;
    let alive = true;
    void clipboardText().then((clip) => {
      const found = findInvitation(clip);
      if (!alive || !found || field.current?.value) return;
      setText(found.text);
      setPasted(true);
    });
    return () => {
      alive = false;
    };
  }, [preset]);
  const found = findInvitation(text);
  const submit = async (): Promise<void> => {
    if (!text.trim() || busy) return;
    if (!found) return setError(acceptError('isn’t a Beluga invitation')); // i18n-ignore: matched by acceptError, not shown
    setBusy(true);
    setError(undefined);
    try {
      setResult(await quietly(client, client.api.network['friends.accept'](found.text)));
    } catch (err) {
      setError(acceptError(errorText(err)));
    } finally {
      setBusy(false);
    }
  };
  if (result) {
    const go = (): void => {
      closeNet();
      if (result.kind === 'friend') openDm(client, result.peerId);
      else openGroup(client, result.groupId);
    };
    return (
      <section className={s.half} aria-label={t('network.add.haveCode')}>
        <div className={s.done}>
          {result.kind === 'friend' ? <Avatar name={result.name} id={result.peerId} size={40} /> : <Icon name="people" size={28} />}
          <div>
            {result.kind === 'friend' ? (
              <>{withName(t('network.add.friendsNow', { name: '\u0001' }), result.name, s.doneName)}</>
            ) : result.status === 'joined' ? (
              <>{withName(t('network.add.youreIn', { name: '\u0001' }), result.name, s.doneName)}</>
            ) : (
              <>{withName(t('network.add.askedToJoin', { name: '\u0001' }), result.name, s.doneName)}</>
            )}
          </div>
          {result.kind === 'group' && result.status === 'waiting' ? null : (
            <Button variant="primary" icon="chat" onClick={go}>
              {result.kind === 'friend' ? t('network.conv.messageTo', { name: result.name }) : t('network.add.openName', { name: result.name })}
            </Button>
          )}
        </div>
      </section>
    );
  }
  return (
    <section className={s.half} aria-label={t('network.add.haveCode')}>
      <h3 className={s.halfTitle}>
        <Icon name="plus" size={13} />
        {group ? t('network.add.joinAChannel') : t('network.add.haveCode')}
      </h3>
      <p className={s.halfText}>{group ? t('network.add.groupInvite') : t('network.add.pasteText')}</p>
      <form
        className={s.acceptField}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <input
          ref={field}
          autoFocus={!preset}
          className={cx(s.acceptInput, error && s.acceptInvalid)}
          value={text}
          placeholder={t('network.add.placeholder')}
          aria-label={t('network.add.codeOrLink')}
          spellCheck={false}
          autoComplete="off"
          disabled={busy}
          onChange={(e) => {
            setText(e.target.value);
            setPasted(false);
            setError(undefined);
          }}
        />
        {busy ? (
          <span className={s.busy}>
            <span className={s.spinner} />
            {t('network.add.reaching')}
          </span>
        ) : error ? (
          <div className={s.acceptError} role="alert">
            <Icon name="alert" size={12} />
            {error}
          </div>
        ) : pasted ? (
          <span className={s.pasted}>
            <Icon name="check" size={11} />
            {t('network.add.pasted')}
          </span>
        ) : null}
        <div className={s.acceptButtons}>
          <Button ref={add} autoFocus={Boolean(preset)} type="submit" variant={found ? 'primary' : 'plain'} disabled={!text.trim() || busy}>
            {group || found?.group ? t('network.add.joinChannel') : t('network.add.addFriend')}
          </Button>
        </div>
      </form>
    </section>
  );
}

/**
 * Add a Friend: invite someone (a code, a link and a QR code to send) beside using someone
 * else's. A beluga://add link opens it with the invitation filled in, ready to accept.
 */
export function AddFriendSheet({ accept }: { accept?: string }) {
  const t = useT();
  return (
    <Sheet
      title={t('network.add.title')}
      subtitle={t('network.add.subtitle', { computer: yourComputer() })}
      icon="people"
      close={closeNet}
      wide
      footer={
        <>
          <span className={s.dim}>
            <Icon name="lock" size={11} /> {t('network.add.e2e')}
          </span>
          <Button onClick={closeNet}>{t('common.done')}</Button>
        </>
      }
    >
      <div className={s.halves} style={{ marginTop: 6 }}>
        <InviteHalf />
        <AcceptHalf {...(accept ? { preset: accept } : {})} />
      </div>
    </Sheet>
  );
}

/** Join a group from its link: just the accepting half. */
export function JoinGroupSheet({ accept }: { accept: string }) {
  const t = useT();
  return (
    <Sheet title={t('network.add.joinTitle')} subtitle={t('network.add.joinSubtitle')} icon="people" close={closeNet}>
      <div style={{ margin: '0 -18px' }}>
        <AcceptHalf preset={accept} group />
      </div>
    </Sheet>
  );
}
