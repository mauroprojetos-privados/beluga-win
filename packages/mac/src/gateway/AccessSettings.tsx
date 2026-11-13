import { useState } from 'react';
import { CAP_INFO, CAP_LEVEL_INFO, CAP_ORDER, type CapLevel, type CapRow, type CapTrust, DECISION_INFO, type Rule, type RuleDecision, expiryLabel, ruleLabel } from '@beluga/core/gateway/access.js';
import { TRUST_INFO } from '@beluga/core/trust.js';
import { Button, cx } from '../components/ui.js';
import { Group, Select } from '../dialogs/settings-controls.js';
import { canPickFolders, inApp } from '../lib/boot.js';
import { pickFolders } from '../lib/projects.js';
import { useApi, useApp, useBeluga } from '../lib/beluga.js';
import s from './access.module.css';
import { t as tr } from '@beluga/shared/i18n/index.js';
import { say, useT } from '../lib/i18n.js';

/**
 * Settings › People & access, for tasks between Claudes: what friends' Claudes may do here, per
 * capability and trust level (with the folders they may use and your "Ask me for…" note), and
 * your rules for people's requests, which "Always" on a request writes. The rules of one person
 * also show on their card.
 */

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));
const COLUMNS: readonly CapTrust[] = ['ask', 'trusted', 'full'];

function useReport(): (what: string, call: Promise<unknown>, done?: string) => void {
  const { client } = useBeluga();
  return (what, call, done) =>
    void call
      .then(() => (done ? client.store.dispatch({ type: 'toast', text: done, level: 'success' }) : undefined))
      .catch((err: unknown) => client.store.dispatch({ type: 'toast', text: `${what}: ${message(err)}`, level: 'error' }));
}

/** Pick a folder (the Mac's open panel; in a served page Beluga's picker of the server's folders; else a typed path). */
async function pickFolder(): Promise<string | undefined> {
  if (!inApp()) return (await pickFolders(tr('github.access.folderTitle')))?.[0];
  const { open } = await import('@tauri-apps/plugin-dialog');
  const picked = await open({ directory: true, multiple: false, title: tr('github.access.folderTitle') });
  return typeof picked === 'string' ? picked : undefined;
}

function Folders() {
  const api = useApi();
  const report = useReport();
  const folders = useApp((st) => st.gateway.capabilities.folders);
  const t = useT();
  const [typed, setTyped] = useState('');
  const set = (next: readonly string[]): void => report(t('github.access.cantChangeFolders'), api.gateway.setCapabilities({ folders: [...next] }));
  const add = async (): Promise<void> => {
    const folder = typed.trim() || (await pickFolder());
    if (!folder || folders.includes(folder)) return;
    set([...folders, folder]);
    setTyped('');
  };
  return (
    <div className={s.folders} role="group" aria-label={t('github.access.foldersLabel')}>
      <div className={s.capName}>{t('github.access.foldersName')}</div>
      <div className={s.capDetail}>{t('github.access.foldersDetail')}</div>
      {folders.map((f) => (
        <div key={f} className={s.folder}>
          <span title={f}>{f}</span>
          <Button size="small" variant="quiet" aria-label={t('github.access.removeFolder', { folder: f })} onClick={() => set(folders.filter((x) => x !== f))}>
            {t('github.access.remove')}
          </Button>
        </div>
      ))}
      <div className={s.folderAdd}>
        {/* i18n-ignore: a sample path */}
        {canPickFolders() ? null : <input className={s.input} aria-label={t('github.access.folderPath')} placeholder="/Users/you/Shared" value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void add()} />}
        <Button size="small" onClick={() => void add()} disabled={!canPickFolders() && !typed.trim()}>
          {t('github.access.addFolder')}
        </Button>
      </div>
    </div>
  );
}

