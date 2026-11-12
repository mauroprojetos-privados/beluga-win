import { useSyncExternalStore } from 'react';
import { MAC_BOT, botOfChannel, botStatusLine } from '@beluga/core/bots/schema.js';
import type { BotInfo } from '@beluga/core/bots/schema.js';
import { Icon, type IconName } from '../components/Icon.js';
import { Button, Empty, IconButton } from '../components/ui.js';
import { useActions } from '../lib/actions.js';
import { useApp, useBeluga } from '../lib/beluga.js';
import { sameDeep } from '../lib/stable.js';
import { signalOf } from '../layout/attention-model.js';
import { SignalMark } from '../layout/signal-marks.js';
import { Row, Section } from '../layout/sidebar-parts.js';
import { AssistantNav } from '../layout/AssistantNav.js';
import { useT } from '../lib/i18n.js';
import b from './bots.module.css';

/** Which bot Settings › Bots shows (kept across opening and closing Settings). */
let picked: string = MAC_BOT;
const subs = new Set<() => void>();
export const pickBot = (id: string): void => {
  picked = id;
  for (const s of subs) s();
};
export const usePickedBot = (): string =>
  useSyncExternalStore(
    (cb) => (subs.add(cb), () => void subs.delete(cb)),
    () => picked,
  );

/** Open Bot Studio at a bot (Settings › Bots). */
export function useOpenStudio(): (id?: string) => void {
  const { ui } = useBeluga();
  return (id = MAC_BOT) => {
    pickBot(id);
    ui.patch({ settings: 'bots' });
  };
}

/** An icon the app has, else the bot's own mark. */
export const botIcon = (bot: Pick<BotInfo, 'icon' | 'mac'>): IconName => (bot.icon as IconName) || (bot.mac ? 'laptop' : 'bot');

/** A bot's name with what it's doing under it ("2 of 6 done · waiting on Contrast check"), or what's wrong. */
export function BotLabel({ name, bot }: { name: string; bot: BotInfo | undefined }) {
  const line = botStatusLine(bot?.status);
  const problem = !line && bot?.problems.length ? bot.problems[0] : undefined;
  return (
    <span className={b.navLabel}>
      <span className={b.navName}>{name}</span>
      {line ? <span className={b.navLine}>{line}</span> : problem ? <span className={`${b.navLine} ${b.navWarn}`}>{problem}</span> : null}
    </span>
  );
}

/** Whether you have bots besides Your Mac (the sidebar then has a Bots section, Your Mac first). */
export const useHasBots = (): boolean => useApp((st) => st.bots.bots.some((x) => !x.mac));

/** One bot of yours other than Your Mac, in the sidebar's Bots section. */
function BotRow({ bot }: { bot: BotInfo }) {
  const actions = useActions();
  const selected = useApp((st) => st.view.kind === 'bot' && st.view.id === bot.id);
  const signal = useApp((st) => signalOf(st, bot.channel), sameDeep);
  const t = useT();
  return (
    <Row
      icon={<Icon name={botIcon(bot)} size={14} />}
      label={<BotLabel name={bot.name} bot={bot} />}
      detail={signal.tip || bot.description || t('bots.nav.rowDetail', { name: bot.name, dir: bot.dir })}
      selected={selected}
      onClick={() => {
        // Its chat open now (its tabs, like Your Mac's).
        const chat = botOfChannel(bot.channel)?.chat;
        actions.run({ type: 'view', view: { kind: 'bot', id: bot.id, ...(chat && chat !== 'main' ? { chat } : {}) } });
      }}
      trailing={<SignalMark signal={signal} />}
    />
  );
}

/**
 * The sidebar's Bots section (docs/bots.md): there once you made a bot besides Your Mac, which
 * stays the sidebar's first row. + is New Bot (Bot Studio).
 */
export function BotsSection() {
  const others = useApp((st) => st.bots.bots.filter((x) => !x.mac), sameDeep);
  const studio = useOpenStudio();
  const t = useT();
  if (!others.length) return null;
  return (
    <Section id="bots" title={t('bots.nav.title')} count={others.length + 1} action={<IconButton icon="plus" label={t('bots.list.newBot')} onClick={() => studio('new')} />} keep={<AssistantNav />}>
      <AssistantNav />
      {others.map((bot) => (
        <BotRow key={bot.id} bot={bot} />
      ))}
    </Section>
  );
}

/** A bot's chat before anything was said: who it is, and Bot Studio. */
export function BotEmpty({ id }: { id: string }) {
  const bot = useApp((st) => st.bots.bots.find((x) => x.id === id), sameDeep);
  const studio = useOpenStudio();
  const t = useT();
  if (!bot) return <Empty icon="bot" title={t('bots.nav.deleted')} detail={t('bots.nav.deletedDetail')} />;
  return (
    <Empty
      icon={botIcon(bot)}
      title={t('bots.nav.ask', { name: bot.name })}
      detail={bot.description ? t('bots.nav.emptyDetailWith', { description: bot.description, dir: bot.dir }) : t('bots.nav.emptyDetail', { dir: bot.dir })}
      action={
        <Button icon="gear" onClick={() => studio(id)}>
          {t('bots.nav.openStudio')}
        </Button>
      }
    />
  );
}

export { MAC_BOT };
