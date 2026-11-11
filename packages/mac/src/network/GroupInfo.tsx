import * as Popover from '@radix-ui/react-popover';
import { type ReactNode, useEffect, useState } from 'react';
import type { GroupView, MemberView } from '@beluga/net/mesh/views.js';
import { Alert } from '../components/Alert.js';
import { Icon } from '../components/Icon.js';
import { type ActionItem, ActionsContext, ActionsDropdown } from '../components/SpecMenu.js';
import { Avatar, Button, Tip } from '../components/ui.js';
import { copyText } from '../lib/copy.js';
import { useApp, useBeluga } from '../lib/beluga.js';
import { Choice, useFlash } from '../dialogs/native/parts.js';
import { AvatarStack, GroupAvatar, PersonAvatar } from './Avatars.js';
import { expiryLabel, openGroupInvitation, presenceLine, shownState, sortMembers } from './net-model.js';
import { closeNet, openNet, useNetSheet } from './net-sheets.js';
import { openDm, useSay } from './use-net.js';
import { t } from '@beluga/shared/i18n/index.js';
import { useT } from '../lib/i18n.js';
import s from './network.module.css';

type Confirm = { readonly title: string; readonly message: string; readonly confirm: string; readonly run: () => void };

/** The group's name, renamed in place (anyone in the group may rename it). */
function Name({ g }: { g: GroupView }) {
  const t = useT();
  const { client } = useBeluga();
  const [name, setName] = useState(g.name);
  useEffect(() => setName(g.name), [g.name]);
  const save = (): void => {
    const next = name.trim();
    if (!next) return setName(g.name);
    if (next !== g.name) void client.api.network['groups.rename'](g.id, next);
  };
  return (
    <input
      className={s.rename}
      aria-label={t('network.group.channelName')}
      value={name}
      maxLength={64}
      disabled={!g.active}
      title={g.active ? t('network.group.clickRename') : undefined}
      onChange={(e) => setName(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          e.stopPropagation();
          setName(g.name);
        }
      }}
    />
  );
}

function memberItems(g: GroupView, m: MemberView, ctx: { friend: boolean; message: () => void; confirm: (c: Confirm) => void; setAdmin: (on: boolean) => void }): ActionItem[] {
  if (m.self) return [];
  return [
    ...(ctx.friend ? [{ label: t('network.sidebar.message'), icon: 'chat' as const, onSelect: ctx.message }] : []),
    ...(g.admin && g.active
      ? [
          { label: m.admin ? t('network.group.removeAdmin') : t('network.group.makeAdmin'), icon: 'person' as const, separate: ctx.friend, onSelect: () => ctx.setAdmin(!m.admin) },
          {
            label: t('network.sidebar.remove', { name: m.name }),
            danger: true,
            separate: true,
            onSelect: () => ctx.confirm({ title: t('network.sheets.removeMemberTitle', { name: m.name, group: g.name }), message: t('network.sheets.removeMemberMsg', { name: m.name }), confirm: t('network.sheets.remove'), run: () => void 0 }),
          },
        ]
      : []),
  ];
}

