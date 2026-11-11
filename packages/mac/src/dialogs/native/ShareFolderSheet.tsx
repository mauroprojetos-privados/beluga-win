import { baseName as lastPart, isAbsolutePath } from '@beluga/shared/os-path.js';
import { useState } from 'react';
import type { MyShare } from '@beluga/core/store.js';
import { Icon } from '../../components/Icon.js';
import { Avatar, Button, cx } from '../../components/ui.js';
import { canPickFolders, inApp } from '../../lib/boot.js';
import { toast, useApi, useApp, useBeluga } from '../../lib/beluga.js';
import { pickFolders } from '../../lib/projects.js';
import type { MenuKind } from '@beluga/ui/menus.js';
import { Check, Choice, Field, Section, Sheet, Tag, tilde } from './parts.js';
import s from './sharing.module.css';
import f from './share.module.css';
import { useT } from '../../lib/i18n.js';

type Who = 'all' | 'some';

// "Share a folder with bob…" opens this sheet with bob already ticked.
let preset: readonly string[] | undefined;

/** The next Share a Folder sheet starts with only these people ticked. */
export function presetShareWith(...peerIds: string[]): void {
  preset = peerIds;
}

const norm = (p: string): string => (p.length > 1 && !/^[A-Za-z]:[\\/]$/.test(p) ? p.replace(/[\\/]+$/, '') : p);
const baseName = (p: string): string => lastPart(p) || p;
/** A long path with its middle left out: "/private/var/…/beluga-demo-4y/landing". */
const shortPath = (p: string): string => (p.length > 56 ? `${p.slice(0, 18)}…${p.slice(-36)}` : p);

/**
 * Share a folder: pick it (the Open panel, a project, or a path), who sees it, and whether your
 * Claude may edit there. What you share now is listed underneath, each one click to stop.
 */
