import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, StatusBar, Alert, ScrollView, TextInput } from 'react-native';
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
  getTimerSettingForTask,
  getToday,
  getTotalTimeForDate,
  markComplete,
  markIncomplete,
  saveTimerSettingForTask,
} from '../db/database';
import { GRAD, GRAD_START, GRAD_END } from '../constants/theme';
import TabBar from '../components/TabBar';

const C = {
  header: '#2563eb',
  body: '#ffffff',
  card: '#ffffff',
  border: '#dbeafe',
  primary: '#2563eb',
  onPrimary: '#ffffff',
  onDark: '#2d3748',
  muted: '#111827',
  stone: '#111827',
  success: '#16a34a',
  danger: '#dc2626',
  warning: '#f59e0b',
};

type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'Timer'> };
type TimerMode = 'stopwatch' | 'countdown';

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

function secondsToMinutesText(seconds: number): string {
  return String(Math.max(1, Math.round(seconds / 60)));
}

export default function TimerScreen({ navigation }: Props) {
  const db = useSQLiteContext();
  const insets = useSafeAreaInsets();
  const today = getToday();
  const startedAtRef = useRef<string | null>(null);
  const finishingRef = useRef(false);

  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [mode, setMode] = useState<TimerMode>('stopwatch');
  const [targetSeconds, setTargetSeconds] = useState(25 * 60);
  const [customMinutes, setCustomMinutes] = useState('25');
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [logs, setLogs] = useState<TimeLog[]>([]);
  const [totalSeconds, setTotalSeconds] = useState(0);

  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId) ?? null,
    [tasks, selectedTaskId]
  );
  const displaySeconds = mode === 'countdown' ? Math.max(targetSeconds - elapsed, 0) : elapsed;

  const load = useCallback(async () => {
    const loadedTasks = await getTasks(db);
    const loadedLogs = await getTimeLogsForDate(db, today);
    const loadedTotal = await getTotalTimeForDate(db, today);
    setTasks(loadedTasks);
    setLogs(loadedLogs);
    setTotalSeconds(loadedTotal);
    setSelectedTaskId((current) => loadedTasks.some((task) => task.id === current) ? current : null);
  }, [db, today]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const applyTargetSeconds = (seconds: number) => {
    const next = Math.max(60, Math.min(12 * 3600, Math.round(seconds)));
    setTargetSeconds(next);
    setCustomMinutes(secondsToMinutesText(next));
    setElapsed(0);
  };

  const loadTaskTimerSetting = useCallback(async (taskId: number) => {
    const setting = await getTimerSettingForTask(db, taskId);
    applyTargetSeconds(setting?.target_seconds ?? 25 * 60);
  }, [db]);

  const saveAndStop = useCallback(async (durationSeconds: number, completedCountdown = false) => {
    if (!selectedTask || !startedAtRef.current || finishingRef.current) return;
    finishingRef.current = true;
    const endedAt = new Date().toISOString();
    await addTimeLog(db, selectedTask.id, Math.max(1, durationSeconds), startedAtRef.current, endedAt);
    await markComplete(db, selectedTask.id, today);
    startedAtRef.current = null;
    setRunning(false);
    setPaused(false);
    setElapsed(0);
    await load();
    finishingRef.current = false;
    if (completedCountdown) Alert.alert('時間になりました', '作業時間を保存して、タスクを完了にしました。');
  }, [db, load, selectedTask, today]);

  useEffect(() => {
    if (!running || paused) return;
    const id = setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => clearInterval(id);
  }, [paused, running]);

  useEffect(() => {
    if (!running || paused || mode !== 'countdown' || elapsed < targetSeconds) return;
    saveAndStop(targetSeconds, true);
  }, [elapsed, mode, paused, running, saveAndStop, targetSeconds]);

  const chooseTask = async (taskId: number) => {
    if (running) return;
    setSelectedTaskId(taskId);
    setElapsed(0);
    setPaused(false);
    startedAtRef.current = null;
    await loadTaskTimerSetting(taskId);
  };

  const backToTaskList = () => {
    if (running) {
      Alert.alert('計測中です', '停止して保存してからタスク一覧に戻ってください。');
      return;
    }
    setSelectedTaskId(null);
    setElapsed(0);
    setPaused(false);
    startedAtRef.current = null;
  };

  const start = () => {
    if (!selectedTask) return;
    if (running && paused) {
      setPaused(false);
      return;
    }
    startedAtRef.current = new Date().toISOString();
    finishingRef.current = false;
    setElapsed(0);
    setPaused(false);
    setRunning(true);
  };

  const pause = () => {
    if (!running) return;
    setPaused(true);
  };

  const stop = async () => {
    const duration = mode === 'countdown' ? Math.min(elapsed, targetSeconds) : elapsed;
    await saveAndStop(duration);
  };

  const reset = () => {
    if (running) return;
    setElapsed(0);
    setPaused(false);
    startedAtRef.current = null;
  };

  const setPresetMinutes = (minutes: number) => {
    if (running) return;
    applyTargetSeconds(minutes * 60);
  };

  const adjustTarget = (minutes: number) => {
    if (running) return;
    applyTargetSeconds(targetSeconds + minutes * 60);
  };

  const applyCustomMinutes = () => {
    if (running) return;
    const minutes = Number(customMinutes);
    if (!Number.isFinite(minutes) || minutes <= 0) {
      Alert.alert('時間を確認してください', '1分以上の数字を入力してください。');
      setCustomMinutes(secondsToMinutesText(targetSeconds));
      return;
    }
    applyTargetSeconds(minutes * 60);
  };

  const saveCurrentTargetForTask = async () => {
    if (!selectedTask) return;
    await saveTimerSettingForTask(db, selectedTask.id, targetSeconds);
    Alert.alert('保存しました', `${selectedTask.title} のタイマーを ${secondsToMinutesText(targetSeconds)}分 にしました。`);
  };

  const handleDeleteLog = (log: TimeLog) => {
    Alert.alert('履歴を削除', `${formatDate(log.date)} ${log.title} の ${formatDuration(log.duration_seconds, true)} を削除しますか？`, [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: '削除',
        style: 'destructive',
        onPress: async () => {
          await deleteTimeLog(db, log.id);
          // If no time logs remain for this task on that day, revert its completion.
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
        <View style={s.empty}>
          <Text style={s.emptyTitle}>まだ履歴がありません</Text>
          <Text style={s.emptyBody}>計測が終わるとここに残ります</Text>
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

  const renderTaskList = () => (
    <ScrollView style={s.body} contentContainerStyle={s.content}>
      <Text style={s.sectionTitle}>タスクを選んでください</Text>
      <View style={s.taskList}>
        {tasks.length === 0 ? (
          <View style={s.emptyTaskBox}>
            <Text style={s.emptyTitle}>タスクがありません</Text>
            <Text style={s.emptyBody}>タスク画面で先に追加してください</Text>
          </View>
        ) : tasks.map((task) => (
          <TouchableOpacity key={task.id} style={s.taskSelectCard} onPress={() => chooseTask(task.id)}>
            <View style={s.radio} />
            <Text style={s.taskSelectTitle} numberOfLines={2}>{task.icon ? `${task.icon} ` : ''}{task.title}</Text>
            <Text style={s.openText}>計る</Text>
          </TouchableOpacity>
        ))}
      </View>
      {renderHistory()}
    </ScrollView>
  );

  const renderTimer = () => {
    if (!selectedTask) return null;
    return (
      <ScrollView style={s.body} contentContainerStyle={s.content}>
        <TouchableOpacity style={s.backBtn} onPress={backToTaskList}>
          <Text style={s.backBtnText}>← タスク一覧へ</Text>
        </TouchableOpacity>

        <View style={s.timerCard}>
          <Text style={s.selectedLabel}>{selectedTask.title}</Text>
          <View style={s.modeRow}>
            <TouchableOpacity
              style={[s.modeChip, mode === 'stopwatch' && s.modeChipActive, running && s.modeChipDisabled]}
              onPress={() => { if (!running) { setMode('stopwatch'); reset(); } }}
              disabled={running}
            >
              <Text style={[s.modeChipText, mode === 'stopwatch' && s.modeChipTextActive]}>ストップウォッチ</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.modeChip, mode === 'countdown' && s.modeChipActive, running && s.modeChipDisabled]}
              onPress={() => { if (!running) { setMode('countdown'); reset(); } }}
              disabled={running}
            >
              <Text style={[s.modeChipText, mode === 'countdown' && s.modeChipTextActive]}>タイマー</Text>
            </TouchableOpacity>
          </View>

          <Text style={s.timerText}>{formatDuration(displaySeconds, true)}</Text>
          <Text style={s.timerHint}>
            {running
              ? paused
                ? '一時停止中'
                : mode === 'countdown'
                  ? 'カウントダウン中'
                  : '計測中'
              : mode === 'countdown'
                ? '時間を決めて開始'
                : '何秒でも計測できます'}
          </Text>

          <View style={s.controls}>
            {/* Play / Pause toggle */}
            <View style={s.controlItem}>
              <TouchableOpacity
                onPress={() => { if (!running || paused) start(); else pause(); }}
                activeOpacity={0.85}
              >
                <LinearGradient colors={GRAD.success} start={GRAD_START} end={GRAD_END} style={[s.iconCircle, s.playCircle]}>
                  <Text style={s.iconGlyph}>{running && !paused ? '⏸' : '▶'}</Text>
                </LinearGradient>
              </TouchableOpacity>
              <Text style={s.controlCaption}>
                {!running ? '開始' : paused ? '再開' : '一時停止'}
              </Text>
            </View>

            {/* Stop (square) — saves and finishes */}
            <View style={s.controlItem}>
              <TouchableOpacity onPress={stop} disabled={!running} activeOpacity={0.85}>
                <LinearGradient
                  colors={GRAD.danger}
                  start={GRAD_START} end={GRAD_END}
                  style={[s.iconCircle, s.stopCircle, !running && s.iconCircleDisabled]}
                >
                  <View style={s.square} />
                </LinearGradient>
              </TouchableOpacity>
              <Text style={[s.controlCaption, !running && s.controlCaptionDisabled]}>保存</Text>
            </View>

            {/* Reset — only when idle */}
            {!running && (
              <View style={s.controlItem}>
                <TouchableOpacity style={[s.iconCircle, s.resetCircle]} onPress={reset} activeOpacity={0.85}>
                  <Text style={s.resetGlyph}>↺</Text>
                </TouchableOpacity>
                <Text style={s.controlCaption}>リセット</Text>
              </View>
            )}
          </View>
        </View>

        {mode === 'countdown' && (
          <>
            <Text style={s.sectionTitle}>タイマー時間</Text>
            <View style={s.targetBox}>
              <View style={s.targetAdjustRow}>
                <TouchableOpacity style={s.targetAdjustBtn} onPress={() => adjustTarget(-5)} disabled={running}>
                  <Text style={s.targetAdjustText}>-5分</Text>
                </TouchableOpacity>
                <Text style={s.targetText}>{formatDuration(targetSeconds, true)}</Text>
                <TouchableOpacity style={s.targetAdjustBtn} onPress={() => adjustTarget(5)} disabled={running}>
                  <Text style={s.targetAdjustText}>+5分</Text>
                </TouchableOpacity>
              </View>
              <View style={s.customRow}>
                <TextInput
                  style={s.customInput}
                  value={customMinutes}
                  onChangeText={setCustomMinutes}
                  keyboardType="numeric"
                  editable={!running}
                  onEndEditing={applyCustomMinutes}
                />
                <Text style={s.customUnit}>分</Text>
                <TouchableOpacity style={[s.smallBtn, running && s.modeChipDisabled]} onPress={applyCustomMinutes} disabled={running}>
                  <Text style={s.smallBtnText}>反映</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.smallBtn, running && s.modeChipDisabled]} onPress={saveCurrentTargetForTask} disabled={running}>
                  <Text style={s.smallBtnText}>保存</Text>
                </TouchableOpacity>
              </View>
              <View style={s.presetRow}>
                {[5, 10, 15, 25, 30, 60].map((minutes) => (
                  <TouchableOpacity
                    key={minutes}
                    style={[s.presetChip, targetSeconds === minutes * 60 && s.presetChipActive, running && s.modeChipDisabled]}
                    onPress={() => setPresetMinutes(minutes)}
                    disabled={running}
                  >
                    <Text style={[s.presetText, targetSeconds === minutes * 60 && s.presetTextActive]}>{minutes}分</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </>
        )}

        {renderHistory()}
      </ScrollView>
    );
  };

  return (
    <View style={s.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
      <LinearGradient colors={GRAD.header} start={GRAD_START} end={GRAD_END} style={[s.headerCard, { paddingTop: insets.top + 12 }]}>
        <Text style={s.headerTitle}>タイマー</Text>
        <Text style={s.headerSub}>今日の作業時間 {formatDuration(totalSeconds, true)}</Text>
      </LinearGradient>
      {selectedTask ? renderTimer() : renderTaskList()}
      <TabBar current="Timer" navigation={navigation} />
    </View>
  );
}

const s = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: C.body },
  headerCard: { backgroundColor: C.header, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 16, gap: 4 },
  headerTitle: { color: C.onPrimary, fontSize: 20, fontWeight: '700' },
  headerSub: { color: 'rgba(255,255,255,0.8)', fontSize: 12, fontWeight: '700' },
  body: { flex: 1, backgroundColor: C.body },
  content: { padding: 16, paddingBottom: 88, gap: 10 },
  sectionTitle: { color: C.stone, fontSize: 12, fontWeight: '800', marginTop: 4 },
  backBtn: { alignSelf: 'flex-start', borderWidth: 1, borderColor: C.border, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 7 },
  backBtnText: { color: C.stone, fontSize: 12, fontWeight: '800' },
  taskList: { gap: 8 },
  taskSelectCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    padding: 14,
  },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: C.border },
  taskSelectTitle: { flex: 1, color: C.onDark, fontSize: 14, fontWeight: '700' },
  openText: { color: C.onDark, fontSize: 12, fontWeight: '800' },
  timerCard: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 14, gap: 10 },
  selectedLabel: { color: C.onDark, fontSize: 15, fontWeight: '800' },
  modeRow: { flexDirection: 'row', gap: 8 },
  modeChip: { flex: 1, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingVertical: 9, alignItems: 'center' },
  modeChipActive: { backgroundColor: C.primary, borderColor: C.primary },
  modeChipDisabled: { opacity: 0.45 },
  modeChipText: { color: C.stone, fontSize: 12, fontWeight: '800' },
  modeChipTextActive: { color: C.onPrimary },
  timerText: { color: C.onDark, fontSize: 56, fontWeight: '800', textAlign: 'center' },
  timerHint: { color: C.muted, fontSize: 12, fontWeight: '700', textAlign: 'center' },
  controls: { flexDirection: 'row', justifyContent: 'center', alignItems: 'flex-start', gap: 28, paddingVertical: 4 },
  controlItem: { alignItems: 'center', gap: 6 },
  iconCircle: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', elevation: 3, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.18, shadowRadius: 4 },
  iconCircleDisabled: { opacity: 0.4, elevation: 0 },
  playCircle: { backgroundColor: C.success },
  stopCircle: { backgroundColor: C.danger },
  resetCircle: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  iconGlyph: { color: C.onPrimary, fontSize: 26, fontWeight: '900', marginLeft: 2 },
  square: { width: 22, height: 22, borderRadius: 4, backgroundColor: C.onPrimary },
  resetGlyph: { color: C.stone, fontSize: 26, fontWeight: '900' },
  controlCaption: { color: C.stone, fontSize: 12, fontWeight: '800' },
  controlCaptionDisabled: { color: C.muted },
  targetBox: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 14, gap: 8 },
  targetAdjustRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  targetAdjustBtn: { borderWidth: 1, borderColor: C.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  targetAdjustText: { color: C.onDark, fontSize: 12, fontWeight: '800' },
  targetText: { flex: 1, color: C.onDark, fontSize: 22, fontWeight: '800', textAlign: 'center' },
  customRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  customInput: { width: 72, borderWidth: 1, borderColor: C.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, color: C.onDark, fontSize: 16, fontWeight: '800', textAlign: 'center' },
  customUnit: { color: C.stone, fontSize: 13, fontWeight: '800' },
  smallBtn: { backgroundColor: C.primary, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9 },
  smallBtnText: { color: C.onPrimary, fontSize: 12, fontWeight: '800' },
  presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  presetChip: { borderWidth: 1, borderColor: C.border, borderRadius: 16, paddingHorizontal: 10, paddingVertical: 6 },
  presetChipActive: { backgroundColor: C.primary, borderColor: C.primary },
  presetText: { color: C.stone, fontSize: 11, fontWeight: '800' },
  presetTextActive: { color: C.onPrimary },
  logCard: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 10, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 10 },
  logMain: { flex: 1, gap: 3 },
  logDate: { color: C.stone, fontSize: 11, fontWeight: '800' },
  logTitle: { color: C.onDark, fontSize: 14, fontWeight: '700' },
  logTime: { color: C.muted, fontSize: 11, fontWeight: '700' },
  logDuration: { color: C.onDark, fontSize: 15, fontWeight: '800' },
  deleteLogBtn: { backgroundColor: '#fee2e2', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
  deleteLogText: { color: C.danger, fontSize: 11, fontWeight: '800' },
  emptyTaskBox: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 18, alignItems: 'center', gap: 6 },
  empty: { paddingVertical: 28, alignItems: 'center', gap: 6 },
  emptyTitle: { color: C.stone, fontSize: 15, fontWeight: '800' },
  emptyBody: { color: C.muted, fontSize: 12, fontWeight: '600' },
});
