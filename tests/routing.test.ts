import { describe, expect, it } from 'vitest';
import {
  type Combo,
  type LimitCard,
  DEFAULT_COMBOS,
  SavedCombos,
  comboAgent,
  comboChoices,
  comboIdFor,
  defaultCombos,
  limitsOf,
  resolveCombo,
  routeOf,
  runRouteOf,
  targetLabel,
  worldOf,
} from '../src/core/routing/model.js';
import type { RuntimeChoice } from '../src/shared/agent-runtimes.js';
import { encodeFailure } from '../src/shared/run-failure.js';
import { LIMIT_MARGIN_MS } from '../src/shared/auto-continue.js';
import { Settings } from '../src/shared/settings-schema.js';
import { prefsFrom } from '../src/core/store.js';
import { AgentRef } from '../src/protocol.js';
import { agentChoices, agentForChoice, choiceForAgent } from '../src/ui/agent-choice.js';
import { agentPicker, pickAction, pickCombo, pickedAgent } from '../src/shared/agent-picker.js';
import { agentBadge, agentName } from '../src/shared/agent-label.js';
import { agentRefView } from '../src/companion/needs-you.js';
import { AgentRefView } from '../src/companion/protocol.js';
import { onThisComputer } from '../src/shared/local-endpoints.js';

const NOW = Date.UTC(2026, 10, 11, 12, 0);
const ME = 'me';

const local = (models: ReadonlyArray<{ value: string; label: string; why?: string; onThisMac?: boolean }>): RuntimeChoice => ({ id: 'local', label: 'Local model', available: true, models: models.map((m) => ({ description: '', ...m })) });
const ALL: RuntimeChoice[] = [
  { id: 'claude', label: 'Claude', available: true },
  { id: 'codex', label: 'Codex', available: true, state: 'ready' },
  { id: 'opencode', label: 'OpenCode', available: true },
  local([
    { value: 'ollama/qwen3', label: 'Ollama · qwen3', onThisMac: true },
    { value: 'proxy/gpt-oss', label: 'Proxy · gpt-oss' },
  ]),
];

const world = (runtimes: RuntimeChoice[] = ALL, log: LimitCard[] = []) => worldOf({ runtimes, log, selfId: ME }, NOW, () => '14:05');
const combo = (targets: Combo['targets'], privacy?: Combo['privacy']): Combo => ({ id: 'c', name: 'Test', targets, ...(privacy ? { privacy } : {}) });
const limited = (runtime: string, model?: string, resetsAt = NOW + 60 * 60_000, at = NOW - 60_000): LimitCard => ({
  type: 'agent',
  owner: ME,
  status: 'error',
  text: encodeFailure({ kind: 'usage_limit', resetsAt, detail: 'limit' }, at),
  agent: { runtime, ...(model ? { model } : {}) },
  ts: at - 1000,
  endTs: at,
});

