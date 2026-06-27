import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, StatusBar, Alert, ScrollView, Modal } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSQLiteContext } from 'expo-sqlite';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { LinearGradient } from 'expo-linear-gradient';
import { RootStackParamList } from '../../App';
import {
  Task,
  TimeLog,
  addTimeLog,
  deleteTimeLog,
  countTimeLogsForTaskDate,
  getTasks,
  getTimeLogsForDate,
  getToday,
  getTotalTimeForDate,
  markComplete,
  markIncomplete,
} from '../db/database';
import { GRAD, GRAD_START, GRAD_END } from '../constants/theme';
import TabBar from '../components/TabBar';
import { useTheme, ColorSet } from '../contexts/ThemeContext';

type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'Timer'> };
type TimerItem = {
  task: Task;
  baseSeconds: number;
  startedAtMs: number | null;
  startedAtIso: string | null;
};

const makeStyles = (C: ColorSet) => StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: C.body },
  body: { flex: 1, backgroundColor: C.body },
  content: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 92, gap: 12 },
  clockPanel: { alignItems: 'center', gap: 6, paddingTop: 4, paddingBottom: 8 },
  clockLabel: { color: C.muted, fontSize: 12, fontWeight: '800' },
  clockText: { color: C.onDark, fontSize: 54, fontWeight: '900', letterSpacing: 1 },
  clockSub: { color: C.stone, fontSize: 12, fontWeight: '800' },
  actionRow: { flexDirection: 'row', gap: 8 },
  addBtnWrap: { flex: 1 },
  addBtn: { borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  addBtnText: { color: C.onPrimary, fontSize: 14, fontWeight: '900' },
  startAllBtn: { flex: 1, borderWidth: 1, borderColor: C.border, borderRadius: 12, paddingVertical: 12, alignItems: 'center', backgroundColor: C.card },
  startAllText: { color: C.onDark, fontSize: 14, fontWeight: '900' },
  sectionTitle: { color: C.stone, fontSize: 12, fontWeight: '900', marginTop: 4 },
  timerCard: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 14, gap: 12 },
  timerTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  taskMark: { width: 34, height: 34, borderRadius: 17, backgroundColor: C.scheduleCardBg, alignItems: 'center', justifyContent: 'center' },
  taskMarkText: { fontSize: 18 },
  timerTitleWrap: { flex: 1, gap: 2 },
  timerTitle: { color: C.onDark, fontSize: 15, fontWeight: '900' },
  timerState: { color: C.muted, fontSize: 11, fontWeight: '800' },
  removeBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: C.body, alignItems: 'center', justifyContent: 'center' },
  removeText: { color: C.muted, fontSize: 18, fontWeight: '900' },
  timerTime: { color: C.onDark, fontSize: 42, fontWeight: '900', textAlign: 'center', letterSpacing: 1 },
  timerControls: { flexDirection: 'row', gap: 8 },
  controlBtn: { flex: 1, borderRadius: 10, paddingVertical: 11, alignItems: 'center' },
  pauseBtn: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  saveBtn: { backgroundColor: C.danger },
  controlText: { color: C.onPrimary, fontSize: 13, fontWeight: '900' },
  pauseText: { color: C.onDark },
  saveText: { color: C.onPrimary },
  emptyBox: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 20, alignItems: 'center', gap: 6 },
  emptyTitle: { color: C.stone, fontSize: 15, fontWeight: '900' },
  emptyBody: { color: C.muted, fontSize: 12, fontWeight: '700', textAlign: 'center' },
  logCard: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 10, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 10 },
  logMain: { flex: 1, gap: 3 },
  logDate: { color: C.stone, fontSize: 11, fontWeight: '800' },
  logTitle: { color: C.onDark, fontSize: 14, fontWeight: '800' },
  logTime: { color: C.muted, fontSize: 11, fontWeight: '700' },
  logDuration: { color: C.onDark, fontSize: 15, fontWeight: '900' },
  deleteLogBtn: { backgroundColor: '#fee2e2', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
  deleteLogText: { color: '#dc2626', fontSize: 11, fontWeight: '900' },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  pickerSheet: { height: '92%', backgroundColor: C.card, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 18, paddingBottom: 0, gap: 12 },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: C.border, alignSelf: 'center' },
  pickerTitle: { color: C.onDark, fontSize: 16, fontWeight: '900' },
  pickerList: { flex: 1 },
  pickerItem: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 13, backgroundColor: C.body },
  pickerIcon: { width: 30, textAlign: 'center', fontSize: 18 },
  pickerText: { flex: 1, color: C.onDark, fontSize: 14, fontWeight: '800' },
  pickerAdd: { color: C.primary, fontSize: 12, fontWeight: '900' },
});

