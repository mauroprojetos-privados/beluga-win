import * as Dropdown from '@radix-ui/react-dropdown-menu';
import { type ReactNode, useState } from 'react';
import type { Guest } from '@beluga/core/collab-store.js';
import { TRUST_INFO, canRunOn, trustOf } from '@beluga/core/trust.js';
import { type GuestCan, type PeerInfo, type ProviderUsage, defaultAgentOf } from '@beluga/protocol.js';
import { usagesOf } from '@beluga/agent/usage.js';
import { windowsOf } from '@beluga/ui/usage-cards.js';
import { agentName } from '@beluga/shared/agent-label.js';
import { agentMark } from '@beluga/shared/agent-marks.js';
import { CAN_INFO } from '@beluga/shared/invites.js';
import type { TrustLevel } from '@beluga/shared/settings-schema.js';
import { CAN_ORDER } from '@beluga/ui/invite-menus.js';
import type { MenuKind } from '@beluga/ui/menus.js';
import { Icon, type IconName } from '../../components/Icon.js';
import { ZoomAvatar } from '../../components/ZoomAvatar.js';
import { cx } from '../../components/ui.js';
import { useActions } from '../../lib/actions.js';
import { useApi, useApp, useBeluga } from '../../lib/beluga.js';
import { Select } from '../settings-controls.js';
import { resetsAt } from '../../views/usage/usage-model.js';
import type { Confirm } from './PersonPopover.js';
import { Choice, Tag, optionIndex } from './parts.js';
import { addressTo } from './PeerSheets.js';
import { presetShareWith } from './ShareFolderSheet.js';
import { offerSent } from '../../network/net-model.js';
import { befriend, openFriendCard } from '../../network/use-net.js';
import m from '../../components/SpecMenu.module.css';
import p from './person.module.css';
import { thisComputer } from '../../lib/os-words.js';
import { t } from '@beluga/shared/i18n/index.js';
import { useT } from '../../lib/i18n.js';

interface CardProps {
  readonly peer: PeerInfo;
  readonly close: () => void;
  readonly confirm: (c: Confirm) => void;
  /** Show the Run a Command sheet (instead of the card). */
  readonly onRun?: () => void;
}

/** What a friend's trust lets you do on their side, in a line. */
const GRANTED = (): Record<TrustLevel, string> => ({
  blocked: t('native.person.grantedBlocked'),
  ask: t('native.person.grantedAsk'),
  trusted: t('native.person.grantedTrusted'),
  full: t('native.person.grantedFull'),
});

/** Run a person-menu option by its id. */
function usePick(menu: MenuKind) {
  const { client } = useBeluga();
  const actions = useActions();
  return (id: string): void => {
    const i = optionIndex(client.store.getState(), menu, id);
    if (i >= 0) actions.pick(menu, i);
  };
}

function Head({ peer, tags, lines, title }: { peer: PeerInfo; tags: ReactNode; lines: ReadonlyArray<string | undefined>; title?: ReactNode }) {
  return (
    <div className={p.head}>
      <ZoomAvatar name={peer.name} id={peer.peerId} size={44} />
      <div className={p.who}>
        {title ?? <div className={p.name}>{peer.name}</div>}
        <div className={p.tags}>{tags}</div>
        {lines.filter(Boolean).map((l) => (
          <div key={l} className={p.line}>
            {l}
          </div>
        ))}
      </div>
    </div>
  );
}

/** What they're happy to be asked for (their "Ask me for…" note), when they've written one. */
export function AskMeFor({ peerId, name }: { peerId: string; name: string }) {
  const note = useApp((st) => st.gateway.cards[peerId]?.note?.trim());
  const t = useT();
  if (!note) return null;
  return (
    <div className={p.block}>
      <div className={p.blockLabel}>{t('native.person.askFor', { name })}</div>
      <div className={cx(p.blockDetail, p.note)}>{note}</div>
    </div>
  );
}

/** A round button with its name under it (like a contact card's). */
export function Action({ icon, label, onClick, on }: { icon: IconName; label: string; onClick: () => void; on?: boolean }) {
  return (
    <button type="button" className={cx(p.action, on && p.actionOn)} onClick={onClick} aria-pressed={on}>
      <span className={p.actionIcon}>
        <Icon name={icon} size={15} />
      </span>
      <span className={p.actionLabel}>{label}</span>
    </button>
  );
}