describe('resolving a combo', () => {
  it('takes the first target that can run, in order', () => {
    const r = resolveCombo(combo([{ runtime: 'claude', model: 'sonnet' }, { runtime: 'codex' }]), world());
    expect(r.ok && r.index).toBe(0);
    expect(r.ok && r.ready).toEqual({ agent: { runtime: 'claude', label: 'Claude', model: 'sonnet', combo: 'c', comboName: 'Test' }, model: 'sonnet' });
  });

  it('skips a runtime that is not set up or not signed in, saying why', () => {
    const runtimes: RuntimeChoice[] = [{ id: 'claude', label: 'Claude', available: false, why: "Claude Code isn't signed in on this Mac" }, { id: 'codex', label: 'Codex', available: true, state: 'signed_out', fix: 'Run codex login' }, { id: 'copilot', label: 'Copilot', available: true }];
    const r = resolveCombo(combo([{ runtime: 'claude' }, { runtime: 'codex' }, { runtime: 'copilot' }, { runtime: 'missing' }]), world(runtimes));
    expect(r.ok && r.index).toBe(2);
    expect(r.checks.map((c) => c.why)).toEqual(["Claude Code isn't signed in on this Mac", 'Run codex login', undefined]);
  });

  it('skips a target at its usage limit until it resets, with the effort of the next', () => {
    const r = resolveCombo(combo([{ runtime: 'claude', model: 'opus' }, { runtime: 'codex', effort: 'high' }]), world(ALL, [limited('claude', 'sonnet')]));
    expect(r.ok && r.index).toBe(1);
    expect(r.ok && r.ready.effort).toBe('high');
    expect(r.checks[0]!.why).toBe('At its usage limit until 14:05');
  });

  it('says why, target by target, when nothing can run', () => {
    const r = resolveCombo(combo([{ runtime: 'codex' }, { runtime: 'local', endpoint: 'nope' }]), world(ALL, [limited('codex')]));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.why).toBe("Nothing in Test can run now: Codex: At its usage limit until 14:05; nope: nope isn't set up.");
  });

  it('runs an endpoint that answers, and skips one that does not', () => {
    const runtimes = [ALL[0]!, local([{ value: 'proxy/gpt-oss', label: 'Proxy · gpt-oss', why: "Proxy isn't answering." }, { value: 'ollama/qwen3', label: 'Ollama · qwen3', onThisMac: true }])];
    const any = resolveCombo(combo([{ runtime: 'local' }]), world(runtimes));
    expect(any.ok && any.ready.agent).toMatchObject({ runtime: 'local', label: 'Ollama', model: 'ollama/qwen3' });
    const named = resolveCombo(combo([{ runtime: 'local', endpoint: 'proxy' }, { runtime: 'claude' }]), world(runtimes));
    expect(named.ok && named.index).toBe(1);
    expect(named.checks[0]!.why).toBe("Proxy isn't answering.");
  });

  it('takes your own endpoint before Ollama, and a named model on its endpoint', () => {
    const any = resolveCombo(combo([{ runtime: 'local' }]), world());
    expect(any.ok && any.ready.model).toBe('proxy/gpt-oss');
    const unlisted = resolveCombo(combo([{ runtime: 'local', endpoint: 'ollama', model: 'llama4' }]), world());
    expect(unlisted.ok && unlisted.ready.model).toBe('ollama/llama4');
  });
});

describe('privacy', () => {
  const chain: Combo['targets'] = [{ runtime: 'opencode' }, { runtime: 'local', endpoint: 'proxy' }, { runtime: 'claude' }, { runtime: 'local', endpoint: 'ollama' }];

  it('any: the first target', () => {
    const r = resolveCombo(combo(chain), world());
    expect(r.ok && r.index).toBe(0);
  });

  it('no third parties: not OpenCode, nor an endpoint off this computer; Claude yes', () => {
    const r = resolveCombo(combo(chain, 'no-third-party'), world());
    expect(r.ok && r.ready.agent.runtime).toBe('claude');
    expect(r.checks.slice(0, 2).every((c) => c.why)).toBe(true);
  });

  it('this computer only: just an endpoint on it', () => {
    const r = resolveCombo(combo(chain, 'local-only'), world());
    expect(r.ok && r.ready.model).toBe('ollama/qwen3');
    expect(r.checks[2]!.why).toBe('Runs off this Mac (this combo stays local)');
  });

  it('knows what is on this computer by its address', () => {
    for (const url of ['http://localhost:11434', 'http://127.0.0.1:4000', 'http://[::1]:8080', 'http://app.localhost']) expect(onThisComputer(url)).toBe(true);
    for (const url of ['http://box:11434', 'https://api.example.com', 'not a url']) expect(onThisComputer(url)).toBe(false);
  });
});

describe('usage limits from the runs', () => {
  it('keeps a limit until its reset (plus the margin), per plan or endpoint', () => {
    const limits = limitsOf([limited('claude', 'opus'), limited('local', 'proxy/gpt-oss')], ME, NOW);
    expect([...limits.keys()].sort()).toEqual(['claude', 'local:proxy']);
    expect(limits.get('claude')).toBe(NOW + 60 * 60_000 + LIMIT_MARGIN_MS);
    expect(limitsOf([limited('claude')], ME, NOW + 2 * 60 * 60_000).size).toBe(0);
  });

  it('a later run on the same plan that finished clears it; a friend’s run never counts', () => {
    const done: LimitCard = { type: 'agent', owner: ME, status: 'done', agent: { runtime: 'claude' }, ts: NOW + 60 * 60_000 + LIMIT_MARGIN_MS };
    expect(limitsOf([limited('claude'), done], ME, NOW).size).toBe(0);
    expect(limitsOf([{ ...limited('claude'), owner: 'friend' }], ME, NOW).size).toBe(0);
  });

  it('a card with no agent is Claude’s (from before agents were named)', () => {
    const { agent: _a, ...old } = limited('claude');
    expect(limitsOf([old], ME, NOW).has('claude')).toBe(true);
  });
});

