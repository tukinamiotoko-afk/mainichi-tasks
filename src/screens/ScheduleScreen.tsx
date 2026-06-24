import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, StatusBar } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSQLiteContext } from 'expo-sqlite';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { LinearGradient } from 'expo-linear-gradient';
import { RootStackParamList } from '../../App';
import { Task, getToday, getTasks, getCompletedTaskIds, markComplete, markIncomplete } from '../db/database';
import { isDueToday, frequencyLabel, WEEKDAYS } from '../constants/taskMeta';
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
};

type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'Schedule'> };

export default function ScheduleScreen({ navigation }: Props) {
  const db = useSQLiteContext();
  const insets = useSafeAreaInsets();
  const today = getToday();
  const now = new Date();
  const dateLabel = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')} (${WEEKDAYS[now.getDay()]})`;

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

  const due = tasks.filter((t) => isDueToday(t, now));
  const timed = due.filter((t) => t.scheduled_time).sort((a, b) => (a.scheduled_time! < b.scheduled_time! ? -1 : 1));
  const untimed = due.filter((t) => !t.scheduled_time);
  const doneCount = due.filter((t) => completedIds.has(t.id)).length;

  const renderCard = (task: Task) => {
    const isDone = completedIds.has(task.id);
    return (
      <TouchableOpacity style={[s.card, isDone && s.cardDone]} onPress={() => toggle(task.id)} activeOpacity={0.7}>
        <View style={[s.check, isDone && s.checkDone]}>{isDone && <Text style={s.checkMark}>✓</Text>}</View>
        <View style={s.cardText}>
          <Text style={[s.cardTitle, isDone && s.cardTitleDone]} numberOfLines={1}>
            {task.icon ? `${task.icon} ` : ''}{task.title}
          </Text>
          <Text style={s.cardSub}>{frequencyLabel(task)}{task.notify ? ' ・ 🔔' : ''}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={s.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      <LinearGradient colors={GRAD.header} start={GRAD_START} end={GRAD_END} style={[s.headerCard, { paddingTop: insets.top + 12 }]}>
        <Text style={s.headerTitle}>タイムスケジュール</Text>
        <Text style={s.headerSub}>{dateLabel} ・ {doneCount}/{due.length} 完了</Text>
      </LinearGradient>

      <ScrollView style={s.bodyView} contentContainerStyle={{ padding: 16, paddingBottom: 24 }}>
        {due.length === 0 ? (
          <View style={s.empty}>
            <Text style={s.emptyTitle}>今日の予定はありません</Text>
            <Text style={s.emptyBody}>頻度が「今日」に当たるタスクがここに並びます</Text>
          </View>
        ) : (
          <>
            {timed.map((task, i) => (
              <View key={task.id} style={s.timeRow}>
                <Text style={s.timeLabel}>{task.scheduled_time}</Text>
                <View style={s.lineCol}>
                  <View style={[s.dot, completedIds.has(task.id) && s.dotDone]} />
                  {i < timed.length - 1 && <View style={s.line} />}
                </View>
                <View style={s.cardWrap}>{renderCard(task)}</View>
              </View>
            ))}

            {untimed.length > 0 && (
              <>
                <Text style={s.sectionLabel}>時間未設定</Text>
                {untimed.map((task) => (
                  <View key={task.id} style={s.untimedWrap}>{renderCard(task)}</View>
                ))}
              </>
            )}
          </>
        )}
      </ScrollView>

      <TabBar current="Schedule" navigation={navigation} />
    </View>
  );
}

const s = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: C.body },
  headerCard: { backgroundColor: C.header, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 18, gap: 4 },
  headerTitle: { color: '#ffffff', fontSize: 20, fontWeight: '800' },
  headerSub: { color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '700' },

  bodyView: { flex: 1, backgroundColor: C.body },

  timeRow: { flexDirection: 'row', alignItems: 'stretch' },
  timeLabel: { width: 46, color: C.ink, fontSize: 13, fontWeight: '800', paddingTop: 16 },
  lineCol: { width: 22, alignItems: 'center' },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: C.border, borderWidth: 2, borderColor: C.primary, marginTop: 17 },
  dotDone: { backgroundColor: C.primary },
  line: { flex: 1, width: 2, backgroundColor: C.border, marginTop: 2 },
  cardWrap: { flex: 1, paddingBottom: 10 },
  untimedWrap: { paddingBottom: 10 },

  sectionLabel: { color: C.muted, fontSize: 11, fontWeight: '800', letterSpacing: 0.5, marginTop: 8, marginBottom: 8 },

  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.card, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2,
  },
  cardDone: { opacity: 0.6 },
  check: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  checkDone: { backgroundColor: C.primary, borderColor: C.primary },
  checkMark: { color: C.onPrimary, fontSize: 11, fontWeight: '700' },
  cardText: { flex: 1, gap: 2 },
  cardTitle: { color: C.onDark, fontSize: 14, fontWeight: '600' },
  cardTitleDone: { color: C.muted, textDecorationLine: 'line-through' },
  cardSub: { color: C.muted, fontSize: 11, fontWeight: '700' },

  empty: { paddingVertical: 60, alignItems: 'center', gap: 8 },
  emptyTitle: { color: C.ink, fontSize: 16, fontWeight: '700' },
  emptyBody: { color: C.muted, fontSize: 13, textAlign: 'center', paddingHorizontal: 24 },
});
