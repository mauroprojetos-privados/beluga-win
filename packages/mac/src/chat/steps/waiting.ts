import type { TaskView } from '@beluga/core/gateway/model.js';
import { isFinal } from '@beluga/core/gateway/model.js';
import { humanizeLine } from '@beluga/shared/step-titles.js';
import { t as tr } from '@beluga/shared/i18n/index.js';

/**
 * What Claude is waiting on when it asked someone else's Claude (or Mac), in words, from the
 * task's live state: "bob is approving…", "bob's Claude is working · Reading payments.ts".
 */

const isAsk = (t: Pick<TaskView, 'kind'>): boolean => t.kind === 'ask';

/** The waiting row's heading. */
export const waitingFor = (t: TaskView | undefined): string =>
  t ? (isAsk(t) ? tr('chat.wait.forAgent', { name: t.peerName }) : tr('chat.wait.forComputer', { name: t.peerName })) : tr('chat.wait.forAnswer');

/** Where the task is right now, as one line. */
export function waitState(t: TaskView): string {
  const name = t.peerName;
  if (t.question) return tr('chat.wait.asks', { name, question: t.question.questions[0]?.question ?? tr('chat.wait.aQuestion') });
  switch (t.state) {
    case 'confirm':
      return tr('chat.wait.confirm', { name });
    case 'sent':
      return tr('chat.wait.sent', { name });
    case 'queued':
      return tr('chat.wait.queued', { name });
    case 'awaiting_approval':
      return tr('chat.wait.approving', { name });
    case 'working': {
      if (t.incoming) return tr('chat.wait.receiving', { name });
      if (t.kind === 'run') return tr('chat.wait.running', { name });
      if (t.kind === 'file') return tr('chat.wait.sendingFile', { name });
      const last = t.steps.at(-1);
      return last ? tr('chat.wait.workingOn', { name, doing: humanizeLine(last).doing }) : tr('chat.wait.working', { name });
    }
    case 'done':
      return isAsk(t) ? tr('chat.wait.agentAnswered', { name }) : tr('chat.wait.computerAnswered', { name });
    case 'declined':
      return tr('chat.shell.declined', { owner: name });
    case 'failed':
      return tr('chat.wait.failed');
    case 'cancelled':
      return tr('chat.wait.cancelled');
  }
}

/** How a finished wait reads in the list of steps. */
export function waitedLabel(t: TaskView | undefined): string | undefined {
  if (!t || !isFinal(t.state)) return undefined;
  const name = t.peerName;
  if (t.state === 'done') return isAsk(t) ? tr('chat.wait.heardBack', { name }) : tr('chat.wait.gotResult', { name });
  if (t.state === 'declined') return tr('chat.shell.declined', { owner: name });
  if (t.state === 'cancelled') return isAsk(t) ? tr('chat.wait.stoppedAgent', { name }) : tr('chat.wait.stoppedComputer', { name });
  return isAsk(t) ? tr('chat.wait.agentCouldnt', { name }) : tr('chat.wait.computerCouldnt', { name });
}

export const waitTone = (t: TaskView | undefined): 'claude' | 'warn' | 'ok' | 'error' =>
  !t ? 'claude' : t.question || t.state === 'awaiting_approval' || t.state === 'confirm' ? 'warn' : t.state === 'done' ? 'ok' : t.state === 'failed' || t.state === 'declined' ? 'error' : 'claude';
