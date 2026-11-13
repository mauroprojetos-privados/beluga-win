import { ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Header, Screen, useScrolled } from '../components/Screen';
import { useT } from '../lib/language';
import { TasksList } from '../components/Tasks';

/** All tasks (also Work › Tasks), opened from Home when something waits for your review. */
export default function Tasks() {
  const { scrolled, onScroll } = useScrolled();
  const insets = useSafeAreaInsets();
  const t = useT();
  return (
    <Screen>
      <Header scrolled={scrolled} back title={t('phone.work.tasks')} />
      <ScrollView onScroll={onScroll} scrollEventThrottle={32} contentContainerStyle={{ paddingTop: 8, paddingBottom: insets.bottom + 40 }}>
        <TasksList />
      </ScrollView>
    </Screen>
  );
}