function formatDuration(totalSeconds: number, alwaysHours = false): string {
  const safeSeconds = Math.max(0, totalSeconds);
  const h = Math.floor(safeSeconds / 3600);
  const m = Math.floor((safeSeconds % 3600) / 60);
  const s = safeSeconds % 60;
  if (alwaysHours || h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatClock(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatDate(value: string): string {
  const [year, month, day] = value.slice(0, 10).split('-');
  return `${year}/${month}/${day}`;
}

function timerSeconds(item: TimerItem, now: number): number {
  if (!item.startedAtMs) return item.baseSeconds;
  return item.baseSeconds + Math.floor((now - item.startedAtMs) / 1000);
}

export default function TimerScreen({ navigation }: Props) {
  const db = useSQLiteContext();
  const insets = useSafeAreaInsets();
  const { C, grad } = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  const today = getToday();

  const [tasks, setTasks] = useState<Task[]>([]);
  const [timers, setTimers] = useState<TimerItem[]>([]);
  const [logs, setLogs] = useState<TimeLog[]>([]);
  const [totalSeconds, setTotalSeconds] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [now, setNow] = useState(Date.now());
  const savingRef = useRef<Set<number>>(new Set());

  const runningCount = timers.filter((item) => item.startedAtMs).length;
  const activeSeconds = timers.reduce((sum, item) => sum + timerSeconds(item, now), 0);

  const load = useCallback(async () => {
    const [loadedTasks, loadedLogs, loadedTotal] = await Promise.all([
      getTasks(db),
      getTimeLogsForDate(db, today),
      getTotalTimeForDate(db, today),
    ]);
    setTasks(loadedTasks);
    setLogs(loadedLogs);
    setTotalSeconds(loadedTotal);
    setTimers((current) => current.filter((item) => loadedTasks.some((task) => task.id === item.task.id)));
  }, [db, today]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);

  const availableTasks = tasks.filter((task) => !timers.some((item) => item.task.id === task.id));

  const addTimer = (task: Task) => {
    setTimers((current) => {
      if (current.some((item) => item.task.id === task.id)) return current;
      return [...current, { task, baseSeconds: 0, startedAtMs: null, startedAtIso: null }];
    });
    setPickerOpen(false);
  };

  const removeTimer = (taskId: number) => {
    const timer = timers.find((item) => item.task.id === taskId);
    if (timer?.startedAtMs) {
      Alert.alert('計測中です', '保存してから外してください。');
      return;
    }
    setTimers((current) => current.filter((item) => item.task.id !== taskId));
  };

  const startTimer = (taskId: number) => {
    const startedAtMs = Date.now();
    const startedAtIso = new Date(startedAtMs).toISOString();
    setTimers((current) => current.map((item) => (
      item.task.id === taskId && !item.startedAtMs ? { ...item, startedAtMs, startedAtIso } : item
    )));
  };

  const pauseTimer = (taskId: number) => {
    const stamp = Date.now();
    setTimers((current) => current.map((item) => (
      item.task.id === taskId && item.startedAtMs
        ? { ...item, baseSeconds: timerSeconds(item, stamp), startedAtMs: null, startedAtIso: null }
        : item
    )));
  };

  const startAll = () => {
    const stamp = Date.now();
    const iso = new Date(stamp).toISOString();
    setTimers((current) => current.map((item) => (
      item.startedAtMs ? item : { ...item, startedAtMs: stamp, startedAtIso: iso }
    )));
  };

  const saveTimer = async (taskId: number) => {
    const timer = timers.find((item) => item.task.id === taskId);
    if (!timer || savingRef.current.has(taskId)) return;
    const endedAtMs = Date.now();
    const duration = timerSeconds(timer, endedAtMs);
    if (duration <= 0) return;
    savingRef.current.add(taskId);
    const endedAt = new Date(endedAtMs).toISOString();
    const startedAt = timer.startedAtIso ?? new Date(endedAtMs - duration * 1000).toISOString();
    await addTimeLog(db, taskId, duration, startedAt, endedAt);
    await markComplete(db, taskId, today);
    setTimers((current) => current.map((item) => (
      item.task.id === taskId ? { ...item, baseSeconds: 0, startedAtMs: null, startedAtIso: null } : item
    )));
    await load();
    savingRef.current.delete(taskId);
  };

  const handleDeleteLog = (log: TimeLog) => {
    Alert.alert('履歴を削除', `${formatDate(log.date)} ${log.title} の ${formatDuration(log.duration_seconds, true)} を削除しますか？`, [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: '削除',
        style: 'destructive',
        onPress: async () => {
          await deleteTimeLog(db, log.id);
          const remaining = await countTimeLogsForTaskDate(db, log.task_id, log.date);
          if (remaining === 0) await markIncomplete(db, log.task_id, log.date);
          await load();
        },
      },
    ]);
  };

  const renderHistory = () => (
    <>
      <Text style={s.sectionTitle}>履歴</Text>
      {logs.length === 0 ? (
        <View style={s.emptyBox}>
          <Text style={s.emptyTitle}>まだ履歴がありません</Text>
          <Text style={s.emptyBody}>保存するとここに残ります</Text>
        </View>
      ) : logs.map((item) => (
        <View key={item.id} style={s.logCard}>
          <View style={s.logMain}>
            <Text style={s.logDate}>{formatDate(item.date)}</Text>
            <Text style={s.logTitle} numberOfLines={1}>{item.title}</Text>
            <Text style={s.logTime}>{formatClock(item.started_at)} - {formatClock(item.ended_at)}</Text>
          </View>
          <Text style={s.logDuration}>{formatDuration(item.duration_seconds, true)}</Text>
          <TouchableOpacity style={s.deleteLogBtn} onPress={() => handleDeleteLog(item)}>
            <Text style={s.deleteLogText}>削除</Text>
          </TouchableOpacity>
        </View>
      ))}
    </>
  );

  return (
    <View style={s.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor={C.body} />
      <ScrollView style={s.body} contentContainerStyle={[s.content, { paddingTop: insets.top + 16 }]}>
        <View style={s.clockPanel}>
          <Text style={s.clockLabel}>計測中</Text>
          <Text style={s.clockText}>{formatDuration(activeSeconds, true)}</Text>
          <Text style={s.clockSub}>今日の保存済み {formatDuration(totalSeconds, true)} ・ 動作中 {runningCount}件</Text>
        </View>

        <View style={s.actionRow}>
          <TouchableOpacity style={s.addBtnWrap} onPress={() => setPickerOpen(true)} activeOpacity={0.86}>
            <LinearGradient colors={grad.brand} start={GRAD_START} end={GRAD_END} style={s.addBtn}>
              <Text style={s.addBtnText}>＋ 測るものを追加</Text>
            </LinearGradient>
          </TouchableOpacity>
          <TouchableOpacity style={s.startAllBtn} onPress={startAll} disabled={timers.length === 0} activeOpacity={0.86}>
            <Text style={s.startAllText}>同時に開始</Text>
          </TouchableOpacity>
        </View>

        <Text style={s.sectionTitle}>計測するもの</Text>
        {timers.length === 0 ? (
          <View style={s.emptyBox}>
            <Text style={s.emptyTitle}>まだ何もありません</Text>
            <Text style={s.emptyBody}>追加ボタンから、測りたいタスクを入れてください</Text>
          </View>
        ) : timers.map((item) => {
          const seconds = timerSeconds(item, now);
          const running = !!item.startedAtMs;
          return (
            <View key={item.task.id} style={s.timerCard}>
              <View style={s.timerTop}>
                <View style={s.taskMark}>
                  <Text style={s.taskMarkText}>{item.task.icon ?? '⏱'}</Text>
                </View>
                <View style={s.timerTitleWrap}>
                  <Text style={s.timerTitle} numberOfLines={1}>{item.task.title}</Text>
                  <Text style={s.timerState}>{running ? '計測中' : seconds > 0 ? '一時停止中' : '待機中'}</Text>
                </View>
                <TouchableOpacity style={s.removeBtn} onPress={() => removeTimer(item.task.id)}>
                  <Text style={s.removeText}>×</Text>
                </TouchableOpacity>
              </View>
              <Text style={s.timerTime}>{formatDuration(seconds, true)}</Text>
              <View style={s.timerControls}>
                <TouchableOpacity onPress={() => running ? pauseTimer(item.task.id) : startTimer(item.task.id)} activeOpacity={0.86} style={{ flex: 1 }}>
                  <LinearGradient colors={running ? GRAD.brand : GRAD.success} start={GRAD_START} end={GRAD_END} style={s.controlBtn}>
                    <Text style={s.controlText}>{running ? '一時停止' : seconds > 0 ? '再開' : '開始'}</Text>
                  </LinearGradient>
                </TouchableOpacity>
                <TouchableOpacity style={[s.controlBtn, s.pauseBtn]} onPress={() => pauseTimer(item.task.id)} disabled={!running}>
                  <Text style={[s.controlText, s.pauseText]}>ずらす</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.controlBtn, s.saveBtn]} onPress={() => saveTimer(item.task.id)} disabled={seconds <= 0}>
                  <Text style={[s.controlText, s.saveText]}>保存</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })}

        {renderHistory()}
      </ScrollView>

      <Modal visible={pickerOpen} transparent animationType="slide" onRequestClose={() => setPickerOpen(false)}>
        <TouchableOpacity style={s.modalBg} activeOpacity={1} onPress={() => setPickerOpen(false)}>
          <TouchableOpacity activeOpacity={1} onPress={() => {}}>
            <View style={s.pickerSheet}>
              <View style={s.sheetHandle} />
              <Text style={s.pickerTitle}>測るタスクを追加</Text>
              <ScrollView style={s.pickerList} showsVerticalScrollIndicator contentContainerStyle={{ gap: 8, paddingBottom: insets.bottom + 56 }}>
                {availableTasks.length === 0 ? (
                  <View style={s.emptyBox}>
                    <Text style={s.emptyTitle}>追加できるタスクがありません</Text>
                    <Text style={s.emptyBody}>タスク画面で追加するか、計測中カードを外してください</Text>
                  </View>
                ) : availableTasks.map((task) => (
                  <TouchableOpacity key={task.id} style={s.pickerItem} onPress={() => addTimer(task)}>
                    <Text style={s.pickerIcon}>{task.icon ?? '⏱'}</Text>
                    <Text style={s.pickerText} numberOfLines={2}>{task.title}</Text>
                    <Text style={s.pickerAdd}>追加</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <TabBar current="Timer" navigation={navigation} />
    </View>
  );
}
