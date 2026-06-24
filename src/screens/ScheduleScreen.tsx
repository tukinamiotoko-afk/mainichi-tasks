import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, StatusBar } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSQLiteContext } from 'expo-sqlite';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { LinearGradient } from 'expo-linear-gradient';
import { RootStackParamList } from '../../App';
import { Task, getToday, getTasks, getCompletedTaskIds, markComplete, markIncomplete } from '../db/database';
import { isDueToday, WEEKDAYS } from '../constants/taskMeta';
import { GRAD, GRAD_START, GRAD_END } from '../constants/theme';
import TabBar from '../components/TabBar';

const C = {
  header:    '#1d4ed8',
  body:      '#ffffff',
  card:      '#ffffff',
  grid:      '#d1d5db',
  headerCell:'#f1f5f9',
  primary:   '#2563eb',
  primarySoft:'#dbeafe',
  onPrimary: '#ffffff',
  onDark:    '#1f2937',
  muted:     '#6b7280',
  ink:       '#111827',
  success:   '#16a34a',
  successBg: '#dcfce7',
};

// Day runs 5:00 → 0:00 (midnight) like the reference timetable.
const HOURS: number[] = [...Array.from({ length: 19 }, (_, i) => i + 5), 0];
const hourLabel = (h: number) => `${h}:00`;
const bucketHour = (h: number) => (h >= 5 && h <= 23 ? h : 0); // 0–4時 は 0:00 行へ

type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'Schedule'> };

export default function ScheduleScreen({ navigation }: Props) {
  const db = useSQLiteContext();
  const insets = useSafeAreaInsets();
  const today = getToday();
  const now = new Date();
  const dateLabel = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')} (${WEEKDAYS[now.getDay()]})`;
  const nowHour = now.getHours();

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
  const timed = due.filter((t) => t.scheduled_time);
  const untimed = due.filter((t) => !t.scheduled_time);

  const byHour: Record<number, Task[]> = {};
  for (const t of timed) {
    const h = bucketHour(Number(t.scheduled_time!.slice(0, 2)));
    (byHour[h] ??= []).push(t);
  }
  for (const h of Object.keys(byHour)) {
    byHour[Number(h)].sort((a, b) => (a.scheduled_time! < b.scheduled_time! ? -1 : 1));
  }

  const renderTask = (task: Task) => {
    const done = completedIds.has(task.id);
    return (
      <TouchableOpacity key={task.id} style={[s.taskPill, done && s.taskPillDone]} onPress={() => toggle(task.id)} activeOpacity={0.7}>
        <Text style={[s.pillTime, done && s.pillTimeDone]}>{task.scheduled_time}</Text>
        <Text style={[s.pillTitle, done && s.pillTitleDone]} numberOfLines={1}>
          {task.icon ? `${task.icon} ` : ''}{task.title}
        </Text>
        {done && <Text style={s.pillCheck}>✓</Text>}
      </TouchableOpacity>
    );
  };

  return (
    <View style={s.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      <LinearGradient colors={GRAD.header} start={GRAD_START} end={GRAD_END} style={[s.headerCard, { paddingTop: insets.top + 12 }]}>
        <Text style={s.headerTitle}>タイムスケジュール表</Text>
        <Text style={s.headerSub}>日付：{dateLabel}</Text>
      </LinearGradient>

      <ScrollView style={s.bodyView} contentContainerStyle={{ padding: 12, paddingBottom: 28 }}>
        <View style={s.table}>
          {/* header row */}
          <View style={[s.row, s.headRow]}>
            <View style={[s.timeCell, s.headCell]}><Text style={s.headText}>時間</Text></View>
            <View style={[s.contentCell, s.headCell]}><Text style={s.headText}>内容</Text></View>
          </View>

          {HOURS.map((h, idx) => {
            const items = byHour[h] ?? [];
            const isNow = h === bucketHour(nowHour);
            return (
              <View key={h} style={[s.row, idx === HOURS.length - 1 && s.rowLast]}>
                <View style={[s.timeCell, isNow && s.timeCellNow]}>
                  <Text style={[s.timeText, isNow && s.timeTextNow]}>{hourLabel(h)}</Text>
                </View>
                <View style={s.contentCell}>
                  {items.map(renderTask)}
                </View>
              </View>
            );
          })}
        </View>

        {untimed.length > 0 && (
          <View style={s.untimedBox}>
            <Text style={s.untimedLabel}>時間未設定</Text>
            {untimed.map(renderTask)}
          </View>
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

  table: { borderWidth: 1, borderColor: C.grid, borderRadius: 8, overflow: 'hidden', backgroundColor: C.card },
  row: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: C.grid, minHeight: 44 },
  rowLast: { borderBottomWidth: 0 },
  headRow: { backgroundColor: C.headerCell },
  timeCell: { width: 64, alignItems: 'center', justifyContent: 'center', paddingVertical: 6, borderRightWidth: 1, borderRightColor: C.grid },
  timeCellNow: { backgroundColor: C.primarySoft },
  contentCell: { flex: 1, paddingHorizontal: 6, paddingVertical: 5, justifyContent: 'center', gap: 4 },
  headCell: { paddingVertical: 8 },
  headText: { color: C.onDark, fontSize: 13, fontWeight: '800' },
  timeText: { color: C.onDark, fontSize: 13, fontWeight: '700' },
  timeTextNow: { color: C.primary, fontWeight: '800' },

  taskPill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.primarySoft, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6 },
  taskPillDone: { backgroundColor: C.successBg },
  pillTime: { color: C.primary, fontSize: 11, fontWeight: '800' },
  pillTimeDone: { color: C.success },
  pillTitle: { flex: 1, color: C.onDark, fontSize: 13, fontWeight: '700' },
  pillTitleDone: { color: C.muted, textDecorationLine: 'line-through' },
  pillCheck: { color: C.success, fontSize: 13, fontWeight: '900' },

  untimedBox: { marginTop: 14, gap: 6 },
  untimedLabel: { color: C.muted, fontSize: 12, fontWeight: '800', marginBottom: 2 },
});