export function ShareFolderSheet({ menu, close }: { readonly menu: Extract<MenuKind, { kind: 'share_folder' | 'share_who' }>; readonly close: () => void }) {
  const api = useApi();
  const t = useT();
  const { client } = useBeluga();
  const home = useApp((st) => st.home);
  const selfId = useApp((st) => st.selfId);
  const peers = useApp((st) => st.peers);
  const friends = useApp((st) => st.network.friends);
  const projects = useApp((st) => st.projects);
  const mine = useApp((st) => st.myShares);
  const inRoom = peers.filter((p) => p.peerId !== selfId);
  // The room's people and your friends: friends get it over the network, with no room needed.
  const people = [...inRoom.map((p) => ({ peerId: p.peerId, name: p.name, friend: friends.some((f) => f.peerId === p.peerId) })), ...friends.filter((f) => !inRoom.some((p) => p.peerId === f.peerId)).map((f) => ({ peerId: f.peerId, name: f.name, friend: true }))];
  const [path, setPath] = useState(() => (menu.kind === 'share_who' ? tilde(home, menu.dir) : ''));
  const [who, setWho] = useState<Who>(() => (preset?.length || !inRoom.length ? 'some' : 'all'));
  const [only, setOnly] = useState<ReadonlySet<string>>(() => {
    const picked = new Set(preset ?? []);
    preset = undefined;
    return picked;
  });
  const [writable, setWritable] = useState(false);
  // A folder picked (Open panel, a project, a shared one) shows as a folder; typing a path is the other way.
  const [typing, setTyping] = useState(() => menu.kind !== 'share_who');
  const pickPath = (p: string): void => {
    setPath(tilde(home, p));
    setTyping(false);
  };
  const dir = path.trim() === '~' ? home : /^~[\\/]/.test(path.trim()) ? `${home}${path.trim().slice(1)}` : path.trim();
  const existing = mine.find((x) => norm(x.root) === norm(dir));
  const ready = isAbsolutePath(dir) && (who === 'all' || only.size > 0);
  const suggestions = projects.filter((p) => p.root && !mine.some((x) => norm(x.root) === norm(p.root))).slice(0, 8);
  const nameOf = (id: string): string => people.find((p) => p.peerId === id)?.name ?? t('native.shareFolder.someoneWhoLeft');

  const choose = async (): Promise<void> => {
    const picked = await pickFolders(t('native.shareFolder.choosePrompt'));
    if (picked?.[0]) pickPath(picked[0]);
  };
  const edit = (x: MyShare): void => {
    pickPath(x.root);
    setWho(x.private ? 'some' : 'all');
    setOnly(new Set(x.allowed ?? []));
    setWritable(Boolean(x.writable));
  };
  const share = (): void => {
    if (!ready) return;
    api.session.shareFolder(dir, writable, who === 'some' ? [...only] : undefined).then(
      // Shared (it's in the list now): ready for the next one. Otherwise Beluga said why.
      () => {
        if (!client.store.getState().myShares.some((x) => norm(x.root) === norm(dir))) return;
        setPath('');
        setTyping(true);
      },
      (err: unknown) => toast(client, err instanceof Error ? err.message : String(err), 'error'),
    );
  };
  const toggle = (id: string, on: boolean): void => setOnly((x) => (on ? new Set([...x, id]) : new Set([...x].filter((y) => y !== id))));

  return (
    <Sheet
      title={t('native.shareFolder.title')}
      subtitle={t('native.shareFolder.subtitle')}
      icon="share"
      wide
      close={close}
      onReturn={share}
      footer={
        <>
          <span />
          <Button onClick={close}>{t('common.done')}</Button>
          <Button variant="primary" icon="share" disabled={!ready} onClick={share}>
            {existing ? t('native.shareFolder.update') : t('native.shareFolder.share')}
          </Button>
        </>
      }
    >
      <Field label={t('native.shareFolder.folder')} htmlFor="share-path">
        {typing || !dir ? (
          <div className={f.pathRow}>
            <span className={f.pathIcon}>
              <Icon name="folder" size={14} />
            </span>
            <input id="share-path" className={cx(s.input, f.path)} value={path} placeholder={canPickFolders() ? t('native.shareFolder.pathPlaceholder') : t('native.shareFolder.pathExample')} spellCheck={false} aria-label={t('native.shareFolder.folderPath')} autoFocus={!inApp()} onChange={(e) => setPath(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), share())} />
            {canPickFolders() ? <Button onClick={() => void choose()}>{t('native.shareFolder.choose')}</Button> : null}
          </div>
        ) : (
          <div className={f.folder} aria-label={t('native.shareFolder.folderAria', { path })}>
            <span className={f.folderTile}>
              <Icon name="folder" size={17} />
            </span>
            <span className={f.folderText}>
              <strong>{baseName(dir)}</strong>
              <span title={path}>{shortPath(path)}</span>
            </span>
            {canPickFolders() ? (
              <Button size="small" onClick={() => void choose()}>
                {t('native.shareFolder.choose')}
              </Button>
            ) : null}
            <Button size="small" variant="quiet" onClick={() => setTyping(true)}>
              {t('native.shareFolder.editPath')}
            </Button>
          </div>
        )}
        {suggestions.length ? (
          <div className={f.chips} aria-label={t('native.shareFolder.yourProjects')}>
            {suggestions.map((p) => (
              <button key={p.id} type="button" className={cx(f.chip, norm(dir) === norm(p.root) && f.chipOn)} onClick={() => pickPath(p.root)} title={tilde(home, p.root)}>
                {p.name}
              </button>
            ))}
          </div>
        ) : null}
        {existing ? <span className={s.hint}>{t('native.shareFolder.sharedAs', { name: existing.name })}</span> : null}
      </Field>
      <Field label={t('native.shareFolder.whoSees')}>
        <Choice<Who>
          label={t('native.shareFolder.whoSees')}
          value={who}
          options={[
            { value: 'all', label: t('native.shareFolder.everyoneInRoom'), icon: 'people' },
            { value: 'some', label: t('native.shareFolder.only'), icon: 'person' },
          ]}
          onChange={setWho}
        />
        {who === 'some' ? (
          people.length ? (
            <div className={f.people}>
              {people.map((p) => (
                <label key={p.peerId} className={f.person}>
                  <input type="checkbox" checked={only.has(p.peerId)} onChange={(e) => toggle(p.peerId, e.target.checked)} />
                  <Avatar name={p.name} id={p.peerId} size={18} />
                  <span>{p.name}</span>
                  {p.friend ? <Tag tone="muted">{t('native.shareFolder.friend')}</Tag> : null}
                </label>
              ))}
            </div>
          ) : (
            <span className={s.hint}>{t('native.shareFolder.noPeople')}</span>
          )
        ) : (
          <span className={s.hint}>{inRoom.length ? t('native.shareFolder.namesAndLater', { names: inRoom.map((p) => p.name).join(', ') }) : t('native.shareFolder.everyoneWhoJoins')}</span>
        )}
        {who === 'some' && people.some((p) => p.friend && only.has(p.peerId)) ? <span className={s.hint}>{t('native.shareFolder.friendsFind')}</span> : null}
      </Field>
      <Field label={t('native.shareFolder.yourAgent')}>
        <Check checked={writable} onChange={setWritable} label={t('native.shareFolder.mayEdit')} detail={writable ? t('native.shareFolder.mayEditOn') : t('native.shareFolder.readOnly')} />
      </Field>
      <Section title={t('native.shareFolder.sharedNow')}>
        <div className={s.list} role="list" aria-label={t('native.shareFolder.sharedFolders')}>
          {mine.length ? (
            mine.map((x) => (
              <div key={x.name} role="listitem" className={cx(s.item, s.clickable)} aria-label={x.name} onClick={() => edit(x)} title={t('native.shareFolder.clickToChange')}>
                <Icon name="folder" size={15} className={f.folderIcon} />
                <div className={s.itemText}>
                  <span className={s.itemTitle}>
                    {x.name} {x.writable ? <Tag tone="claude">{t('native.shareFolder.agentMayEdit')}</Tag> : null}
                  </span>
                  <span className={s.itemDetail}>
                    {shortPath(tilde(home, x.root))} · {x.private ? t('native.shareFolder.onlyNames', { names: (x.allowed ?? []).map(nameOf).join(', ') || t('native.shareFolder.nobody') }) : t('native.shareFolder.everyone')}
                  </span>
                </div>
                <div className={s.itemButtons}>
                  <Button
                    size="small"
                    variant="danger"
                    aria-label={t('native.shareFolder.stopSharingName', { name: x.name })}
                    onClick={(e) => {
                      e.stopPropagation();
                      void api.session.unshareFolder(x.name);
                    }}
                  >
                    {t('native.shareFolder.stopSharing')}
                  </Button>
                </div>
              </div>
            ))
          ) : (
            <div className={s.empty}>{dir ? t('native.shareFolder.emptyWithDir', { name: baseName(dir) }) : t('native.shareFolder.empty')}</div>
          )}
        </div>
      </Section>
    </Sheet>
  );
}
