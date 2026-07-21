import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, StatusBar, Alert, ScrollView, Modal, Dimensions, TextInput, Animated, Easing } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSQLiteContext } from 'expo-sqlite';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { LinearGradient } from 'expo-linear-gradient';
import ReanimatedAnimated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { RootStackParamList } from '../../App';
import { Task, TimeLog, deleteTimeLog, getSetting, getTasks, getTimeLogsForTask } from '../db/database';
import { GRAD_START, GRAD_END } from '../constants/theme';
import TabBar from '../components/TabBar';
import { useTheme, ColorSet } from '../contexts/ThemeContext';
import { useTimerActions, useTimerState, useTimerClock, timerSeconds, displayTimerSeconds } from '../contexts/TimerContext';
import { useAds } from '../contexts/AdsContext';

type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'Timer'> };

function splitSeconds(totalSeconds: number): { minutes: string; seconds: string } {
  const safe = Math.max(0, Math.round(totalSeconds));
  return {
    minutes: String(Math.floor(safe / 60)),
    seconds: String(safe % 60).padStart(2, '0'),
  };
}

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
  minuteRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  minuteLabel: { color: C.muted, fontSize: 12, fontWeight: '700', textAlign: 'center' },
  minuteInput: { color: C.primary, fontSize: 42, fontWeight: '900', minWidth: 84, textAlign: 'center', padding: 0 },
  secondInput: { color: C.primary, fontSize: 42, fontWeight: '900', minWidth: 84, textAlign: 'center', padding: 0 },
  timeInputBlock: { alignItems: 'center', gap: 2 },
  sectionTitle: { color: C.stone, fontSize: 12, fontWeight: '900', marginTop: 4 },
  timerCard: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    padding: 14,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.09,
    shadowRadius: 10,
    elevation: 4,
  },
  timerTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  taskMark: { width: 34, height: 34, borderRadius: 17, backgroundColor: C.scheduleCardBg, alignItems: 'center', justifyContent: 'center' },
  taskMarkText: { fontSize: 18 },
  timerTitleWrap: { flex: 1, gap: 3 },
  timerTitle: { color: C.onDark, fontSize: 15, fontWeight: '900' },
  timerState: { color: C.muted, fontSize: 11, fontWeight: '800', minHeight: 16 },
  removeBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: C.body, alignItems: 'center', justifyContent: 'center' },
  removeText: { color: C.muted, fontSize: 18, fontWeight: '900' },
  cardActionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', gap: 14 },
  cardActionBtn: { paddingVertical: 2, alignItems: 'center', justifyContent: 'center' },
  cardActionPrimary: {},
  cardActionText: { color: C.muted, fontSize: 11, fontWeight: '700' },
  cardActionTextPrimary: { color: C.primary, fontSize: 11, fontWeight: '800' },
  expandWrap: { overflow: 'hidden' },
  expandInner: { gap: 12, paddingTop: 10 },
  timerTime: { color: C.onDark, fontSize: 42, fontWeight: '900', textAlign: 'center', letterSpacing: 1 },
  timeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  setTimeBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: C.border, backgroundColor: C.card },
  setTimeBtnText: { color: C.primary, fontSize: 12, fontWeight: '800' },
  timerControls: { flexDirection: 'row', gap: 7 },
  controlBtn: { flex: 1, borderRadius: 10, paddingVertical: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: '#ffffff', borderWidth: 1, borderColor: C.border, minHeight: 40 },
  controlBtnDisabled: { opacity: 0.45 },
  startText: { color: '#16a34a', fontSize: 21, fontWeight: '900' },
  pauseText: { color: '#f59e0b', fontSize: 19, fontWeight: '900', letterSpacing: 0 },
  saveText: { color: '#dc2626', fontSize: 17, fontWeight: '900' },
  emptyBox: { paddingVertical: 20, alignItems: 'center', gap: 6 },
  emptyTitle: { color: C.stone, fontSize: 15, fontWeight: '900' },
  emptyBody: { color: C.muted, fontSize: 12, fontWeight: '700', textAlign: 'center' },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  modalBackdrop: { ...StyleSheet.absoluteFillObject },
  pickerSheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: C.card,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 18,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.14,
    shadowRadius: 14,
    elevation: 16,
  },
  historySheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: C.card,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 18,
    gap: 12,
    maxHeight: '72%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.14,
    shadowRadius: 14,
    elevation: 16,
  },
  historyHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  historyTitle: { flex: 1, color: C.onDark, fontSize: 16, fontWeight: '900' },
  historySub: { color: C.muted, fontSize: 12, fontWeight: '700' },
  historyList: { gap: 8, paddingBottom: 12 },
  historyRow: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    padding: 12,
    gap: 6,
    backgroundColor: C.body,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  historyRowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  historyRowActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  historyDuration: { color: C.primary, fontSize: 14, fontWeight: '900' },
  historyMeta: { color: C.muted, fontSize: 12, fontWeight: '700' },
  historyDeleteBtn: { paddingVertical: 2, paddingHorizontal: 2 },
  historyDeleteText: { color: '#dc2626', fontSize: 12, fontWeight: '900' },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: C.border, alignSelf: 'center' },
  pickerTitle: { color: C.onDark, fontSize: 16, fontWeight: '900' },
  pickerList: { flex: 1 },
  pickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    padding: 13,
    backgroundColor: C.body,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
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
  fabWrap: { position: 'absolute', top: 0, left: 0, zIndex: 20 },
  fab: { width: 58, height: 58, borderRadius: 29, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center', elevation: 6, shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.25, shadowRadius: 6 },
  fabText: { color: C.onPrimary, fontSize: 29, fontWeight: '400', lineHeight: 33 },
});

