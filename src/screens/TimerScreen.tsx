import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, StatusBar, Alert, ScrollView, Modal, Dimensions, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSQLiteContext } from 'expo-sqlite';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { LinearGradient } from 'expo-linear-gradient';
import { RootStackParamList } from '../../App';
import { Task, getTasks } from '../db/database';
import { GRAD, GRAD_START, GRAD_END } from '../constants/theme';
import TabBar from '../components/TabBar';
import { useTheme, ColorSet } from '../contexts/ThemeContext';
import { useTimerActions, useTimerState, useTimerClock, timerSeconds, displayTimerSeconds } from '../contexts/TimerContext';

type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'Timer'> };

const makeStyles = (C: ColorSet) => StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: C.body },
  body: { flex: 1, backgroundColor: C.body },
  content: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 92, gap: 12 },
  modeRow: { flexDirection: 'row', gap: 8 },
  modeBtn: { flex: 1, borderWidth: 1, borderColor: C.border, borderRadius: 12, paddingVertical: 10, alignItems: 'center', backgroundColor: C.card },
  modeBtnActive: { backgroundColor: C.primary, borderColor: C.primary },
  modeText: { color: C.onDark, fontSize: 13, fontWeight: '900' },
  modeTextActive: { color: C.onPrimary },
  modeSub: { color: C.muted, fontSize: 11, fontWeight: '800', textAlign: 'center' },
  minuteRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  minuteLabel: { color: C.muted, fontSize: 12, fontWeight: '700' },
  minuteInput: { color: C.primary, fontSize: 14, fontWeight: '900', minWidth: 24, textAlign: 'center', padding: 0 },
  addBtnWrap: { flex: 1 },
  addBtn: { borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  addBtnText: { color: C.onPrimary, fontSize: 14, fontWeight: '900' },
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
  controlBtnDisabled: { opacity: 0.45 },
  pauseBtn: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  saveBtn: { backgroundColor: C.danger },
  controlText: { color: C.onPrimary, fontSize: 13, fontWeight: '900' },
  pauseText: { color: C.onDark },
  saveText: { color: C.onPrimary },
  emptyBox: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 20, alignItems: 'center', gap: 6 },
  emptyTitle: { color: C.stone, fontSize: 15, fontWeight: '900' },
  emptyBody: { color: C.muted, fontSize: 12, fontWeight: '700', textAlign: 'center' },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  modalBackdrop: { ...StyleSheet.absoluteFillObject },
  pickerSheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: C.card, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 18, gap: 12 },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: C.border, alignSelf: 'center' },
  pickerTitle: { color: C.onDark, fontSize: 16, fontWeight: '900' },
  pickerList: { flex: 1 },
  pickerItem: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 13, backgroundColor: C.body },
  pickerIcon: { width: 30, textAlign: 'center', fontSize: 18 },
  pickerText: { flex: 1, color: C.onDark, fontSize: 14, fontWeight: '800' },
  pickerAdd: { color: C.primary, fontSize: 12, fontWeight: '900' },
  pickerControlRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  pickerControlLabel: { color: C.muted, fontSize: 11, fontWeight: '800', marginRight: 2 },
  pickerChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.body },
  pickerChipActive: { borderColor: C.primary, backgroundColor: C.primarySoft },
  pickerChipText: { color: C.muted, fontSize: 12, fontWeight: '700' },
  pickerChipTextActive: { color: C.primary },
  pickerIconFilterScroll: { marginTop: 2 },
  pickerIconFilterContent: { paddingRight: 8 },
  pickerIconChip: { width: 40, height: 40, borderRadius: 12, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.body, alignItems: 'center', justifyContent: 'center', marginRight: 8 },
  pickerIconChipActive: { borderColor: C.primary, backgroundColor: C.primarySoft },
  pickerIconChipText: { fontSize: 18 },
});