function AskMeFor() {
  const api = useApi();
  const report = useReport();
  const saved = useApp((st) => st.gateway.note);
  const t = useT();
  const [text, setText] = useState<string | undefined>();
  const save = (): void => {
    if (text === undefined || text === saved) return;
    report(t('github.req.cantSave'), api.gateway.setNote(text).then(() => setText(undefined)), t('github.req.noteSaved'));
  };
  return (
    <div className={s.folders}>
      <div className={s.capName}>{t('github.access.askMeForDots')}</div>
      <div className={s.capDetail}>{t('github.access.askMeForDetail')}</div>
      <input className={s.input} aria-label={t('github.req.askMeFor')} placeholder={t('github.access.askMeForPlaceholder')} value={text ?? saved} maxLength={280} onChange={(e) => setText(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === 'Enter' && save()} />
    </div>
  );
}

/** Friends your Claude asks without checking with you first (you said Always on its "Ask X's Claude?" card). */
function AskFreely() {
  const api = useApi();
  const report = useReport();
  const peers = useApp((st) => st.gateway.askFreely ?? []);
  const friends = useApp((st) => st.network.friends);
  const roomPeers = useApp((st) => st.peers);
  const t = useT();
  const nameOf = (id: string): string => friends.find((f) => f.peerId === id)?.name ?? roomPeers.find((p) => p.peerId === id)?.name ?? t('github.someone');
  if (!peers.length) return null;
  return (
    <div className={s.folders} role="group" aria-label={t('github.access.freelyLabel')}>
      <div className={s.capName}>{t('github.access.freelyName')}</div>
      <div className={s.capDetail}>{t('github.access.freelyDetail')}</div>
      {peers.map((id) => (
        <div key={id} className={s.folder}>
          <span>{nameOf(id)}</span>
          <Button size="small" variant="quiet" aria-label={t('github.access.askMeFirstAbout', { name: nameOf(id) })} onClick={() => report(t('github.sheet.cantChange'), api.gateway.setAskFreely(id, false), t('github.access.askFirstAgain'))}>
            {t('github.access.askMeFirst')}
          </Button>
        </div>
      ))}
    </div>
  );
}

/** What friends' Claudes may do here: each capability by trust level (Allow / Ask me / Off). */
export function CapabilitySettings() {
  const api = useApi();
  const report = useReport();
  const caps = useApp((st) => st.gateway.capabilities);
  const t = useT();
  const set = (need: (typeof CAP_ORDER)[number], trust: CapTrust, level: CapLevel): void => {
    const row: CapRow = { ...caps.levels[need], [trust]: level };
    report(t('github.sheet.cantChange'), api.gateway.setCapabilities({ levels: { [need]: row } }));
  };
  return (
    <Group title={say('What your friends’ agents can do here')}>
      <table className={s.capTable} aria-label={t('github.access.capsTable')}>
        <thead>
          <tr>
            <th />
            {COLUMNS.map((c) => (
              <th key={c}>{TRUST_INFO[c].label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {CAP_ORDER.map((need) => (
            <tr key={need}>
              <td>
                <div className={s.capName}>{CAP_INFO[need].label}</div>
                <div className={s.capDetail}>{CAP_INFO[need].detail}</div>
              </td>
              {COLUMNS.map((trust) => (
                <td key={trust} className={s.capCell}>
                  <Select<CapLevel>
                    label={t('github.access.capFor', { cap: CAP_INFO[need].label, trust: TRUST_INFO[trust].label })}
                    value={caps.levels[need][trust]}
                    onChange={(v) => set(need, trust, v)}
                    // "Ask me each time" asks anyway: Allow there would mean the same as Ask me.
                    options={(trust === 'ask' ? (['ask', 'off'] as const) : (['allow', 'ask', 'off'] as const)).map((l) => ({ value: l, label: CAP_LEVEL_INFO[l] }))}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <Folders />
      <AskMeFor />
      <AskFreely />
    </Group>
  );
}

/** One rule: what it covers, until when; change its answer, or delete it. */
function RuleRow({ rule }: { rule: Rule }) {
  const api = useApi();
  const report = useReport();
  const { id, peerId, peerName, kind, needs, command, project, folder, expiresAt } = rule;
  const t = useT();
  const base = { id, peerId, peerName, kind, needs: [...needs], ...(command ? { command } : {}), ...(project ? { project } : {}), ...(folder ? { folder } : {}), ...(expiresAt ? { expiresAt } : {}) };
  return (
    <div className={s.rule} role="listitem" aria-label={t('github.access.rule', { rule: ruleLabel(rule) })}>
      <div className={s.ruleText}>
        <div className={s.ruleLabel}>{ruleLabel(rule)}</div>
        <div className={s.ruleMeta}>
          {t('github.access.made', { expiry: expiryLabel(rule), date: new Date(rule.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' }) })}
        </div>
      </div>
      <Select<RuleDecision> label={t('github.access.answerFor', { rule: ruleLabel(rule) })} value={rule.decision} onChange={(v) => report(t('github.access.cantChangeRule'), api.gateway.saveRule({ ...base, decision: v }))} options={(['allow', 'ask', 'decline'] as const).map((d) => ({ value: d, label: DECISION_INFO[d] }))} />
      <Button size="small" variant="quiet" aria-label={t('github.access.deleteRule', { rule: ruleLabel(rule) })} onClick={() => report(t('github.access.cantDeleteRule'), api.gateway.removeRule(rule.id), t('github.access.ruleDeleted'))}>
        {t('common.delete')}
      </Button>
    </div>
  );
}

/** One person's rules (their card in the inspector, Settings). */
export function PersonRules({ peerId, compact }: { peerId: string; compact?: boolean }) {
  const all = useApp((st) => st.gateway.rules);
  const rules = all.filter((r) => r.peerId === peerId);
  const t = useT();
  if (!rules.length) return <div className={s.empty}>{t('github.access.noRulesPerson')}</div>;
  return (
    <div className={cx(s.cardRules, compact && s.compact)} role="list" aria-label={t('github.access.rules')}>
      {rules
        .slice()
        .reverse()
        .map((r) => (
          <RuleRow key={r.id} rule={r} />
        ))}
    </div>
  );
}

/** Every rule, by person. */
export function RuleSettings() {
  const rules = useApp((st) => st.gateway.rules);
  const people = [...new Map(rules.map((r) => [r.peerId, r.peerName])).entries()];
  const t = useT();
  return (
    <Group title={say('Rules for people’s requests')}>
      {people.length ? (
        <div role="list" aria-label={t('github.access.rulesByPerson')}>
          {people.map(([peerId, name]) => (
            <div key={peerId} role="listitem" aria-label={t('github.access.rulesFor', { name })}>
              <div className={s.person}>{name}</div>
              <PersonRules peerId={peerId} />
            </div>
          ))}
        </div>
      ) : (
        <div className={s.empty}>{t('github.access.noRules')}</div>

      )}
    </Group>
  );
}

/** Both, for Settings › People & access (only while the app runs the gateway). */
export function AccessSettings() {
  const enabled = useApp((st) => st.gateway.enabled);
  if (!enabled) return null;
  return (
    <>
      <CapabilitySettings />
      <RuleSettings />
    </>
  );
}