function formatDuration(totalSeconds: number, alwaysHours = false): string {
  const safeSeconds = Math.max(0, totalSeconds);
  const h = Math.floor(safeSeconds / 3600);
  const m = Math.floor((safeSeconds % 3600) / 60);
  const s = safeSeconds % 60;
  if (alwaysHours || h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatLogStamp(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function TimerScreen({ navigation }: Props) {
  const db = useSQLiteContext();
  const insets = useSafeAreaInsets();
  const { C, grad } = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  const screen = Dimensions.get('window');
  const sheetHeight = Math.max(360, Math.round(Dimensions.get('window').height * 0.82));

  const [tasks, setTasks] = useState<Task[]>([]);
  const { timers } = useTimerState();
  const { addTimer: addTimerAction, removeTimer, startTimer, pauseTimer, saveTimer, updateTargetSeconds, setMode, grantTimerBonus } = useTimerActions();
  const { showRewardedAd } = useAds();
  const now = useTimerClock();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSortKey, setPickerSortKey] = useState<'manual' | 'priority' | 'name'>('manual');
  const [pickerIconFilterOpen, setPickerIconFilterOpen] = useState(false);
  const [pickerIconFilter, setPickerIconFilter] = useState<string | null>(null);
  const [currentTab, setCurrentTab] = useState<'stopwatch' | 'timer'>('stopwatch');
  const [expandedKeys, setExpandedKeys] = useState<Record<string, boolean>>({});
  const expandAnims = useRef<Record<string, Animated.Value>>({});
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyTask, setHistoryTask] = useState<Task | null>(null);
  const [historyLogs, setHistoryLogs] = useState<TimeLog[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const closePicker = () => {
    setPickerOpen(false);
    setPickerSortKey('manual');
    setPickerIconFilterOpen(false);
    setPickerIconFilter(null);
  };
  const [minuteInputs, setMinuteInputs] = useState<Record<string, string>>({});
  const [secondInputs, setSecondInputs] = useState<Record<string, string>>({});
  const [editingTimerId, setEditingTimerId] = useState<string | null>(null);
  const fabStartX = Math.max(screen.width - 72, 20);
  const fabStartY = Math.max(screen.height - insets.bottom - 132, 120);
  const fabMaxX = screen.width - 60;
  const fabMaxY = screen.height - insets.bottom - 124;
  const fabX = useSharedValue(fabStartX);
  const fabY = useSharedValue(fabStartY);
  const fabGestureStartX = useSharedValue(fabStartX);
  const fabGestureStartY = useSharedValue(fabStartY);

  const getExpandAnim = (itemKey: string) => {
    if (!expandAnims.current[itemKey]) expandAnims.current[itemKey] = new Animated.Value(0);
    return expandAnims.current[itemKey];
  };

  const fabAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: fabX.value }, { translateY: fabY.value }],
  }));
  const panGesture = useMemo(() => Gesture.Pan()
    .minDistance(0)
    .onStart(() => {
      fabGestureStartX.value = fabX.value;
      fabGestureStartY.value = fabY.value;
    })
    .onUpdate((event) => {
      fabX.value = Math.max(8, Math.min(fabGestureStartX.value + event.translationX, fabMaxX));
      fabY.value = Math.max(100, Math.min(fabGestureStartY.value + event.translationY, fabMaxY));
    })
    .onEnd((event) => {
      const nextX = Math.max(8, Math.min(fabGestureStartX.value + event.translationX, fabMaxX));
      const nextY = Math.max(100, Math.min(fabGestureStartY.value + event.translationY, fabMaxY));
      fabX.value = nextX;
      fabY.value = nextY;
    }), [fabGestureStartX, fabGestureStartY, fabMaxX, fabMaxY, fabX, fabY]);
  const tapGesture = useMemo(() => Gesture.Tap()
    .maxDistance(8)
    .onEnd((_event, success) => {
      if (success) runOnJS(setPickerOpen)(true);
    }), []);
  const fabGesture = useMemo(() => Gesture.Simultaneous(panGesture, tapGesture), [panGesture, tapGesture]);

  const runningCount = timers.filter((item) => item.startedAtMs).length;
  const visibleTimers = useMemo(() => timers.filter((item) => item.mode === currentTab), [timers, currentTab]);

  const load = useCallback(async () => {
    const loadedTasks = await getTasks(db);
    setTasks(loadedTasks);
  }, [db]);

  const applyFabSide = useCallback(async () => {
    const layout = await getSetting(db, 'card_layout');
    const x = layout === 'tag_right' ? 8 : fabStartX;
    const y = fabStartY;
    fabX.value = x;
    fabY.value = y;
    fabGestureStartX.value = x;
    fabGestureStartY.value = y;
  }, [db, fabGestureStartX, fabGestureStartY, fabStartX, fabStartY, fabX, fabY]);

  useFocusEffect(useCallback(() => {
    load();
    applyFabSide();
  }, [applyFabSide, load]));

  const availableTasks = tasks.filter((task) => !timers.some((item) => item.task.id === task.id && item.mode === currentTab));
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
    const target = await addTimerAction(task, { mode: currentTab });
    if (target === null) {
      setPickerOpen(false);
        Alert.alert(
          '本日の回数上限です',
          '無料版では計測の開始は1日3回までです。広告を見ると+1回、プレミアムなら無制限です。',
        [
          { text: 'キャンセル', style: 'cancel' },
          {
            text: '広告を見て+1回',
            onPress: async () => {
              const earned = await showRewardedAd();
              if (earned) {
                await grantTimerBonus();
                addTimer(task);
              } else {
                Alert.alert('広告を最後まで見られませんでした');
              }
            },
          },
          { text: 'プレミアムを見る', onPress: () => navigation.navigate('Upgrade') },
        ]
      );
      return;
    }
    const nextKey = `${task.id}:${currentTab}`;
    const split = splitSeconds(target);
    setMinuteInputs((prev) => ({ ...prev, [nextKey]: split.minutes }));
    setSecondInputs((prev) => ({ ...prev, [nextKey]: split.seconds }));
    setPickerOpen(false);
  };

  const handleRemoveTimer = (itemKey: string) => {
    const timer = timers.find((item) => item.key === itemKey);
    if (timer?.startedAtMs) {
      Alert.alert('計測中です', '保存してから外してください。');
      return;
    }
    removeTimer(itemKey);
  };

  const commitTimerMinutes = async (itemKey: string) => {
    const mins = parseInt(minuteInputs[itemKey] ?? '0', 10);
    const secs = parseInt(secondInputs[itemKey] ?? '0', 10);
    const total = Math.max(1, (Math.max(0, isNaN(mins) ? 0 : mins) * 60) + Math.max(0, Math.min(59, isNaN(secs) ? 0 : secs)));
    const split = splitSeconds(total);
    setMinuteInputs((prev) => ({ ...prev, [itemKey]: split.minutes }));
    setSecondInputs((prev) => ({ ...prev, [itemKey]: split.seconds }));
    await updateTargetSeconds(itemKey, total);
    setEditingTimerId((current) => (current === itemKey ? null : current));
  };

  const toggleExpanded = (itemKey: string) => {
    const nextIsOpen = !expandedKeys[itemKey];
    const currentAnim = getExpandAnim(itemKey);
    setExpandedKeys((current) => ({ ...current, [itemKey]: nextIsOpen }));
    if (!nextIsOpen) setEditingTimerId((current) => (current === itemKey ? null : current));
    Animated.timing(currentAnim, {
      toValue: nextIsOpen ? 1 : 0,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  };

  useEffect(() => {
    const runningVisible = visibleTimers.filter((item) => item.startedAtMs);
    if (runningVisible.length === 0) return;
    setExpandedKeys((current) => {
      let changed = false;
      const next = { ...current };
      runningVisible.forEach((item) => {
        if (!next[item.key]) {
          next[item.key] = true;
          changed = true;
        }
      });
      return changed ? next : current;
    });
    runningVisible.forEach((item) => {
      getExpandAnim(item.key).setValue(1);
    });
  }, [visibleTimers]);

  const openHistory = async (task: Task) => {
    setHistoryTask(task);
    setHistoryOpen(true);
    setHistoryLoading(true);
    try {
      const logs = await getTimeLogsForTask(db, task.id, currentTab);
      setHistoryLogs(logs);
    } finally {
      setHistoryLoading(false);
    }
  };

  const confirmDeleteHistoryLog = (log: TimeLog) => {
    Alert.alert(
      '履歴を削除',
      `${formatDuration(log.duration_seconds, true)} の履歴を削除しますか？`,
      [
        { text: 'キャンセル', style: 'cancel' },
        {
          text: '削除',
          style: 'destructive',
          onPress: async () => {
            await deleteTimeLog(db, log.id);
            setHistoryLogs((current) => current.filter((item) => item.id !== log.id));
          },
        },
      ],
    );
  };

  return (
    <View style={s.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor={C.body} />
      <ScrollView style={s.body} contentContainerStyle={[s.content, { paddingTop: insets.top + 16 }]}>
        <Text style={s.modeSub}>動作中 {runningCount}件</Text>

        <View style={s.modeRow}>
          <TouchableOpacity
            style={[s.modeBtn, currentTab === 'stopwatch' && s.modeBtnActive]}
            onPress={() => { setCurrentTab('stopwatch'); setEditingTimerId(null); }}
            activeOpacity={0.85}
          >
            <Text style={[s.modeText, currentTab === 'stopwatch' && s.modeTextActive]}>ストップウォッチ</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.modeBtn, currentTab === 'timer' && s.modeBtnActive]}
            onPress={() => { setCurrentTab('timer'); setEditingTimerId(null); }}
            activeOpacity={0.85}
          >
            <Text style={[s.modeText, currentTab === 'timer' && s.modeTextActive]}>タイマー</Text>
          </TouchableOpacity>
        </View>

        <Text style={s.sectionTitle}>{currentTab === 'timer' ? 'タイマー' : 'ストップウォッチ'}カード</Text>
        {visibleTimers.length === 0 ? (
          <View style={s.emptyBox}>
            <Text style={s.emptyTitle}>まだ何もありません</Text>
            <Text style={s.emptyBody}>右下の＋ボタンから、{currentTab === 'timer' ? 'タイマー' : 'ストップウォッチ'}を入れてください</Text>
          </View>
        ) : visibleTimers.map((item) => {
          const seconds = timerSeconds(item, now);
          const shownSeconds = displayTimerSeconds(item, now);
          const running = !!item.startedAtMs;
          const expanded = !!expandedKeys[item.key];
          const expandAnim = getExpandAnim(item.key);
          return (
            <View key={item.key} style={s.timerCard}>
              <View style={s.timerTop}>
                <View style={s.taskMark}>
                  <Text style={s.taskMarkText}>{item.task.icon ?? '⏱'}</Text>
                </View>
                <View style={s.timerTitleWrap}>
                  <Text style={s.timerTitle} numberOfLines={1}>{item.task.title}</Text>
                  {running || seconds > 0 ? (
                    <Text style={s.timerState}>{running ? '計測中' : '一時停止中'}</Text>
                  ) : (
                    <View style={s.cardActionRow}>
                      <TouchableOpacity style={s.cardActionBtn} activeOpacity={0.85} onPress={() => openHistory(item.task)}>
                        <Text style={s.cardActionText}>履歴</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[s.cardActionBtn, s.cardActionPrimary]}
                        activeOpacity={0.85}
                        onPress={() => {
                          if (!expanded && item.mode === 'timer' && !running) {
                            const split = splitSeconds(item.targetSeconds);
                            setMinuteInputs((prev) => ({ ...prev, [item.key]: split.minutes }));
                            setSecondInputs((prev) => ({ ...prev, [item.key]: split.seconds }));
                          }
                          toggleExpanded(item.key);
                        }}
                      >
                        <Text style={[s.cardActionText, s.cardActionTextPrimary]}>{expanded ? '閉じる' : '計測する'}</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
                <TouchableOpacity style={s.removeBtn} onPress={() => handleRemoveTimer(item.key)}>
                  <Text style={s.removeText}>×</Text>
                </TouchableOpacity>
              </View>
              <Animated.View
                style={[
                  s.expandWrap,
                  {
                    maxHeight: expandAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 280] }),
                    opacity: expandAnim,
                    transform: [{
                      translateY: expandAnim.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] }),
                    }],
                  },
                ]}
              >
                <View style={s.expandInner}>
                  {item.mode === 'timer' && editingTimerId === item.key ? (
                    <View style={s.minuteRow}>
                      <View style={s.timeInputBlock}>
                        <TextInput
                          style={s.minuteInput}
                          value={minuteInputs[item.key] ?? splitSeconds(item.targetSeconds).minutes}
                          onChangeText={(v) => setMinuteInputs((prev) => ({ ...prev, [item.key]: v.replace(/[^0-9]/g, '') }))}
                          onBlur={async () => { await commitTimerMinutes(item.key); }}
                          onSubmitEditing={async () => { await commitTimerMinutes(item.key); }}
                          keyboardType="number-pad"
                          returnKeyType="done"
                          editable={!running}
                          autoFocus
                        />
                        <Text style={s.minuteLabel}>分</Text>
                      </View>
                      <View style={s.timeInputBlock}>
                        <TextInput
                          style={s.secondInput}
                          value={secondInputs[item.key] ?? splitSeconds(item.targetSeconds).seconds}
                          onChangeText={(v) => setSecondInputs((prev) => ({ ...prev, [item.key]: v.replace(/[^0-9]/g, '').slice(0, 2) }))}
                          onBlur={async () => { await commitTimerMinutes(item.key); }}
                          onSubmitEditing={async () => { await commitTimerMinutes(item.key); }}
                          keyboardType="number-pad"
                          returnKeyType="done"
                          editable={!running}
                        />
                        <Text style={s.minuteLabel}>秒</Text>
                      </View>
                    </View>
                  ) : (
                    <View style={s.timeRow}>
                      <Text style={s.timerTime}>{formatDuration(shownSeconds, true)}</Text>
                      {item.mode === 'timer' && !running && (
                        <TouchableOpacity
                          style={s.setTimeBtn}
                          activeOpacity={0.8}
                          onPress={() => {
                            const split = splitSeconds(item.targetSeconds);
                            setMinuteInputs((prev) => ({ ...prev, [item.key]: split.minutes }));
                            setSecondInputs((prev) => ({ ...prev, [item.key]: split.seconds }));
                            setEditingTimerId(item.key);
                          }}
                        >
                          <Text style={s.setTimeBtnText}>時間を設定</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  )}
                  <View style={s.timerControls}>
                    <TouchableOpacity
                      onPress={async () => {
                        const started = await startTimer(item.key);
                        if (started) return;
                      Alert.alert(
                        '本日の回数上限です',
                        '無料版では計測の開始は1日3回までです。広告を見ると+1回、プレミアムなら無制限です。',
                          [
                            { text: 'キャンセル', style: 'cancel' },
                            {
                              text: '広告を見て+1回',
                              onPress: async () => {
                                const earned = await showRewardedAd();
                                if (earned) {
                                  await grantTimerBonus();
                                  await startTimer(item.key);
                                } else {
                                  Alert.alert('広告を最後まで見られませんでした');
                                }
                              },
                            },
                            { text: 'プレミアムを見る', onPress: () => navigation.navigate('Upgrade') },
                          ]
                        );
                      }}
                      disabled={running}
                      activeOpacity={0.86}
                      style={[s.controlBtn, running && s.controlBtnDisabled]}
                    >
                      <Text style={s.startText}>▶</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[s.controlBtn, !running && s.controlBtnDisabled]} onPress={() => pauseTimer(item.key)} disabled={!running}>
                      <Text style={s.pauseText}>❚❚</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[s.controlBtn, seconds <= 0 && s.controlBtnDisabled]} onPress={() => saveTimer(item.key)} disabled={seconds <= 0}>
                      <Text style={s.saveText}>■</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </Animated.View>
            </View>
          );
        })}
      </ScrollView>

      <Modal visible={pickerOpen} transparent animationType="slide" onRequestClose={closePicker} statusBarTranslucent>
        <View style={s.modalBg}>
          <TouchableOpacity style={s.modalBackdrop} activeOpacity={1} onPress={closePicker} />
          <View style={[s.pickerSheet, { height: sheetHeight, paddingBottom: insets.bottom + 18 }]}>
            <View style={s.sheetHandle} />
            <Text style={s.pickerTitle}>{currentTab === 'timer' ? 'タイマーを追加' : 'ストップウォッチを追加'}</Text>
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
                  <Text style={s.emptyBody}>タスク画面で追加するか、この種別のカードを外してください</Text>
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

      <Modal visible={historyOpen} transparent animationType="slide" onRequestClose={() => setHistoryOpen(false)} statusBarTranslucent>
        <View style={s.modalBg}>
          <TouchableOpacity style={s.modalBackdrop} activeOpacity={1} onPress={() => setHistoryOpen(false)} />
          <View style={[s.historySheet, { paddingBottom: insets.bottom + 18 }]}>
            <View style={s.sheetHandle} />
            <View style={s.historyHead}>
              <Text style={s.pickerIcon}>{historyTask?.icon ?? (currentTab === 'timer' ? '⏱' : '⏲️')}</Text>
              <View style={{ flex: 1 }}>
                <Text style={s.historyTitle} numberOfLines={1}>{historyTask?.title ?? '履歴'}</Text>
                <Text style={s.historySub}>{currentTab === 'timer' ? 'タイマー' : 'ストップウォッチ'}の履歴</Text>
              </View>
            </View>
            <ScrollView showsVerticalScrollIndicator contentContainerStyle={s.historyList}>
              {historyLoading ? (
                <View style={s.emptyBox}>
                  <Text style={s.emptyBody}>読み込み中...</Text>
                </View>
              ) : historyLogs.length === 0 ? (
                <View style={s.emptyBox}>
                  <Text style={s.emptyTitle}>履歴はまだありません</Text>
                </View>
              ) : historyLogs.map((log) => (
                <View key={log.id} style={s.historyRow}>
                  <View style={s.historyRowTop}>
                    <Text style={s.historyDuration}>{formatDuration(log.duration_seconds, true)}</Text>
                    <View style={s.historyRowActions}>
                      <Text style={s.historyMeta}>{log.mode === 'timer' ? 'タイマー' : 'ストップウォッチ'}</Text>
                      <TouchableOpacity style={s.historyDeleteBtn} onPress={() => confirmDeleteHistoryLog(log)} activeOpacity={0.8}>
                        <Text style={s.historyDeleteText}>削除</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                  <Text style={s.historyMeta}>{formatLogStamp(log.started_at)} - {formatLogStamp(log.ended_at)}</Text>
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <GestureDetector gesture={fabGesture}>
        <ReanimatedAnimated.View style={[s.fabWrap, fabAnimatedStyle]}>
          <LinearGradient colors={grad.brand} start={GRAD_START} end={GRAD_END} style={s.fab}>
            <Text style={s.fabText}>＋</Text>
          </LinearGradient>
        </ReanimatedAnimated.View>
      </GestureDetector>

      <TabBar current="Timer" navigation={navigation} />
    </View>
  );
}
