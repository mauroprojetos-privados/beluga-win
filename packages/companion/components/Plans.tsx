import { router } from 'expo-router';
import { ChevronRight, Workflow } from 'lucide-react-native';
import { View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useView } from '../lib/hooks';
import type { PlansView } from '../lib/link/protocol';
import { t } from '../lib/language';
import { color } from '../lib/theme';
import { Card, IconBadge, Press, T, toneInk, toneOf } from './ui';

const STATE: Record<string, () => string> = { running: () => t('phoneParts.sentinels.running'), done: () => t('phoneParts.sentinels.done'), draft: () => t('phoneParts.plans.draft'), waiting: () => t('phoneParts.plans.waiting'), todo: () => t('phoneParts.plans.todo') };

/** The plans, as cards with their progress (Work › Plans, and /plans). */
export function PlansList() {
  const plans = useView<PlansView>('plans');
  const list = plans?.data.plans ?? [];
  if (!plans) return <T v="callout" style={{ paddingHorizontal: 20 }}>{t('phoneParts.plans.loading')}</T>;
  if (!list.length) {
    return (
      <Card style={{ marginHorizontal: 16, padding: 18 }}>
        <T v="heading">{t('phoneParts.plans.none')}</T>
        <T v="callout" style={{ marginTop: 4 }}>
          {t('phoneParts.plans.madeOnMac')}
        </T>
      </Card>
    );
  }
  return (
    <View style={{ gap: 10 }}>
      {list.map((p, i) => {
        const tone = toneOf(p.state);
        const pct = p.total ? p.done / p.total : 0;
        return (
          <Animated.View key={p.id} entering={FadeIn.duration(180)}>
            <Press scaleTo={0.985} onPress={() => router.push(`/plan/${p.id}`)} style={{ marginHorizontal: 16 }}>
              <Card style={{ padding: 14, gap: 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <IconBadge Icon={Workflow} tone={tone === 'plain' ? 'butter' : tone} />
                  <View style={{ flex: 1 }}>
                    <T v="heading" numberOfLines={1}>
                      {p.title}
                    </T>
                    <T v="caption">
                      {t('phoneParts.plans.progress', { state: STATE[p.state]?.() ?? p.state, done: p.done, total: p.total })}
                    </T>
                  </View>
                  <ChevronRight color={color.text3} size={18} />
                </View>
                <View style={{ height: 6, borderRadius: 3, backgroundColor: color.sunken, overflow: 'hidden' }}>
                  <View style={{ width: `${pct * 100}%`, height: 6, borderRadius: 3, backgroundColor: toneInk(tone === 'plain' ? 'mint' : tone), opacity: 0.5 }} />
                </View>
              </Card>
            </Press>
          </Animated.View>
        );
      })}
    </View>
  );
}