function Row({ icon, label, onClick, danger }: { icon: IconName; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" className={cx(p.row, danger && p.danger)} onClick={onClick}>
      <Icon name={icon} size={13} />
      <span>{label}</span>
    </button>
  );
}

/** "Codex on", its mark before its name. */
function AgentOn({ peer }: { peer: PeerInfo }) {
  const agent = defaultAgentOf(peer);
  const t = useT();
  return (
    <span className={p.agentOn}>
      <Icon name={agentMark(agent)} size={10} />
      {t('native.person.agentOn', { agent: agentName(agent) })}
    </span>
  );
}

/** One plan window: what's left of it, and when it resets. */
function Meter({ label, pct, resets }: { label: string; pct: number; resets?: string }) {
  const left = Math.max(0, 100 - pct);
  const t = useT();
  return (
    <div className={p.meter}>
      <span>{label}</span>
      <span className={p.bar} role="meter" aria-label={t('native.person.meterAria', { label, left })} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <span style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} className={pct >= 85 ? p.barHot : undefined} />
      </span>
      <span className={p.pct}>{t('native.person.left', { left })}</span>
      {resets ? <span className={p.resets}>{t('native.person.resets', { when: resets })}</span> : null}
    </div>
  );
}

/** "max" → "Max". */
const planName = (plan: string): string => plan.charAt(0).toUpperCase() + plan.slice(1);

/**
 * Someone's plans (BLG-597): for each provider they run (Claude, Codex…), how much of each window
 * is left and when it resets. Nothing shared: nothing drawn.
 */
