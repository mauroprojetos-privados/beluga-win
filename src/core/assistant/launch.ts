import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pretendSystem } from '../gateway/demo-system.js';
import { belugaHome } from '../home.js';
import { boardOf } from '../board/registry.js';
import { plansOf } from '../plans/registry.js';
import type { Session } from '../session.js';
import type { Store } from '../store.js';
import { Bots } from '../bots/bots.js';
import { attachBots, detachBots } from '../bots/registry.js';
import { triggers as sentinelTriggers } from '../sentinel/launch.js';
import { MacAssistant } from './assistant.js';
import { attachAssistant, detachAssistant } from './registry.js';

/**
 * Start "Your Mac" for the daemon (the Mac app's Beluga): its folder in ~/.beluga/assistant, its
 * history loaded. The demo's lives in a temporary folder and looks at a pretend Mac.
 *
 * Your bots start with it (core/bots, docs/bots.md): Your Mac is the first of them, its folder the
 * assistant's `work/`, and the others are folders in ~/.beluga/bots.
 */
export function launchAssistant(host: { readonly session: Session; readonly store: Store; readonly demo: boolean }): () => void {
  const { session, store } = host;
  const home = host.demo ? mkdtempSync(path.join(os.tmpdir(), 'beluga-demo-assistant-')) : belugaHome();
  const dir = host.demo ? home : path.join(home, 'assistant');
  let bots: Bots | undefined;
  const assistant = new MacAssistant({
    store,
    dir,
    selfId: () => session.selfId,
    ...(host.demo ? { system: pretendSystem() } : {}),
    startWorktree: async (projectId, message, opts) => session.workspaces?.startWorktree(projectId, message, (p) => session.nameTask(p), { ...opts, quiet: true }),
    startTask: async (key) => {
      const board = boardOf(session);
      if (!board) throw new Error('Tasks need the Beluga app');
      return board.start(key, { claude: true, quiet: true });
    },
    startPlan: async (projectId, goal) => {
      const plans = plansOf(session);
      if (!plans) throw new Error('Plans need the Beluga app');
      return plans.create({ projectId, goal }, { quiet: true });
    },
    archiveWorktree: async (id) => {
      if (!session.workspaces) throw new Error('Archiving needs the Beluga app');
      return session.workspaces.archive(id);
    },
    bot: () => bots?.macExtras(),
  });
  attachAssistant(session, assistant);
  bots = new Bots({
    store,
    home,
    macDir: assistant.workDir,
    selfId: () => session.selfId,
    secrets: {
      values: () => session.env.globals(),
      set: (name, value) => session.env.setOne(undefined, name, value),
    },
    macTools: () => assistant.tools(),
    createPlan: async (input) => {
      const plans = plansOf(session);
      if (!plans) throw new Error('Plans need the Beluga app');
      return plans.createWritten(input);
    },
    watch: !host.demo,
    // A bot’s trigger says its message in the bot’s chat as you would; its events are watched where Sentinels’ are (the demo: schedules only).
    submit: (channel, text) => session.submit(text, { channel }),
    ...(host.demo ? {} : { triggerEvents: sentinelTriggers(session, store) }),
  });
  attachBots(session, bots);
  // A bot's plan routes each task by its category (the pilot asks; dispatch.ts answers).
  const plans = plansOf(session);
  if (plans) plans.router = (planId) => bots?.router(planId);
  return () => {
    if (plans) plans.router = undefined;
    detachBots(session);
    bots?.stop();
    detachAssistant(session);
    assistant.stop();
  };
}