describe('the defaults', () => {
  it('leave out what this computer can’t run, and a combo left empty', () => {
    const only: RuntimeChoice[] = [{ id: 'claude', label: 'Claude', available: true }, { id: 'codex', label: 'Codex', available: false, why: 'not set up' }, local([{ value: 'ollama/qwen3', label: 'Ollama · qwen3' }])];
    const d = defaultCombos(only);
    expect(d.map((c) => [c.id, c.targets.map((t) => targetLabel(t, only))])).toEqual([
      ['economy', ['Claude · Sonnet', 'Ollama']],
      ['strong', ['Claude · Opus', 'Claude · Sonnet']],
      ['local-first', ['Ollama', 'Claude · Haiku']],
    ]);
    expect(defaultCombos([{ id: 'codex', label: 'Codex', available: true }]).map((c) => c.id)).toEqual(['economy', 'strong']);
    expect(defaultCombos([])).toEqual([]);
  });

  it('keep a runtime that is installed but signed out (it can run once you sign in)', () => {
    expect(defaultCombos([{ id: 'codex', label: 'Codex', available: true, state: 'signed_out' }]).find((c) => c.id === 'strong')!.targets).toEqual([{ runtime: 'codex', effort: 'high' }]);
  });

  it('are the ones the docs name', () => {
    expect(DEFAULT_COMBOS.map((c) => c.name)).toEqual(['Economy', 'Strong', 'Local first']);
  });
});

describe('combos in the prefs', () => {
  it('unset in an older settings file: the defaults', () => {
    const s = Settings.parse({});
    expect(s.combos).toBeUndefined();
    expect(prefsFrom(s).combos).toBeUndefined();
  });

  it('a malformed entry is dropped alone, a duplicate id keeps its first; an unreadable list is unset', () => {
    const s = Settings.parse({ combos: [{ id: 'ok', name: 'Ok', targets: [{ runtime: 'codex' }] }, { id: 'Bad Id', name: 'x', targets: [] }, { id: 'ok', name: 'Again', targets: [{ runtime: 'claude' }] }, 42] });
    expect(s.combos).toEqual([{ id: 'ok', name: 'Ok', targets: [{ runtime: 'codex' }] }]);
    expect(prefsFrom(s).combos).toEqual(s.combos);
    expect(Settings.parse({ combos: 'nope' }).combos).toBeUndefined();
  });

  it('an empty list you saved stays empty (no defaults come back)', () => {
    const state = { runtimes: ALL, log: [], selfId: ME, prefs: { combos: [] } };
    expect(routeOf(state, { combo: 'economy' }, NOW)).toMatchObject({ ok: false });
  });
});

