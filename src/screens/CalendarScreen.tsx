import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, StatusBar } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSQLiteContext } from 'expo-sqlite';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { LinearGradient } from 'expo-linear-gradient';
import { RootStackParamList } from '../../App';
import { Task, getTasks, getCompletionsForMonth } from '../db/database';
import { GRAD, GRAD_START, GRAD_END } from '../constants/theme';
import TabBar from '../components/TabBar';

const C = {
  header:    '#60a5fa',
  body:      '#f4f8ff',
  card:      '#ffffff',
  border:    '#dbeafe',
  primary:   '#60a5fa',
  onPrimary: '#ffffff',
  onDark:    '#2d3748',
  muted:     '#93c5fd',
  stone:     '#3b82f6',
  cellEmpty: '#eef4ff',
};

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'Calendar'> };

export default function CalendarScreen({ navigation }: Props) {
  const db = useSQLiteContext();
  const insets = useSafeAreaInsets();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [tasks, setTasks] = useState<Task[]>([]);
  // task_id -> set of completed day-of-month numbers
  const [doneByTask, setDoneByTask] = useState<Record<number, Set<number>>>({});

  const load = useCallback(async () => {
    const [allTasks, completions] = await Promise.all([
      getTasks(db),
      getCompletionsForMonth(db, year, month),
    ]);
    const map: Record<number, Set<number>> = {};
    for (const c of completions) {
      const day = Number(c.date.slice(8, 10));
      (map[c.task_id] ??= new Set()).add(day);
    }
    setTasks(allTasks);
    setDoneByTask(map);
  }, [db, year, month]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const prevMonth = () => { if (month === 1) { setMonth(12); setYear(y => y - 1); } else setMonth(m => m - 1); };
  const nextMonth = () => { if (month === 12) { setMonth(1); setYear(y => y + 1); } else setMonth(m => m + 1); };

  const firstDow = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const isThisMonth = year === now.getFullYear() && month === now.getMonth() + 1;
  const todayDay = now.getDate();

  const renderMini = (taskId: number) => {
    const done = doneByTask[taskId];
    return (
      <View style={s.grid}>
        {cells.map((day, i) => {
          if (!day) return <View key={`e-${i}`} style={s.cell} />;
          const isDone = !!done?.has(day);
          const isToday = isThisMonth && day === todayDay;
          const dow = i % 7;
          return (
            <View key={`d-${i}`} style={s.cell}>
              <View style={[s.dayBox, isDone && s.dayBoxDone, isToday && !isDone && s.dayBoxToday]}>
                <Text style={[
                  s.dayNum,
                  dow === 0 && s.sun,
                  dow === 6 && s.sat,
                  isDone && s.dayNumDone,
                ]}>
                  {day}
                </Text>
              </View>
            </View>
          );
        })}
      </View>
    );
  };

  return (
    <View style={s.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      <LinearGradient colors={GRAD.header} start={GRAD_START} end={GRAD_END} style={[s.headerCard, { paddingTop: insets.top + 12 }]}>
        <View style={s.monthNav}>
          <TouchableOpacity onPress={prevMonth} style={s.navBtn}>
            <Text style={s.navBtnText}>‹</Text>
          </TouchableOpacity>
          <Text style={s.monthLabel}>{year}年{month}月</Text>
          <TouchableOpacity onPress={nextMonth} style={s.navBtn}>
            <Text style={s.navBtnText}>›</Text>
          </TouchableOpacity>
        </View>
      </LinearGradient>

      <ScrollView style={s.body} contentContainerStyle={{ padding: 12, gap: 12, paddingBottom: 24 }}>
        {tasks.length === 0 ? (
          <View style={s.empty}>
            <Text style={s.emptyTitle}>タスクがありません</Text>
            <Text style={s.emptyBody}>タスク画面で追加すると、ここに月別の記録が出ます</Text>
          </View>
        ) : (
          tasks.map((task) => {
            const count = doneByTask[task.id]?.size ?? 0;
            return (
              <View key={task.id} style={s.taskCard}>
                <View style={s.taskHeader}>
                  <Text style={s.taskTitle} numberOfLines={1}>
                    {task.icon ? `${task.icon} ` : ''}{task.title}
                  </Text>
                  <View style={s.countBadge}>
                    <Text style={s.countText}>{count}日</Text>
                  </View>
                </View>
                <View style={s.weekRow}>
                  {WEEKDAYS.map((w, i) => (
                    <View key={w} style={s.cell}>
                      <Text style={[s.weekLabel, i === 0 && s.sun, i === 6 && s.sat]}>{w}</Text>
                    </View>
                  ))}
                </View>
                {renderMini(task.id)}
              </View>
            );
          })
        )}
      </ScrollView>

      <TabBar current="Calendar" navigation={navigation} />
    </View>
  );
}

const s = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: C.body },
  headerCard: { backgroundColor: C.header, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 20 },
  monthNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  navBtn: { padding: 8 },
  navBtnText: { color: '#ffffff', fontSize: 28, fontWeight: '300' },
  monthLabel: { color: '#ffffff', fontSize: 18, fontWeight: '700' },

  body: { flex: 1, backgroundColor: C.body },

  taskCard: {
    backgroundColor: C.card, borderRadius: 16, padding: 12, gap: 6,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 2,
  },
  taskHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
  taskTitle: { flex: 1, color: C.onDark, fontSize: 14, fontWeight: '700' },
  countBadge: { backgroundColor: C.primary, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 3 },
  countText: { color: C.onPrimary, fontSize: 12, fontWeight: '800' },

  weekRow: { flexDirection: 'row' },
  weekLabel: { textAlign: 'center', color: C.muted, fontSize: 11, fontWeight: '700' },

  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: '14.28%', alignItems: 'center', paddingVertical: 2 },
  dayBox: { width: 30, height: 28, borderRadius: 7, backgroundColor: C.cellEmpty, alignItems: 'center', justifyContent: 'center' },
  dayBoxDone: { backgroundColor: C.primary },
  dayBoxToday: { borderWidth: 1.5, borderColor: C.primary },
  dayNum: { fontSize: 12, fontWeight: '600', color: C.onDark },
  dayNumDone: { color: C.onPrimary, fontWeight: '800' },
  sun: { color: '#e53e3e' },
  sat: { color: '#3182ce' },

  empty: { paddingVertical: 60, alignItems: 'center', gap: 8 },
  emptyTitle: { color: C.stone, fontSize: 16, fontWeight: '700' },
  emptyBody: { color: C.muted, fontSize: 13, textAlign: 'center', paddingHorizontal: 24 },
});
