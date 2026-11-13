import type { WsRole } from '@beluga/protocol.js';
import { cannotTake } from '@beluga/net/mesh/features.js';
import { ProjectIcon } from '../../components/ProjectIcon.js';
import { Avatar, Button } from '../../components/ui.js';
import { toast, useApi, useApp, useBeluga } from '../../lib/beluga.js';
import { presenceOf } from '@beluga/core/friend-share-people.js';
import { Select } from '../settings-controls.js';
import { Section, Sheet, Tag } from './parts.js';
import { ACCESS, type Access, SharePicker } from './SharePicker.js';
import s from './sharing.module.css';
import { thisComputer } from '../../lib/os-words.js';
import { useT } from '../../lib/i18n.js';

/**
 * Share with…: a project with friends over the network. Nobody hosts: it shows in each friend's
 * Projects with your avatar, its worktrees under it (new ones too), and stays while either of you
 * is offline. Like a worktree's Share sheet: pick a friend and what they can do (BLG-623), and who
 * has it is listed with their level, changed or removed in place.
 */
export function ShareProjectSheet({ projectId, close }: { readonly projectId: string; readonly close: () => void }) {
  const api = useApi();
  const t = useT();
  const { client } = useBeluga();
  const project = useApp((st) => st.projects.find((p) => p.id === projectId));
  const grants = useApp((st) => st.projectShares[projectId]);
  const network = useApp((st) => st.network);
  const peers = useApp((st) => st.peers);
  if (!project) return null;
  const friends = network.friends.filter((f) => grants?.[f.peerId]);
  const candidates = network.friends
    .filter((f) => !grants?.[f.peerId])
    .map((f) => {
      const why = cannotTake(f.name, f.beluga, 'share.project', f.online);
      return { peerId: f.peerId, name: f.name, ...(why ? { why } : {}) };
    });
  const none = !network.enabled ? t('native.wsShare.networkOff') : network.friends.length ? t('native.wsShare.allHaveIt') : t('native.shareProject.noFriends');
  const set = (peerId: string, access: Access): void => {
    const done = access === 'none' ? api.sharing.unshareFriend({ peerId, projectId }) : api.sharing.shareWithFriend({ peerId, projectId, role: access });
    void done.catch((err: unknown) => toast(client, err instanceof Error ? err.message : String(err), 'warn'));
  };
  const worktrees = project.workspaces.filter((w) => !w.archived && !w.external && w.kind !== 'main').length;
  return (
    <Sheet
      title={t('native.wsShare.title', { name: project.name })}
      subtitle={t('native.shareProject.subtitle', { count: worktrees })}
      badge={<ProjectIcon id={project.id} name={project.name} size={36} />}
      close={close}
      footer={
        <>
          <span />
          <Button variant="primary" onClick={close}>
            {t('common.done')}
          </Button>
        </>
      }
    >
      <Section title={t('native.wsShare.shareWith')}>
        <SharePicker candidates={candidates} onShare={set} none={none} />
      </Section>
      <Section title={t('native.shareProject.friendsWithAccess')}>
        <div className={s.list} role="list" aria-label={t('native.shareProject.friendsWithAccess')}>
          {friends.map((f) => {
            const access: Access = grants?.[f.peerId]?.role ?? 'none';
            const only = grants?.[f.peerId]?.only;
            const presence = presenceOf({ network, peers }, f.peerId);
            const detail = access === 'contribute' ? t('native.shareProject.talks') : t('native.shareProject.follows');
            return (
              <div key={f.peerId} role="listitem" className={s.item}>
                <Avatar name={f.name} id={f.peerId} size={24} />
                <div className={s.itemText}>
                  <span className={s.itemTitle}>
                    {f.name} {presence.state === 'online' ? null : <Tag tone="muted">{presence.label}</Tag>} {only ? <Tag>{t('native.shareProject.only', { count: only.length })}</Tag> : null}
                  </span>
                  <span className={s.itemDetail}>{detail}</span>
                </div>
                <Select<Access> label={t('native.wsShare.accessFor', { name: f.name })} value={access} options={ACCESS()} onChange={(a) => set(f.peerId, a)} />
              </div>
            );
          })}
          {friends.length ? null : <div className={s.empty}>{t('native.shareProject.nobody')}</div>}
        </div>
      </Section>
      <p className={s.hint}>{t('native.shareProject.hint', { computer: thisComputer() })}</p>
    </Sheet>
  );
}