function formatDuration(totalSeconds: number, alwaysHours = false): string {
  const safeSeconds = Math.max(0, totalSeconds);
  const h = Math.floor(safeSeconds / 3600);
  const m = Math.floor((safeSeconds % 3600) / 60);
  const s = safeSeconds % 60;
  if (alwaysHours || h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function TimerScreen({ navigation }: Props) {
  const db = useSQLiteContext();
  const insets = useSafeAreaInsets();
  const { C, grad } = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  const sheetHeight = Math.max(360, Math.round(Dimensions.get('window').height * 0.82));

  const [tasks, setTasks] = useState<Task[]>([]);
  const { timers, mode } = useTimerState();
  const { addTimer: addTimerAction, removeTimer, startTimer, pauseTimer, saveTimer, updateTargetSeconds, setMode } = useTimerActions();
  const now = useTimerClock();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSortKey, setPickerSortKey] = useState<'manual' | 'priority' | 'name'>('manual');
  const [pickerIconFilterOpen, setPickerIconFilterOpen] = useState(false);
  const [pickerIconFilter, setPickerIconFilter] = useState<string | null>(null);
  const closePicker = () => {
    setPickerOpen(false);
    setPickerSortKey('manual');
    setPickerIconFilterOpen(false);
    setPickerIconFilter(null);
  };
  const [minuteInputs, setMinuteInputs] = useState<Record<number, string>>({});

  const runningCount = timers.filter((item) => item.startedAtMs).length;

  const load = useCallback(async () => {
    const loadedTasks = await getTasks(db);
    setTasks(loadedTasks);
  }, [db]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const availableTasks = tasks.filter((task) => !timers.some((item) => item.task.id === task.id));
  const iconGroups = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of availableTasks) {
      if (!t.icon) continue;
      map.set(t.icon, (map.get(t.icon) ?? 0) + 1);
    }
    return map;
  }, [availableTasks]);
  const visibleTasks = useMemo(() => {
    let list = pickerIconFilter ? availableTasks.filter((t) => t.icon === pickerIconFilter) : availableTasks;
    if (pickerSortKey === 'priority') {
      list = [...list].sort((a, b) => (b.priority - a.priority) || (a.sort_order - b.sort_order));
    } else if (pickerSortKey === 'name') {
      list = [...list].sort((a, b) => a.title.localeCompare(b.title, 'ja'));
    }
    return list;
  }, [availableTasks, pickerIconFilter, pickerSortKey]);

  const addTimer = async (task: Task) => {
    const target = await addTimerAction(task);
    setMinuteInputs((prev) => ({ ...prev, [task.id]: String(Math.round(target / 60)) }));
    setPickerOpen(false);
  };

  const handleRemoveTimer = (taskId: number) => {
    const timer = timers.find((item) => item.task.id === taskId);
    if (timer?.startedAtMs) {
      Alert.alert('計測中です', '保存してから外してください。');
      return;
    }
    removeTimer(taskId);
  };

  return (
    <View style={s.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor={C.body} />
      <ScrollView style={s.body} contentContainerStyle={[s.content, { paddingTop: insets.top + 16 }]}>
        <View style={s.modeRow}>
          <TouchableOpacity
            style={[s.modeBtn, mode === 'stopwatch' && s.modeBtnActive]}
            onPress={() => setMode('stopwatch')}
            activeOpacity={0.85}
          >
            <Text style={[s.modeText, mode === 'stopwatch' && s.modeTextActive]}>ストップウォッチ</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.modeBtn, mode === 'timer' && s.modeBtnActive]}
            onPress={() => setMode('timer')}
            activeOpacity={0.85}
          >
            <Text style={[s.modeText, mode === 'timer' && s.modeTextActive]}>タイマー</Text>
          </TouchableOpacity>
        </View>
        <Text style={s.modeSub}>動作中 {runningCount}件</Text>

        <TouchableOpacity style={s.addBtnWrap} onPress={() => setPickerOpen(true)} activeOpacity={0.86}>
          <LinearGradient colors={grad.brand} start={GRAD_START} end={GRAD_END} style={s.addBtn}>
            <Text style={s.addBtnText}>＋ 測るものを追加</Text>
          </LinearGradient>
        </TouchableOpacity>

        <Text style={s.sectionTitle}>計測するもの</Text>
        {timers.length === 0 ? (
          <View style={s.emptyBox}>
            <Text style={s.emptyTitle}>まだ何もありません</Text>
            <Text style={s.emptyBody}>追加ボタンから、測りたいタスクを入れてください</Text>
          </View>
        ) : timers.map((item) => {
          const seconds = timerSeconds(item, now);
          const shownSeconds = displayTimerSeconds(item, now, mode, item.targetSeconds);
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
                <TouchableOpacity style={s.removeBtn} onPress={() => handleRemoveTimer(item.task.id)}>
                  <Text style={s.removeText}>×</Text>
                </TouchableOpacity>
              </View>
              {mode === 'timer' && (
                <View style={s.minuteRow}>
                  <TextInput
                    style={s.minuteInput}
                    value={minuteInputs[item.task.id] ?? String(Math.round(item.targetSeconds / 60))}
                    onChangeText={(v) => setMinuteInputs((prev) => ({ ...prev, [item.task.id]: v.replace(/[^0-9]/g, '') }))}
                    onBlur={async () => {
                      const mins = parseInt(minuteInputs[item.task.id] ?? '25', 10);
                      const secs = Math.max(1, isNaN(mins) ? 25 : mins) * 60;
                      setMinuteInputs((prev) => ({ ...prev, [item.task.id]: String(Math.round(secs / 60)) }));
                      await updateTargetSeconds(item.task.id, secs);
                    }}
                    keyboardType="number-pad"
                    returnKeyType="done"
                    editable={!running}
                  />
                  <Text style={s.minuteLabel}>分</Text>
                </View>
              )}
              <Text style={s.timerTime}>{formatDuration(shownSeconds, true)}</Text>
              <View style={s.timerControls}>
                <TouchableOpacity onPress={() => startTimer(item.task.id)} disabled={running} activeOpacity={0.86} style={{ flex: 1 }}>
                  <LinearGradient colors={GRAD.success} start={GRAD_START} end={GRAD_END} style={[s.controlBtn, running && s.controlBtnDisabled]}>
                    <Text style={s.controlText}>開始</Text>
                  </LinearGradient>
                </TouchableOpacity>
                <TouchableOpacity style={[s.controlBtn, s.pauseBtn]} onPress={() => pauseTimer(item.task.id)} disabled={!running}>
                  <Text style={[s.controlText, s.pauseText]}>一時停止</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.controlBtn, s.saveBtn]} onPress={() => saveTimer(item.task.id)} disabled={seconds <= 0}>
                  <Text style={[s.controlText, s.saveText]}>完全停止</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })}
      </ScrollView>

      <Modal visible={pickerOpen} transparent animationType="slide" onRequestClose={closePicker} statusBarTranslucent>
        <View style={s.modalBg}>
          <TouchableOpacity style={s.modalBackdrop} activeOpacity={1} onPress={closePicker} />
          <View style={[s.pickerSheet, { height: sheetHeight, paddingBottom: insets.bottom + 18 }]}>
            <View style={s.sheetHandle} />
            <Text style={s.pickerTitle}>測るタスクを追加</Text>
            {availableTasks.length > 0 && (
              <>
                <View style={s.pickerControlRow}>
                  <Text style={s.pickerControlLabel}>並び替え</Text>
                  {([
                    { k: 'manual' as const, l: '手動' },
                    { k: 'priority' as const, l: '優先度' },
                    { k: 'name' as const, l: '名前' },
                  ]).map((o) => (
                    <TouchableOpacity
                      key={o.k}
                      style={[s.pickerChip, pickerSortKey === o.k && s.pickerChipActive]}
                      onPress={() => setPickerSortKey(o.k)}
                    >
                      <Text style={[s.pickerChipText, pickerSortKey === o.k && s.pickerChipTextActive]}>{o.l}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <View style={s.pickerControlRow}>
                  <Text style={s.pickerControlLabel}>絞り込み</Text>
                  <TouchableOpacity
                    style={[s.pickerChip, !pickerIconFilterOpen && !pickerIconFilter && s.pickerChipActive]}
                    onPress={() => { setPickerIconFilter(null); setPickerIconFilterOpen(false); }}
                  >
                    <Text style={[s.pickerChipText, !pickerIconFilterOpen && !pickerIconFilter && s.pickerChipTextActive]}>すべて</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[s.pickerChip, (pickerIconFilterOpen || pickerIconFilter) && s.pickerChipActive]}
                    onPress={() => setPickerIconFilterOpen((p) => !p)}
                  >
                    <Text style={[s.pickerChipText, (pickerIconFilterOpen || pickerIconFilter) && s.pickerChipTextActive]}>
                      アイコン{pickerIconFilter ? ` ${pickerIconFilter}` : ''} {pickerIconFilterOpen ? '▲' : '▼'}
                    </Text>
                  </TouchableOpacity>
                </View>
                {pickerIconFilterOpen && (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.pickerIconFilterScroll} contentContainerStyle={s.pickerIconFilterContent}>
                    {[...iconGroups.keys()].map((icon) => (
                      <TouchableOpacity
                        key={icon}
                        style={[s.pickerIconChip, pickerIconFilter === icon && s.pickerIconChipActive]}
                        onPress={() => setPickerIconFilter((prev) => prev === icon ? null : icon)}
                      >
                        <Text style={s.pickerIconChipText}>{icon}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                )}
              </>
            )}
            <ScrollView style={s.pickerList} showsVerticalScrollIndicator contentContainerStyle={{ gap: 8, paddingBottom: 24 }}>
              {availableTasks.length === 0 ? (
                <View style={s.emptyBox}>
                  <Text style={s.emptyTitle}>追加できるタスクがありません</Text>
                  <Text style={s.emptyBody}>タスク画面で追加するか、計測中カードを外してください</Text>
                </View>
              ) : visibleTasks.length === 0 ? (
                <View style={s.emptyBox}>
                  <Text style={s.emptyTitle}>該当するタスクがありません</Text>
                </View>
              ) : visibleTasks.map((task) => (
                <TouchableOpacity key={task.id} style={s.pickerItem} onPress={() => addTimer(task)}>
                  <Text style={s.pickerIcon}>{task.icon ?? '⏱'}</Text>
                  <Text style={s.pickerText} numberOfLines={2}>{task.title}</Text>
                  <Text style={s.pickerAdd}>追加</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <TabBar current="Timer" navigation={navigation} />
    </View>
  );
}
