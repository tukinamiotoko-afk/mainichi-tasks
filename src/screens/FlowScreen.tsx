import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, StatusBar } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSQLiteContext } from 'expo-sqlite';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { LinearGradient } from 'expo-linear-gradient';
import { RootStackParamList } from '../../App';
import { Task, getToday, getTasks, getCompletedTaskIds, markComplete, markIncomplete } from '../db/database';
import { isDueToday } from '../constants/taskMeta';
import { GRAD, GRAD_START, GRAD_END } from '../constants/theme';
import TabBar from '../components/TabBar';

const C = {
  header:    '#2563eb',
  body:      '#f4f8ff',
  card:      '#ffffff',
  border:    '#dbeafe',
  primary:   '#2563eb',
  onPrimary: '#ffffff',
  onDark:    '#2d3748',
  muted:     '#6b7280',
  ink:       '#111827',
  success:   '#16a34a',
};

type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'Flow'> };

export default function FlowScreen({ navigation }: Props) {
  const db = useSQLiteContext();
  const insets = useSafeAreaInsets();
  const today = getToday();
  const now = new Date();

  const [tasks, setTasks] = useState<Task[]>([]);
  const [completedIds, setCompletedIds] = useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    const ts = await getTasks(db);
    const ids = await getCompletedTaskIds(db, today);
    setTasks(ts);
    setCompletedIds(new Set(ids));
  }, [db, today]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const toggle = async (id: number) => {
    if (completedIds.has(id)) await markIncomplete(db, id, today);
    else await markComplete(db, id, today);
    load();
  };

  // Due-today tasks in their saved order, ordered so the timed ones come first.
  const due = tasks
    .filter((t) => isDueToday(t, now))
    .sort((a, b) => {
      const at = a.scheduled_time ?? '99:99';
      const bt = b.scheduled_time ?? '99:99';
      if (at !== bt) return at < bt ? -1 : 1;
      return a.sort_order - b.sort_order;
    });
  const doneCount = due.filter((t) => completedIds.has(t.id)).length;
  const allDone = due.length > 0 && doneCount === due.length;

  return (
    <View style={s.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      <LinearGradient colors={GRAD.header} start={GRAD_START} end={GRAD_END} style={[s.headerCard, { paddingTop: insets.top + 12 }]}>
        <Text style={s.headerTitle}>フローチャート</Text>
        <Text style={s.headerSub}>今日の流れ ・ {doneCount}/{due.length} 完了</Text>
      </LinearGradient>

      <ScrollView style={s.bodyView} contentContainerStyle={s.content}>
        {due.length === 0 ? (
          <View style={s.empty}>
            <Text style={s.emptyTitle}>今日のフローはありません</Text>
            <Text style={s.emptyBody}>頻度が「今日」に当たるタスクが流れになります</Text>
          </View>
        ) : (
          <>
            <View style={s.startNode}><Text style={s.startText}>スタート</Text></View>
            {due.map((task) => {
              const isDone = completedIds.has(task.id);
              return (
                <View key={task.id} style={s.nodeGroup}>
                  <Text style={s.arrow}>▼</Text>
                  <TouchableOpacity
                    style={[s.node, isDone && s.nodeDone]}
                    onPress={() => toggle(task.id)}
                    activeOpacity={0.8}
                  >
                    <View style={[s.nodeCheck, isDone && s.nodeCheckDone]}>
                      <Text style={[s.nodeCheckMark, isDone && s.nodeCheckMarkDone]}>{isDone ? '✓' : ''}</Text>
                    </View>
                    <View style={s.nodeTextWrap}>
                      <Text style={[s.nodeTitle, isDone && s.nodeTitleDone]} numberOfLines={2}>
                        {task.icon ? `${task.icon} ` : ''}{task.title}
                      </Text>
                      {task.scheduled_time && <Text style={s.nodeTime}>{task.scheduled_time}</Text>}
                    </View>
                  </TouchableOpacity>
                </View>
              );
            })}
            <Text style={s.arrow}>▼</Text>
            <View style={[s.goalNode, allDone && s.goalNodeDone]}>
              <Text style={[s.goalText, allDone && s.goalTextDone]}>{allDone ? 'ゴール 🎉' : 'ゴール'}</Text>
            </View>
          </>
        )}
      </ScrollView>

      <TabBar current="Flow" navigation={navigation} />
    </View>
  );
}

const s = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: C.body },
  headerCard: { backgroundColor: C.header, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 18, gap: 4 },
  headerTitle: { color: '#ffffff', fontSize: 20, fontWeight: '800' },
  headerSub: { color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '700' },

  bodyView: { flex: 1, backgroundColor: C.body },
  content: { padding: 16, paddingBottom: 32, alignItems: 'center' },

  startNode: { backgroundColor: C.ink, borderRadius: 20, paddingHorizontal: 22, paddingVertical: 9 },
  startText: { color: '#ffffff', fontSize: 13, fontWeight: '800', letterSpacing: 1 },

  nodeGroup: { alignItems: 'center', width: '100%' },
  arrow: { color: C.primary, fontSize: 16, marginVertical: 4 },

  node: {
    flexDirection: 'row', alignItems: 'center', gap: 12, width: '88%',
    backgroundColor: C.card, borderRadius: 14, borderWidth: 1.5, borderColor: C.border,
    paddingHorizontal: 14, paddingVertical: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2,
  },
  nodeDone: { borderColor: C.success, backgroundColor: '#f0fdf4' },
  nodeCheck: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  nodeCheckDone: { backgroundColor: C.success, borderColor: C.success },
  nodeCheckMark: { color: C.onPrimary, fontSize: 12, fontWeight: '800' },
  nodeCheckMarkDone: { color: '#ffffff' },
  nodeTextWrap: { flex: 1, gap: 2 },
  nodeTitle: { color: C.onDark, fontSize: 14, fontWeight: '700' },
  nodeTitleDone: { color: C.muted, textDecorationLine: 'line-through' },
  nodeTime: { color: C.primary, fontSize: 11, fontWeight: '800' },

  goalNode: { backgroundColor: C.border, borderRadius: 20, paddingHorizontal: 22, paddingVertical: 9 },
  goalNodeDone: { backgroundColor: C.success },
  goalText: { color: C.ink, fontSize: 13, fontWeight: '800', letterSpacing: 1 },
  goalTextDone: { color: '#ffffff' },

  empty: { paddingVertical: 60, alignItems: 'center', gap: 8 },
  emptyTitle: { color: C.ink, fontSize: 16, fontWeight: '700' },
  emptyBody: { color: C.muted, fontSize: 13, textAlign: 'center', paddingHorizontal: 24 },
});
