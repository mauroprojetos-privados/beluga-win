import { useFocusEffect } from 'expo-router';
import { Cable } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Header, Screen, useScrolled } from '../components/Screen';
import { Segments } from '../components/Segments';
import { Button, Card, haptic, Row, T } from '../components/ui';
import { calls } from '../lib/link/calls';
import { store } from '../lib/store';
import { t, useT } from '../lib/language';

interface Agent {
  readonly id: string;
  readonly name: string;
  readonly level: string;
  readonly route?: string;
  readonly suspendedAt?: number;
}
type Kind = 'allowed' | 'asked' | 'refused';
interface Activity {
  readonly ts: number;
  readonly agent: string;
  readonly tool: string;
  readonly target: string;
  readonly decidedBy: string;
  readonly argsHash: string;
  readonly kind: Kind;
}

const levelWords = (): Readonly<Record<string, string>> => ({ ask: t('phoneApp.agents.ask'), trusted: t('phoneApp.agents.trusted'), full: t('phoneApp.agents.full') });
const kindWords = (): Readonly<Record<Kind, string>> => ({ allowed: t('phoneApp.agents.allowed'), asked: t('phoneApp.agents.asked'), refused: t('phoneApp.agents.refused') });
const shownOptions = (): ReadonlyArray<{ key: Kind | 'all'; label: string }> => [
  { key: 'all', label: t('phoneApp.agents.all') },
  { key: 'allowed', label: t('phoneApp.agents.allowed') },
  { key: 'asked', label: t('phoneApp.agents.asked') },
  { key: 'refused', label: t('phoneApp.agents.refused') },
];

/** Settings › External agents (BLG-122): who holds a grant, stopping or revoking them, and what they did with who decided. */
export default function Agents() {
  const { scrolled, onScroll } = useScrolled();
  const insets = useSafeAreaInsets();
  const say = useT();
  const LEVEL_WORDS = levelWords();
  const KIND_WORDS = kindWords();
  const [agents, setAgents] = useState<readonly Agent[]>([]);
  const [activity, setActivity] = useState<readonly Activity[]>([]);
  const [shown, setShown] = useState<Kind | 'all'>('all');

  const look = useCallback((kind: Kind | 'all') => {
    void store.call<readonly Agent[]>(calls.externalAgents(), { queue: false }).then((a) => setAgents(a ?? []), () => undefined);
    void store.call<readonly Activity[]>(calls.externalActivity(kind === 'all' ? undefined : kind), { queue: false }).then((a) => setActivity(a ?? []), () => undefined);
  }, []);
  useFocusEffect(useCallback(() => look(shown), [look, shown]));

  const act = (call: ReturnType<typeof calls.externalStopAll>, done: string): void => {
    haptic.commit();
    void store.call(call, { queue: false }).then(
      () => {
        store.toast({ text: done, tone: 'ok' });
        look(shown);
      },
      (err: unknown) => store.toast({ text: err instanceof Error ? err.message : say('phoneApp.agents.didntReach'), tone: 'error' }),
    );
  };

  return (
    <Screen>
      <Header scrolled={scrolled} back title={say('phoneApp.settings.agents')} />
      <ScrollView onScroll={onScroll} scrollEventThrottle={32} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: insets.bottom + 40, gap: 12 }}>
        {agents.length ? <Button label={say('phoneApp.agents.stopAll')} onPress={() => act(calls.externalStopAll(), say('phoneApp.agents.stopped'))} /> : <T v="caption">{say('phoneApp.agents.none')}</T>}
        {agents.map((a) => (
          <Card key={a.id} style={{ gap: 10 }}>
            <Row first Icon={Cable} tone="lavender" label={a.name} sub={((level) => (a.suspendedAt === undefined ? level : say('phoneApp.agents.suspended', { level })))(a.route === 'remote' && a.level === 'full' ? say('phoneApp.agents.remoteFull') : (LEVEL_WORDS[a.level] ?? a.level))} chevron={false} />
            <View style={{ flexDirection: 'row', gap: 8, padding: 12, paddingTop: 0 }}>
              <Button flex={1} quiet label={say('common.stop')} onPress={() => act(calls.externalStop(a.id, a.name), say('phoneApp.agents.stoppedName', { name: a.name }))} />
              <Button flex={1} quiet label={say('phoneApp.agents.revoke')} onPress={() => act(calls.externalRevoke(a.id, a.name), say('phoneApp.agents.revokedName', { name: a.name }))} />
            </View>
          </Card>
        ))}
        <T v="callout" style={{ fontWeight: '700', marginTop: 8 }}>
          {say('phoneApp.task.activity')}
        </T>
        <Segments value={shown} options={shownOptions()} onChange={setShown} />
        {activity.length ? (
          <Card>
            {activity.map((a, i) => (
              <Row key={`${a.ts} ${a.tool} ${a.argsHash}`} first={i === 0} label={`${a.agent}: ${a.tool}`} sub={`${say(a.decidedBy === 'person' ? 'phoneApp.agents.decidedYou' : 'phoneApp.agents.decidedLevel', { kind: KIND_WORDS[a.kind] })}${a.target ? ` · ${a.target}` : ''}`} chevron={false} />
            ))}
          </Card>
        ) : (
          <T v="caption">{say('phoneApp.agents.nothing')}</T>
        )}
      </ScrollView>
    </Screen>
  );
}
