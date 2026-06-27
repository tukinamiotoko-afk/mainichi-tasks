import React, { useState, useCallback, useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, StatusBar } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSQLiteContext } from 'expo-sqlite';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../App';
import {
  Task, getToday, getTasks, getCompletedTaskIds,
  markComplete, markIncomplete, getSetting,
} from '../db/database';
import { WEEKDAYS } from '../constants/taskMeta';
import TabBar from '../components/TabBar';
import { useTheme, ColorSet } from '../contexts/ThemeContext';

const pad = (n: number) => String(n).padStart(2, '0');

const HOURS: number[] = [...Array.from({ length: 19 }, (_, i) => i + 5), 0, 1, 2, 3, 4];
const hourLabel = (h: number) => `${h}:00`;
const bucketHour = (h: number) => h;

type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'Schedule'> };

const makeStyles = (C: ColorSet) => StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: C.body },
  topArea: { backgroundColor: C.body, paddingHorizontal: 12, paddingBottom: 8 },
  dateCard: { backgroundColor: C.card, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', shadowColor: '#000', shadowOpacity: 0.07, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  dateNavBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.primarySoft, alignItems: 'center', justifyContent: 'center' },
  dateNavArrow: { color: C.primary, fontSize: 24, fontWeight: '800', marginTop: -2 },
  dateNavCenter: { flex: 1, alignItems: 'center' },
  dateText: { color: C.ink, fontSize: 15, fontWeight: '800' },
  dateTodayHint: { color: C.muted, fontSize: 10, fontWeight: '700', marginTop: 1 },

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

export default function ScheduleScreen({ navigation }: Props) {
  const db = useSQLiteContext();
  const insets = useSafeAreaInsets();
  const { C } = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  const today = getToday();
  const now = new Date();
  const nowHour = now.getHours();

  const [selectedDate, setSelectedDate] = useState(today);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [completedIds, setCompletedIds] = useState<Set<number>>(new Set());
  const [scheduleSize, setScheduleSize] = useState<'small' | 'normal' | 'large'>('normal');
  const rowMinHeight = scheduleSize === 'small' ? 36 : scheduleSize === 'large' ? 68 : 44;

  const isToday = selectedDate === today;
  const selDateObj = useMemo(() => new Date(`${selectedDate}T00:00:00`), [selectedDate]);
  const dateLabel = `${selDateObj.getFullYear()}/${pad(selDateObj.getMonth() + 1)}/${pad(selDateObj.getDate())} (${WEEKDAYS[selDateObj.getDay()]})`;

  const shiftSelected = (days: number) => {
    const d = new Date(`${selectedDate}T00:00:00`);
    d.setDate(d.getDate() + days);
    setSelectedDate(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
  };

  const load = useCallback(async () => {
    const [ts, ids, size] = await Promise.all([
      getTasks(db),
      getCompletedTaskIds(db, selectedDate),
      getSetting(db, 'schedule_size'),
    ]);
    setTasks(ts);
    setCompletedIds(new Set(ids));
    if (size === 'small' || size === 'large' || size === 'normal') setScheduleSize(size);
  }, [db, selectedDate]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const toggle = async (id: number) => {
    if (completedIds.has(id)) await markIncomplete(db, id, selectedDate);
    else await markComplete(db, id, selectedDate);
    load();
  };

  const allActive = tasks.filter((t) => {
    if (t.freq_type === 'once' && t.once_date && t.once_date < selectedDate) return false;
    if (t.freq_type === 'dates') {
      const ds = (t.freq_dates ?? '').split(',').filter(Boolean);
      if (ds.length > 0 && ds.every((d) => d < selectedDate)) return false;
    }
    return true;
  });
  const timedAll = allActive.filter((t) => t.scheduled_time).sort((a, b) =>
    a.scheduled_time! < b.scheduled_time! ? -1 : a.scheduled_time! > b.scheduled_time! ? 1 : a.sort_order - b.sort_order
  );
  const untimedAll = allActive.filter((t) => !t.scheduled_time);

  const byHour: Record<number, Task[]> = {};
  for (const t of timedAll) {
    const h = bucketHour(Number(t.scheduled_time!.slice(0, 2)));
    (byHour[h] ??= []).push(t);
  }
  for (const h of Object.keys(byHour)) {
    byHour[Number(h)].sort((a, b) => (a.scheduled_time! < b.scheduled_time! ? -1 : 1));
  }

  const renderPill = (task: Task) => {
    const done = completedIds.has(task.id);
    return (
      <TouchableOpacity key={task.id} style={[s.taskPill, done && s.taskPillDone]} onPress={() => toggle(task.id)} activeOpacity={0.7}>
        {task.scheduled_time && <Text style={[s.pillTime, done && s.pillTimeDone]}>{task.scheduled_time}</Text>}
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

      <View style={[s.topArea, { paddingTop: insets.top + 8 }]}>
        <View style={s.dateCard}>
          <TouchableOpacity onPress={() => shiftSelected(-1)} style={s.dateNavBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={s.dateNavArrow}>‹</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setSelectedDate(today)} activeOpacity={0.7} style={s.dateNavCenter}>
            <Text style={s.dateText}>{dateLabel}</Text>
            {!isToday && <Text style={s.dateTodayHint}>タップで今日へ</Text>}
          </TouchableOpacity>
          <TouchableOpacity onPress={() => shiftSelected(1)} style={s.dateNavBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={s.dateNavArrow}>›</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView style={s.bodyView} contentContainerStyle={{ padding: 12, paddingBottom: 28 }}>
        <View style={s.table}>
          <View style={[s.row, s.headRow]}>
            <View style={[s.timeCell, s.headCell]}><Text style={s.headText}>時間</Text></View>
            <View style={[s.contentCell, s.headCell]}><Text style={s.headText}>内容</Text></View>
          </View>
          {HOURS.map((h, idx) => {
            const items = byHour[h] ?? [];
            const isNow = isToday && h === bucketHour(nowHour);
            return (
              <View
                key={h}
                style={[s.row, { minHeight: rowMinHeight }, idx === HOURS.length - 1 && s.rowLast]}
              >
                <View style={[s.timeCell, isNow && s.timeCellNow]}>
                  <Text style={[s.timeText, isNow && s.timeTextNow]}>{hourLabel(h)}</Text>
                </View>
                <View style={s.contentCell}>{items.map(renderPill)}</View>
              </View>
            );
          })}
        </View>

        {untimedAll.length > 0 && (
          <View style={s.untimedBox}>
            <Text style={s.untimedLabel}>時間未設定</Text>
            {untimedAll.map(renderPill)}
          </View>
        )}
      </ScrollView>

      <TabBar current="Schedule" navigation={navigation} />
    </View>
  );
}