export function PlanUsage({ usages }: { usages: readonly ProviderUsage[] | undefined }) {
  const now = Date.now();
  const t = useT();
  const shown = (usages ?? []).map((u) => ({ u, windows: windowsOf(u) })).filter((x) => x.windows.length);
  if (!shown.length) return null;
  return (
    <div className={p.usage}>
      {shown.map(({ u, windows }) => (
        <div key={u.agent.runtime} className={p.usageProvider} role="group" aria-label={t('native.person.planUsage', { agent: agentName(u.agent) })}>
          <div className={p.usageHead}>
            <Icon name={agentMark(u.agent)} size={11} />
            <span>{agentName(u.agent)}</span>
            {u.plan ? <span className={p.usagePlan}>{planName(u.plan)}</span> : null}
          </div>
          {windows.map((w) => (
            <Meter key={w.label} label={w.label} pct={w.pct} {...(w.resetsAt && w.resetsAt > now ? { resets: resetsAt(w.resetsAt, now) } : {})} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** A room peer's plans: what their room profile says, else what their card told you (a friend's). */
function UsageMeters({ peer }: { peer: PeerInfo }) {
  const card = useApp((st) => st.gateway.cards[peer.peerId]?.usages);
  const own = usagesOf(peer);
  return <PlanUsage usages={own.length ? own : card} />;
}

/**
 * Someone in your room (not a guest): what you do together there, their trust as a line (it's set
 * on their friend card, BLG-202), and (for the host) removing them.
 */
export function RoomPeerCard({ peer, menu, close, confirm, onRun }: CardProps & { menu: Extract<MenuKind, { kind: 'person' }> }) {
  const actions = useActions();
  const { client, ui } = useBeluga();
  const address = (claude: boolean): void => addressTo(ui, actions, client.store.getState().view, { peerId: peer.peerId, name: peer.name, claude });
  const pick = usePick(menu);
  const trust = useApp((st) => trustOf(st, peer.peerId));
  const friend = useApp((st) => st.network.friends.some((f) => f.peerId === peer.peerId));
  const asked = useApp((st) => offerSent(st.network.offers, peer.peerId));
  const grant = useApp((st) => st.granted[peer.peerId]);
  const following = useApp((st) => st.follow === peer.peerId);
  const host = useApp((st) => st.self?.host === true);
  const t = useT();
  const share = peer.shares[0];
  return (
    <>
      <Head
        peer={peer}
        tags={
          <>
            {peer.host ? <Tag tone="accent">{t('native.person.host')}</Tag> : null}
            <Tag tone={peer.agent ? 'claude' : 'muted'}>{peer.agent ? <AgentOn peer={peer} /> : t('native.person.noAgent')}</Tag>
            {following ? <Tag>{t('native.person.following')}</Tag> : null}
          </>
        }
        lines={[peer.shares.length ? t('native.person.shares', { names: peer.shares.map((x) => x.name).join(', ') }) : t('native.person.sharesNothing'), grant ? GRANTED()[grant.level] : undefined]}
      />
      <UsageMeters peer={peer} />
      <div className={p.actions}>
        <Action icon="chat" label={t('native.person.message')} onClick={() => address(false)} />
        {peer.agent ? <Action icon={agentMark(defaultAgentOf(peer))} label={t('native.person.askAgent', { agent: agentName(defaultAgentOf(peer)) })} onClick={() => address(true)} /> : null}
        {canRunOn(grant?.level) && onRun ? <Action icon="terminal" label={t('native.person.run')} onClick={onRun} /> : null}
        <Action icon="eye" label={following ? t('native.person.following') : t('native.person.follow')} on={following} onClick={() => pick(following ? 'unfollow' : 'follow')} />
        {share ? <Action icon="folder" label={t('native.person.files')} onClick={() => pick('browse')} /> : null}
      </div>
      <AskMeFor peerId={peer.peerId} name={peer.name} />
      <div className={p.block}>
        <div className={p.blockLabel}>{t('native.person.trust')}</div>
        <div className={p.blockDetail}>
          <strong>{TRUST_INFO[trust].label}.</strong> {TRUST_INFO[trust].detail}
        </div>
        <div className={p.blockDetail}>
          {friend ? (
            <button
              type="button"
              className={p.linkButton}
              onClick={() => {
                close();
                openFriendCard(client, peer.peerId);
              }}
            >
              {t('native.person.changeInCard')}
            </button>
          ) : asked ? (
            t('native.person.requestSent')
          ) : (
            <button type="button" className={p.linkButton} onClick={() => void befriend(client, peer.peerId, peer.name)}>
              {t('native.person.addFriend', { name: peer.name })}
            </button>
          )}
        </div>
      </div>
      <div className={p.rows}>
        <Row icon="branch" label={t('native.person.inviteToWorkspace')} onClick={() => pick('person-invite-ws')} />
        <Row
          icon="share"
          label={t('native.person.shareFolderWith', { name: peer.name })}
          onClick={() => {
            presetShareWith(peer.peerId);
            pick('person-share');
          }}
        />
        {peer.projects?.length ? <Row icon="branch" label={t('native.person.startRemote', { name: peer.name })} onClick={() => pick('person-remote-ws')} /> : null}
        {host ? (
          <Row
            icon="x"
            danger
            label={t('native.person.removeFromRoom')}
            onClick={() => confirm({ title: t('native.person.removeTitle', { name: peer.name }), message: t('native.person.removeRoomMessage', { name: peer.name }), confirm: t('native.person.remove'), run: () => pick('person-remove') })}
          />
        ) : null}
      </div>
    </>
  );
}

/** Someone who came in with a link: what they can do, where, and giving them more (or less). */
export function GuestCard({ peer, guest, close, confirm }: CardProps & { guest: Guest }) {
  const api = useApi();
  const t = useT();
  const projects = useApp((st) => st.projects).filter((x) => x.root);
  const name = (id: string): string => projects.find((x) => x.id === id)?.name ?? t('native.person.aProject');
  const more = projects.filter((x) => !guest.projects.includes(x.id));
  return (
    <>
      <Head peer={peer} tags={<Tag tone="warn">{t('native.person.guest')}</Tag>} lines={[guest.room ? t('native.person.guestEverything') : t('native.person.guestLink')]} />
      <div className={p.block}>
        <div className={p.blockLabel}>{t('native.person.hasAccessTo')}</div>
        <div className={p.chips}>
          {guest.room ? <Tag tone="accent">{t('native.invite.everything')}</Tag> : guest.projects.map((id) => <Tag key={id}>{name(id)}</Tag>)}
          {!guest.room && more.length ? (
            <Dropdown.Root modal={false}>
              <Dropdown.Trigger asChild>
                <button type="button" className={p.addChip} aria-label={t('native.person.addToProject')}>
                  <Icon name="plus" size={10} /> {t('native.person.add')}
                </button>
              </Dropdown.Trigger>
              <Dropdown.Portal>
                <Dropdown.Content className={m.menu} align="start" sideOffset={4}>
                  {more.map((x) => (
                    <Dropdown.Item key={x.id} className={m.item} onSelect={() => void api.invites.change(peer.peerId, { addProject: x.id })}>
                      <span className={m.label}>{x.name}</span>
                    </Dropdown.Item>
                  ))}
                  <Dropdown.Separator className={m.separator} />
                  <Dropdown.Item className={m.item} onSelect={() => void api.invites.change(peer.peerId, { room: true })}>
                    <span className={m.label}>{t('native.invite.everything')}</span>
                    <span className={m.hint}>{t('native.person.everythingHint')}</span>
                  </Dropdown.Item>
                </Dropdown.Content>
              </Dropdown.Portal>
            </Dropdown.Root>
          ) : null}
        </div>
      </div>
      <div className={p.block}>
        <div className={p.blockLabel}>{t('native.person.nameCan', { name: peer.name })}</div>
        <Choice<GuestCan> wide label={t('native.person.nameCan', { name: peer.name })} value={guest.can} options={CAN_ORDER.map((c) => ({ value: c, label: CAN_INFO[c].label }))} onChange={(can) => void api.invites.change(peer.peerId, { can })} />
        <div className={p.blockDetail}>{CAN_INFO[guest.can].detail.charAt(0).toUpperCase() + CAN_INFO[guest.can].detail.slice(1)}.</div>
      </div>
      <div className={p.rows}>
        <Row
          icon="x"
          danger
          label={t('native.person.removeName', { name: peer.name })}
          onClick={() =>
            confirm({
              title: t('native.person.removeTitle', { name: peer.name }),
              message: t('native.person.removeGuestMessage'),
              confirm: t('native.person.remove'),
              run: () => {
                void api.invites.remove(peer.peerId);
                close();
              },
            })
          }
        />
      </div>
    </>
  );
}

/** You: your name (edit it here), your Claude and who may use it. */
export function AccountCard({ peer, menu, close, confirm }: CardProps & { menu: Extract<MenuKind, { kind: 'person' }> }) {
  const api = useApi();
  const actions = useActions();
  const { client, ui } = useBeluga();
  const pick = usePick(menu);
  const room = useApp((st) => st.room);
  const host = useApp((st) => st.self?.host === true);
  const policy = useApp((st) => st.policy);
  const t = useT();
  const [name, setName] = useState(peer.name);
  const rename = (): void => {
    const next = name.trim();
    if (next && next !== peer.name) void api.session.rename(next);
    else setName(peer.name);
  };
  return (
    <>
      <Head
        peer={peer}
        title={
          <input
            className={p.nameInput}
            value={name}
            aria-label={t('native.person.yourName')}
            maxLength={32}
            spellCheck={false}
            onChange={(e) => setName(e.target.value.replace(/[^\w.-]/g, ''))}
            onBlur={rename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
          />
        }
        tags={
          <>
            <Tag>{host ? t('native.person.youHost', { room }) : t('native.person.youreIn', { room })}</Tag>
            <Tag tone={peer.agent ? 'claude' : 'muted'}>{peer.agent ? <AgentOn peer={peer} /> : t('native.person.noAgent')}</Tag>
          </>
        }
        lines={[t('native.person.howFriendsSee')]}
      />
      <UsageMeters peer={peer} />
      <div className={p.block}>
        <div className={p.inline}>
          <span className={p.blockLabel}>{t('native.person.friendsMayUse')}</span>
          <Select
            label={t('native.person.friendsMayUse')}
            value={policy}
            onChange={(v) => void api.session.setClaudeSharing(v)}
            options={[
              { value: 'ask', label: t('native.person.policyAsk') },
              { value: 'auto', label: t('native.person.policyAuto') },
              { value: 'deny', label: t('native.person.policyDeny') },
            ]}
          />
        </div>
        <div className={p.blockDetail}>{t('native.person.policyDetail')}</div>
      </div>
      <div className={p.rows}>
        <Row icon="claude" label={t('native.person.askMyAgent', { agent: agentName(defaultAgentOf(peer)) })} onClick={() => addressTo(ui, actions, client.store.getState().view, { peerId: peer.peerId, name: peer.name, claude: true, self: true })} />
        <Row icon="share" label={t('native.person.shareFolder')} onClick={() => pick('share-folder')} />
        <Row
          icon="gear"
          label={t('native.person.settings')}
          onClick={() => {
            close();
            ui.patch({ settings: 'general' });
          }}
        />
        {host ? null : <Row icon="x" danger label={t('native.person.leaveRoom')} onClick={() => confirm({ title: t('native.person.leaveTitle', { room }), message: t('native.person.leaveMessage', { computer: thisComputer() }), confirm: t('native.person.leave'), run: () => pick('leave-room') })} />}
      </div>
    </>
  );
}