/** Who's in the group: you first, then admins, then everyone else, each with a menu. */
function Members({ g, confirm }: { g: GroupView; confirm: (c: Confirm) => void }) {
  const t = useT();
  const { client } = useBeluga();
  const friends = useApp((st) => st.network.friends);
  const api = client.api.network;
  return (
    <div className={s.infoSection}>
      <div className={s.infoSectionHead}>
        <span>{t('network.group.members', { count: g.members.length })}</span>
        {g.admin && g.active ? (
          <button type="button" onClick={() => openNet({ kind: 'add_people', groupId: g.id })}>
            {t('network.sidebar.addPeople')}
          </button>
        ) : null}
      </div>
      {sortMembers(g.members).map((m) => {
        const items = memberItems(g, m, {
          friend: friends.some((f) => f.peerId === m.peerId),
          message: () => {
            closeNet();
            openDm(client, m.peerId);
          },
          confirm: (c) => confirm({ ...c, run: () => void api['groups.removeMember'](g.id, m.peerId) }),
          setAdmin: (on) => void api['groups.setAdmin'](g.id, m.peerId, on),
        });
        const row = (
          <button type="button" className={s.member} aria-label={`${m.self ? t('network.conv.you') : m.name}${m.admin ? t('network.group.adminSuffix') : ''}`} disabled={!items.length}>
            <PersonAvatar name={m.name} id={m.peerId} state={m.self ? undefined : shownState(m)} size={28} />
            <span className={s.memberText}>
              <span className={s.memberName}>{m.self ? t('network.group.selfName', { name: m.name }) : m.name}</span>
              {m.self ? null : <span className={s.memberLine}>{presenceLine(m)}</span>}
            </span>
            {m.admin ? <span className={s.admin}>{t('network.group.admin')}</span> : null}
            {items.length ? <Icon name="more" size={14} /> : null}
          </button>
        );
        return items.length ? (
          <ActionsContext key={m.peerId} items={items}>
            <span>
              <ActionsDropdown items={items}>{row}</ActionsDropdown>
            </span>
          </ActionsContext>
        ) : (
          <div key={m.peerId}>{row}</div>
        );
      })}
    </div>
  );
}

/** People who used the group's link and wait for an admin: Approve or Decline. */
function Requests({ g }: { g: GroupView }) {
  const t = useT();
  const { client } = useBeluga();
  if (!g.admin || !g.requests.length) return null;
  return (
    <div className={s.infoSection}>
      <div className={s.infoSectionHead}>
        <span>{t('network.group.asking')}</span>
      </div>
      {g.requests.map((r) => (
        <div key={r.peerId} className={s.request}>
          <Avatar name={r.name} id={r.peerId} size={24} />
          <span>{r.name}</span>
          <Button size="small" variant="quiet" onClick={() => void client.api.network['groups.decline'](g.id, r.peerId)}>
            {t('network.group.decline')}
          </Button>
          <Button size="small" variant="primary" onClick={() => void client.api.network['groups.approve'](g.id, r.peerId)}>
            {t('network.splans.approve')}
          </Button>
        </div>
      ))}
    </div>
  );
}

/** Group invitations made to let anyone with the link in (the rest ask an admin). */
const autoLinks = new Set<string>();

/** An invite link for the group (admins): approve each request, or let anyone with it in; Copy. */
function InviteLink({ g }: { g: GroupView }) {
  const t = useT();
  const { client } = useBeluga();
  const say = useSay();
  const invitations = useApp((st) => st.network.invitations);
  const open = openGroupInvitation(invitations, g.id);
  const [copied, flash] = useFlash();
  const [busy, setBusy] = useState(false);
  if (!g.admin || !g.active) return null;
  const api = client.api.network;
  const make = async (auto: boolean): Promise<void> => {
    setBusy(true);
    try {
      if (open) await api['friends.cancelInvite'](open.id);
      const made = await api['groups.invite'](g.id, { auto });
      if (auto) autoLinks.add(made.id);
    } finally {
      setBusy(false);
    }
  };
  // The invitation doesn't say how it lets people in; this window remembers what you chose.
  const mode: 'ask' | 'auto' = open && autoLinks.has(open.id) ? 'auto' : 'ask';
  return (
    <div className={s.infoSection}>
      <div className={s.infoSectionHead}>
        <span>{t('network.group.inviteLink')}</span>
      </div>
      {open ? (
        <>
          <div className={s.linkBox}>
            <code className="selectable" title={open.link}>
              {open.link}
            </code>
            <Button
              size="small"
              icon={copied === 'link' ? 'check' : 'copy'}
              onClick={() =>
                void copyText(open.link).then(() => {
                  flash('link');
                  say(t('network.sidebar.copiedInvite', { name: g.name }));
                })
              }
            >
              {copied === 'link' ? t('network.add.copied') : t('network.conv.copy')}
            </Button>
          </div>
          <div className={s.toggleRow}>
            <div>
              <Choice<'ask' | 'auto'>
                label={t('network.group.whoGetsIn')}
                value={mode}
                wide
                onChange={(v) => void make(v === 'auto')}
                options={[
                  { value: 'ask', label: t('network.group.approveEach') },
                  { value: 'auto', label: t('network.group.anyoneLink') },
                ]}
              />
            </div>
          </div>
          <div className={s.dim} style={{ margin: '6px 2px 0' }}>
            {mode === 'auto' ? t('network.group.autoNote', { expiry: expiryLabel(open.expiresAt) }) : t('network.group.askNote', { expiry: expiryLabel(open.expiresAt) })}
          </div>
        </>
      ) : (
        <Button icon="link" disabled={busy} onClick={() => void make(false)}>
          {t('network.group.createLink')}
        </Button>
      )}
    </div>
  );
}

