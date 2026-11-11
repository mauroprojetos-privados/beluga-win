import { router } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';
import { Activity, Bell, Bot, Calendar, Check, CircleDot, CirclePause, Clock, Coins, Eye, FileText, Gauge, GitMerge, GitPullRequest, Globe, Network, Hand, Loader, type LucideIcon, MessageSquare, Minus, Play, RefreshCw, Shield, SquareTerminal, Tag, Terminal, TriangleAlert, Users, Wrench, X } from 'lucide-react-native';
import { View } from 'react-native';
import Animated, { LinearTransition, FadeIn } from 'react-native-reanimated';
import { ago, useSupports, useView } from '../lib/hooks';
import type { SentinelSummary, SentinelsView } from '../lib/link/protocol';
import { kv } from '../lib/kv';
import { t } from '../lib/language';
import { formatDateWith } from '../../../src/shared/i18n/format';
import { color } from '../lib/theme';
import { ProjectMark } from './ProjectMark';
import { SentinelIdeas } from './SentinelIdeas';
import { Card, Hairline, IconBadge, Pill, Press, T, type Tone, toneBg, toneInk } from './ui';

/**
 * Sentinel on the phone (BLG-237, docs/sentinel.md §4): your watchers as the Mac's list shows them,
 * a row each (its icon in a pastel circle, its name, when it runs and its last run's headline, the
 * last run's state as a pill). Making and changing them stays on the Mac.
 */

/** A sentinel's icon by the name the Mac gives it; one the phone doesn't know is the shield. */
const ICONS: Record<string, LucideIcon> = { calendar: Calendar, wrench: Wrench, check: Check, globe: Globe, clock: Clock, hand: Hand, bell: Bell, shield: Shield, merge: GitMerge, pr: GitPullRequest, chat: MessageSquare, users: Users, terminal: Terminal, file: FileText, bot: Bot, alert: TriangleAlert, refresh: RefreshCw, tag: Tag, issue: CircleDot, pulse: Activity, coin: Coins, eye: Eye, claude: SquareTerminal, play: Play, gauge: Gauge, graph: Network };
export const sentinelIcon = (name: string): LucideIcon => ICONS[name] ?? Shield;

/** A run's state as a pill: the Mac's words (RUN_STATE_INFO) in the phone's pastels. */
const RUN: Record<string, { label: string; tone: Tone; Icon: LucideIcon }> = {
  queued: { get label() { return t('phoneParts.sentinels.queued'); }, tone: 'plain', Icon: Clock },
  running: { get label() { return t('phoneParts.sentinels.running'); }, tone: 'peach', Icon: Loader },
  'needs-you': { get label() { return t('phoneParts.sentinels.needsYou'); }, tone: 'butter', Icon: Hand },
  done: { get label() { return t('phoneParts.sentinels.done'); }, tone: 'mint', Icon: Check },
  skipped: { get label() { return t('phoneParts.sentinels.skipped'); }, tone: 'plain', Icon: Minus },
  failed: { get label() { return t('phoneParts.sentinels.failed'); }, tone: 'rose', Icon: X },
  stopped: { get label() { return t('phoneParts.sentinels.stopped'); }, tone: 'plain', Icon: CircleDot },
};
export const runStateOf = (state: string) => RUN[state] ?? { label: state, tone: 'plain' as Tone, Icon: CircleDot };

/** A step's kind as an icon (the page's "what it does"); Ask Claude gets Claude's mark, as the Avatar draws it. */
const STEP: Record<string, LucideIcon> = { claude: SquareTerminal, script: Terminal, notify: Bell, http: Globe, pr: GitPullRequest, merge: GitMerge, message: MessageSquare, friend: Users, trigger: Play, measure: Gauge };
export const stepIcon = (kind: string): LucideIcon => STEP[kind] ?? CircleDot;

/** When you last looked at your sentinels (kv): Home counts the runs that ended since. */
export const SENTINEL_SEEN = 'sentinel.seen';

export const sentinelHref = (id: string): string => `/sentinel/${encodeURIComponent(id)}`;

/** "7:00", or "Tue 7:00" when it isn't today. */
export function nextText(at: number | undefined, now = Date.now()): string | undefined {
  if (!at) return undefined;
  const d = new Date(at);
  const time = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  return new Date(now).toDateString() === d.toDateString() ? time : `${formatDateWith(d, { weekday: 'short' })} ${time}`;
}

/** The row's caption: "Every day at 7:00 · 3 commits landed", or that it's paused. */
export function sentinelCaption(s: SentinelSummary): string {
  if (s.paused) return s.pausedWhy ?? t('phoneParts.sentinels.pausedWhat', { what: s.sentence });
  return [s.sentence, s.last?.headline].filter(Boolean).join(' · ');
}