describe('a conversation on a combo', () => {
  const state = { runtimes: ALL, log: [], selfId: ME, prefs: {} };

  it('picked no combo: undefined (it runs on its agent)', () => {
    expect(routeOf(state, { runtime: 'claude', label: 'Claude' } as AgentRef, NOW)).toBeUndefined();
  });

  it('a default combo resolves without being saved; a deleted one says to pick another', () => {
    expect(routeOf(state, { combo: 'strong' }, NOW)).toMatchObject({ ok: true, index: 0, ready: { model: 'opus' } });
    const gone = routeOf(state, { combo: 'old', comboName: 'Old' }, NOW);
    expect(gone?.ok === false && gone.why).toMatch(/The combo Old isn't in Settings/);
  });

  it('the picked agent is the combo, valid on the wire, on its first target’s runtime', () => {
    const a = comboAgent(DEFAULT_COMBOS[0]!);
    expect(a).toEqual({ runtime: 'claude', label: 'Economy', combo: 'economy', comboName: 'Economy' });
    expect(AgentRef.parse(a)).toEqual(a);
  });

  it('a run says the combo and the target it ran on', () => {
    const log = [
      { type: 'agent', channel: 'ws:a', requestId: 'r1', ts: 1, agent: { runtime: 'claude', label: 'Claude', model: 'sonnet', combo: 'economy', comboName: 'Economy' } },
      { type: 'agent', channel: 'ws:a', requestId: 'r2', ts: 2, agent: { runtime: 'codex', label: 'Codex', combo: 'economy', comboName: 'Economy' } },
      { type: 'agent', channel: 'ws:b', requestId: 'r3', ts: 3, agent: { runtime: 'claude', label: 'Claude' } },
    ];
    expect(runRouteOf(log, 'ws:a')).toMatchObject({ requestId: 'r2', name: 'Economy', target: 'Codex', words: 'Economy · Codex' });
    expect(runRouteOf(log, 'ws:a', 'r1')).toMatchObject({ model: 'sonnet', words: 'Economy · Claude' });
    expect(runRouteOf(log, 'ws:b')).toBeUndefined();
    expect(agentBadge(log[1]!.agent)).toBe('Economy · Codex');
    expect(agentBadge(log[0]!.agent)).toBe('Economy · Claude · Sonnet');
    expect(agentName(comboAgent(DEFAULT_COMBOS[0]!), { model: true })).toBe('Economy');
  });
});

describe('the pickers', () => {
  const combos = comboChoices([DEFAULT_COMBOS[1]!], world());

  it('a pop-up value for a combo, and back', () => {
    const a = agentForChoice('combo:strong', ALL, [DEFAULT_COMBOS[1]!]);
    expect(a).toMatchObject({ combo: 'strong', comboName: 'Strong', runtime: 'claude' });
    expect(choiceForAgent(a)).toBe('combo:strong');
    expect(agentForChoice('combo:gone', ALL)).toMatchObject({ combo: 'gone' });
    expect(agentChoices(ALL, []).some((o) => o.value.startsWith('combo:'))).toBe(false);
  });

  it('lists combos with what each would run on now, and picks one for a conversation', () => {
    expect(combos[0]).toMatchObject({ id: 'strong', now: 'Claude · Opus', summary: 'Claude · Opus → Codex · High → Claude · Sonnet' });
    const st = { runtimes: ALL, models: [], prefs: {}, combos, projects: [{ workspaces: [{ id: 'w1' }, { id: 'w2', agent: comboAgent(DEFAULT_COMBOS[1]!) }] }] };
    const fresh = agentPicker(st, 'ws:w1');
    expect(fresh.combos.map((c) => c.on)).toEqual([false]);
    expect(pickCombo(fresh, combos[0]!)).toEqual({ kind: 'agent', agent: comboAgent(DEFAULT_COMBOS[1]!) });
    const on = agentPicker(st, 'ws:w2');
    expect(on).toMatchObject({ label: 'Strong', combo: { id: 'strong', name: 'Strong' } });
    expect(on.combos[0]!.on).toBe(true);
    expect(on.groups.flatMap((g) => g.models).some((m) => m.on)).toBe(false);
    expect(pickedAgent(on)).toMatchObject({ combo: 'strong', comboName: 'Strong' });
    expect(pickCombo(on, combos[0]!)).toBeUndefined();
    // A model picked leaves the combo, even on its own runtime.
    expect(pickAction(on, on.groups.find((g) => g.runtime === 'claude')!, 'opus')).toEqual({ kind: 'agent', agent: { runtime: 'claude', label: 'Claude', model: 'opus' } });
    expect(pickAction(fresh, fresh.groups.find((g) => g.runtime === 'claude')!, 'opus')).toEqual({ kind: 'model', value: 'opus' });
    expect(pickCombo(agentPicker(st, 'room'), combos[0]!)).toBeUndefined();
  });

  it('a new combo’s id from its name', () => {
    expect(comboIdFor('Econômico', [])).toBe('economico');
    expect(comboIdFor('Strong', ['strong'])).toBe('strong-2');
  });
});

describe('the phone', () => {
  it('gets the combo’s name on an agent (1.51), clipped', () => {
    const v = agentRefView({ runtime: 'codex', label: 'Codex', combo: 'economy', comboName: 'Economy' });
    expect(v).toEqual({ runtime: 'codex', label: 'Codex', comboName: 'Economy' });
    expect(AgentRefView.parse(v)).toEqual(v);
    expect(agentRefView({ runtime: 'claude', label: 'Claude' })).toEqual({ runtime: 'claude', label: 'Claude' });
  });
});
