import { useState } from 'react';
import { CLAUDE_AI_CONNECTORS_URL, type McpServerRow } from '@beluga/shared/mcp.js';
import { t } from '@beluga/shared/i18n/index.js';
import { runtimeMark } from '@beluga/shared/agent-marks.js';
import { Button, Dot, Segmented } from '../components/ui.js';
import { useApp, useBeluga } from '../lib/beluga.js';
import { myRuntime } from '../chat/ModelPicker.js';
import { MCP_FROM, MCP_STATUS, checkMcp, mcpRuntimeOf, setMcpEnabled, signInMcp, useMcp } from '../lib/mcp.js';
import { openExternal } from '../lib/system.js';
import { say, useT } from '../lib/i18n.js';
import { Group, Row, Switch } from './settings-controls.js';
import s from './settings.module.css';

type McpRuntime = 'claude' | 'codex';

/** What each agent's list says, in its own words. */
const WORDS = (): Record<McpRuntime, { readonly name: string; readonly app: string; readonly where: string; readonly none: string }> => ({
  // i18n-ignore: the agents' product names
  claude: { name: 'Claude', app: 'Claude Code', where: t('prefs.mcp.claudeWhere'), none: t('prefs.mcp.claudeNone') },
  // i18n-ignore: the agents' product names
  codex: { name: 'Codex', app: 'Codex', where: t('prefs.mcp.codexWhere'), none: t('prefs.mcp.codexNone') },
});

/**
 * Settings › Agent › MCP servers (BLG-251, BLG-518): the servers your own agent gets, how each is,
 * Sign In for one that needs it, and (Codex) a switch to turn one off. Claude's come from Claude
 * Code (agent/owner-mcp.ts), Codex's from its config.toml (runtime/codex/mcp.ts); with both set up,
 * a tab for each, yours first. Each keeps its own logins, so a sign-in here counts there too.
 */
export function McpSettings() {
  const t = useT();
  const { client } = useBeluga();
  // Your agent as Settings sets it (Settings › Agent › Your agent).
  const mine = mcpRuntimeOf(useApp((st) => myRuntime(st.prefs)));
  // Both agents set up on this Mac: one tab each.
  const setUp = useApp(
    (st) => (['claude', 'codex'] as const).filter((id) => st.runtimes?.some((r) => r.id === id && r.available)),
    (a, b) => a.join() === b.join(),
  );
  const tabs: readonly McpRuntime[] = setUp.length > 1 ? [mine, ...setUp.filter((id) => id !== mine)] : [mine];
  const [picked, pick] = useState<McpRuntime>(mine);
  const runtime = tabs.includes(picked) ? picked : mine;
  const all = WORDS();
  const words = all[runtime];
  const { rows, checking, signingIn, turning } = useMcp(client, runtime);

  return (
    <Group title={say('MCP servers')}>
      {tabs.length > 1 ? (
        <div className={s.row}>
          <Segmented label={t('prefs.mcp.whose')} value={runtime} onChange={pick} options={tabs.map((id) => ({ value: id, label: id === mine ? t('prefs.mcp.yours', { name: all[id].name }) : all[id].name, icon: runtimeMark(id) }))} />
        </div>
      ) : null}
      <Row label={t('prefs.mcp.servers', { name: words.name })} detail={t('prefs.mcp.serversDetail', { where: words.where })}>
        <Button variant="quiet" icon="refresh" disabled={checking} onClick={() => void checkMcp(client, runtime)}>
          {checking ? t('prefs.mcp.checking') : t('prefs.mcp.checkAgain')}
        </Button>
      </Row>
      {rows === undefined ? (
        <div className={s.note}>{t('prefs.mcp.asking', { app: words.app })}</div>
      ) : rows.length === 0 ? (
        <div className={s.note}>{words.none}</div>
      ) : (
        rows.map((row) => {
          const status = MCP_STATUS[row.status];
          const why = row.status === 'failed' && row.error ? `: ${row.error}` : '';
          const tools = row.tools !== undefined ? t('prefs.mcp.tools', { count: row.tools }) : '';
          return (
            <Row key={row.name} label={row.label} detail={`${MCP_FROM[row.from](row.where)} · ${status.words}${tools}${why}`}>
              {row.canSignIn ? (
                <Button disabled={signingIn !== undefined} onClick={() => void signInMcp(client, row, runtime)}>
                  {signingIn === row.name ? t('prefs.mcp.waitingBrowser') : t('prefs.mcp.signIn')}
                </Button>
              ) : row.from === 'claude.ai' && row.status === 'needs-auth' ? (
                <Button variant="quiet" onClick={() => void openExternal(CLAUDE_AI_CONNECTORS_URL)}>
                  {t('prefs.mcp.openClaudeAi')}
                </Button>
              ) : row.canTurnOff ? null : (
                <Dot tone={status.tone} />
              )}
              {row.canTurnOff ? <Switch label={t('prefs.mcp.on', { label: row.label })} on={row.status !== 'disabled'} onChange={(on) => turning === undefined && void setMcpEnabled(client, row, on, runtime)} /> : null}
            </Row>
          );
        })
      )}
    </Group>
  );
}