/** The group's info, beside its header: name, members, join requests, invite link, Leave. */
export function GroupInfo({ g, children }: { g: GroupView; children: ReactNode }) {
  const t = useT();
  const { client } = useBeluga();
  const sheet = useNetSheet();
  const open = sheet?.kind === 'group_info' && sheet.groupId === g.id;
  const [confirm, setConfirm] = useState<Confirm>();
  return (
    <>
      <Popover.Root open={open} onOpenChange={(v) => (v ? openNet({ kind: 'group_info', groupId: g.id }) : closeNet())}>
        <Tip label={t('network.group.infoTip')}>
          <Popover.Trigger asChild>{children}</Popover.Trigger>
        </Tip>
        <Popover.Portal>
          <Popover.Content className={s.info} side="bottom" align="end" sideOffset={6} collisionPadding={12} aria-label={t('network.group.about', { name: g.name })} onOpenAutoFocus={(e) => (e.preventDefault(), (e.currentTarget as HTMLElement | null)?.focus())} onInteractOutside={(e) => confirm && e.preventDefault()}>
            <div className={s.infoHead}>
              <GroupAvatar name={g.name} id={g.id} size={56} muted={!g.active} />
              <Name g={g} />
              <div className={s.infoSub}>{g.active ? (g.admin ? t('network.group.youreAdmin') : t('network.group.kept')) : t('network.group.noLonger')}</div>
            </div>
            <Requests g={g} />
            <Members g={g} confirm={setConfirm} />
            <InviteLink g={g} />
            {g.active ? (
              <div className={s.infoFooter}>
                <button type="button" className={s.leave} onClick={() => openNet({ kind: 'leave_group', groupId: g.id })}>
                  {t('network.sidebar.leaveChannel')}
                </button>
              </div>
            ) : (
              <div className={s.infoFooter}>
                <button type="button" className={s.leave} onClick={() => openNet({ kind: 'delete_group', groupId: g.id })}>
                  {t('network.sidebar.deleteChannel')}
                </button>
              </div>
            )}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {confirm ? (
        <Alert
          title={confirm.title}
          message={confirm.message}
          tone="danger"
          confirm={{
            label: confirm.confirm,
            destructive: true,
            onClick: () => {
              setConfirm(undefined);
              confirm.run();
            },
          }}
          onCancel={() => setConfirm(undefined)}
        />
      ) : null}
    </>
  );
}

/** The group header's button: a few members' faces and how many there are. */
export function MembersButton({ g }: { g: GroupView }) {
  const t = useT();
  const others = g.members.filter((m) => !m.self);
  return (
    <GroupInfo g={g}>
      <button type="button" className={s.headerStack} aria-label={t('network.group.membersButton', { name: g.name, count: g.members.length })}>
        <AvatarStack people={others.length ? others : g.members} size={22} />
        {g.members.length}
      </button>
    </GroupInfo>
  );
}