export function SentinelRow({ s, first }: { readonly s: SentinelSummary; readonly first?: boolean }) {
  const Icon = sentinelIcon(s.icon);
  const st = s.last ? runStateOf(s.last.state) : undefined;
  const tone: Tone = s.paused ? 'plain' : s.pausedWhy ? 'rose' : 'sky';
  const when = s.last ? ago(s.last.at) : undefined;
  return (
    <View>
      {!first ? <Hairline style={{ marginLeft: 58 }} /> : null}
      <Press scaleTo={0.985} onPress={() => router.push(sentinelHref(s.id) as never)} accessibilityLabel={`${s.name}, ${sentinelCaption(s)}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, paddingHorizontal: 14, opacity: s.paused ? 0.75 : 1 }}>
        <View style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: toneBg(tone) }}>
          {s.paused ? <CirclePause color={toneInk(tone)} size={16} strokeWidth={1.9} /> : <Icon color={toneInk(tone)} size={16} strokeWidth={1.9} />}
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <T v="body" numberOfLines={1} style={{ fontWeight: '500' }}>
            {s.name}
          </T>
          <T v="caption" numberOfLines={2}>
            {sentinelCaption(s)}
            {when && !s.paused ? ` · ${when}` : ''}
          </T>
        </View>
        {s.paused ? <Pill label={t('phoneParts.sentinels.paused')} /> : st ? <Pill label={st.label} tone={st.tone} /> : null}
      </Press>
    </View>
  );
}

/** Every sentinel, by project (Your Mac's last), as the Mac groups them. */
export function SentinelsList() {
  const on = useSupports('sentinel');
  const view = useView<SentinelsView>(on ? 'sentinels' : undefined);
  if (!on) {
    return (
      <Card style={{ marginHorizontal: 16, padding: 18 }}>
        <T v="heading">{t('phoneParts.sentinels.needsNewer')}</T>
        <T v="callout" style={{ marginTop: 4 }}>
          {t('phoneParts.sentinels.needsNewerHint')}
        </T>
      </Card>
    );
  }
  if (!view) return <T v="callout" style={{ paddingHorizontal: 20 }}>{t('phoneParts.sentinels.loading')}</T>;
  const list = view.data.sentinels;
  if (!list.length && view.data.enabled) return <SentinelIdeas chat={view.data.chat?.topic} />;
  if (!list.length) {
    return (
      <Card style={{ marginHorizontal: 16, padding: 18 }}>
        <T v="heading">{t('phoneParts.sentinels.none')}</T>
        <T v="callout" style={{ marginTop: 4 }}>
          {view.data.enabled ? t('phoneParts.sentinels.noneHint') : t('phoneParts.sentinels.runsInApp')}
        </T>
      </Card>
    );
  }
  const groups = new Map<string, { name: string; icon?: string; items: SentinelSummary[] }>();
  for (const s of list) {
    const key = s.projectId ?? '';
    const g = groups.get(key) ?? { name: s.project ?? (s.projectId ? t('phoneParts.sentinels.aProject') : t('phoneParts.yourMac')), items: [] };
    g.items.push(s);
    groups.set(key, g);
  }
  const ordered = [...groups.entries()].sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : 0));
  return (
    <View style={{ gap: 22 }}>
      {ordered.map(([key, g], gi) => (
        <Animated.View key={key || 'mac'} entering={FadeIn.duration(180)} layout={LinearTransition.duration(180)} style={{ gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20 }}>
            <ProjectMark name={g.name} size={26} />
            <T v="heading" style={{ flex: 1 }} numberOfLines={1}>
              {g.name}
            </T>
            <T v="caption">{g.items.length}</T>
          </View>
          <Card style={{ marginHorizontal: 16 }}>
            {g.items.map((s, i) => (
              <SentinelRow key={s.id} s={s} first={i === 0} />
            ))}
          </Card>
        </Animated.View>
      ))}
      <T v="caption" c={color.text3} style={{ textAlign: 'center', paddingHorizontal: 24 }}>
        {t('phoneParts.sentinels.madeOnMac')}
      </T>
    </View>
  );
}

/** Without a last look, "since you looked" means the last 12 hours. */
const FIRST_LOOK_MS = 12 * 3_600_000;

/**
 * Home's Sentinel row (1.21): how many runs ended since you last opened Sentinel (and how many of
 * them failed), else how many watch and the next run. A tap opens the list. Nothing to show
 * without sentinels.
 */
export function SentinelHome() {
  const on = useSupports('sentinel');
  const view = useView<SentinelsView>(on ? 'sentinels' : undefined);
  const v = view?.data;
  if (!v?.sentinels.length) return null;
  const seen = kv.get<number>(SENTINEL_SEEN) ?? Date.now() - FIRST_LOOK_MS;
  const fresh = v.recent.filter((r) => r.at > seen && r.state !== 'skipped');
  const failed = fresh.filter((r) => r.state === 'failed').length;
  const watching = v.sentinels.filter((s) => !s.paused).length;
  const next = v.sentinels.flatMap((s) => (s.nextAt ? [s.nextAt] : [])).sort((a, b) => a - b)[0];
  const live = v.sentinels.some((s) => s.live);
  const caption = fresh.length
    ? [t('phoneParts.sentinels.ranSince', { count: fresh.length }), failed ? t('phoneParts.sentinels.failedCount', { count: failed }) : undefined].filter(Boolean).join(' · ')
    : [watching ? t('phoneParts.sentinels.watching', { count: watching }) : t('phoneParts.sentinels.allPaused'), live ? t('phoneParts.sentinels.oneRunning') : next ? t('phoneParts.sentinels.nextAt', { when: nextText(next) ?? '' }) : undefined].filter(Boolean).join(' · ');
  return (
    <Press scaleTo={0.985} onPress={() => router.push('/sentinels' as never)} accessibilityLabel={t('phoneParts.sentinels.homeLabel', { caption })} style={{ marginHorizontal: 16, marginTop: 28 }}>
      <Card style={{ padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <IconBadge Icon={Shield} tone={failed ? 'rose' : 'sky'} />
        <View style={{ flex: 1 }}>
          <T v="heading" numberOfLines={1}>
            {/* i18n-ignore */}
            Sentinel
          </T>
          <T v="caption" numberOfLines={1}>
            {caption}
          </T>
        </View>
        {fresh.length ? <Pill label={String(fresh.length)} tone={failed ? 'rose' : 'mint'} /> : null}
        <ChevronRight color={color.text3} size={18} />
      </Card>
    </Press>
  );
}
