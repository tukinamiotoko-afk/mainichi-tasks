import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, Modal,
  TextInput, StyleSheet, Alert, KeyboardAvoidingView,
  Platform, StatusBar, Animated, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSQLiteContext } from 'expo-sqlite';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Notifications from 'expo-notifications';
import { RootStackParamList } from '../../App';
import {
  Task, getToday, getTasks, addTask, updateTask, deleteTask,
  updateTaskPriority, updateTaskIcon, updateTaskTargetTime, updateTaskFrequency,
  getCompletionsForDate, markComplete, markIncomplete,
  NotificationSetting, getNotificationSettingsForTask,
  addNotificationSetting, deleteNotificationSetting,
} from '../db/database';
import TabBar from '../components/TabBar';

const C = {
  header:    '#3b82f6',
  body:      '#f0f2f5',
  card:      '#ffffff',
  border:    '#e2e8f0',
  primary:   '#3b82f6',
  onPrimary: '#ffffff',
  onDark:    '#2d3748',
  muted:     '#94a3b8',
  stone:     '#64748b',
  error:     '#e52020',
};

const ICONS = ['✅', '⭐', '💪', '🏃', '🧘', '📚', '💊', '🍎', '💧', '🎯', '🛌', '🧹', '🎵', '🌱', '✍️', '🔔', '🚿', '☀️', '🏆', '🎮'];
const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

type NotifType = 'full' | 'silent';
type FreqMode = 'daily' | 'weekly' | 'days';
type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'Home'> };

async function scheduleNotif(time: string, type: NotifType): Promise<string | null> {
  const [h, m] = time.split(':').map(Number);
  try {
    return await Notifications.scheduleNotificationAsync({
      content: {
        title: '毎日タスク',
        body: '今日のタスクを確認しましょう！',
        sound: type === 'full',
        android: { channelId: type === 'full' ? 'full' : 'silent' } as any,
      },
      trigger: { hour: h, minute: m, repeats: true } as any,
    });
  } catch { return null; }
}

function formatTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function parseFreq(frequency: string): { mode: FreqMode; weeklyN: number; days: number[] } {
  if (!frequency || frequency === 'daily') return { mode: 'daily', weeklyN: 1, days: [] };
  if (frequency.startsWith('weekly:')) {
    return { mode: 'weekly', weeklyN: parseInt(frequency.split(':')[1], 10) || 1, days: [] };
  }
  if (frequency.startsWith('days:')) {
    const days = frequency.split(':')[1].split(',').map(Number).filter(n => !isNaN(n));
    return { mode: 'days', weeklyN: 1, days };
  }
  return { mode: 'daily', weeklyN: 1, days: [] };
}

export default function HomeScreen({ navigation }: Props) {
  const db = useSQLiteContext();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [completedMap, setCompletedMap] = useState<Map<number, string | null>>(new Map());
  const [showThumb, setShowThumb] = useState(false);
  const thumbAnim = useRef(new Animated.Value(0)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;
  const today = getToday();

  // ── 追加シート state ──────────────────────────────────────
  const [showAdd, setShowAdd] = useState(false);
  const [addTitle, setAddTitle] = useState('');
  const [addIcon, setAddIcon] = useState('✅');
  const [addPriority, setAddPriority] = useState(1);
  const [addFreqMode, setAddFreqMode] = useState<FreqMode>('daily');
  const [addFreqWeeklyN, setAddFreqWeeklyN] = useState(1);
  const [addFreqDays, setAddFreqDays] = useState<number[]>([]);
  const [addTargetTime, setAddTargetTime] = useState<string | null>(null);
  const [addTargetPickerTime, setAddTargetPickerTime] = useState(new Date());
  const [showAddTargetPicker, setShowAddTargetPicker] = useState(false);
  const [addNotifType, setAddNotifType] = useState<NotifType>('full');
  const [addNotifs, setAddNotifs] = useState<{ time: string; type: NotifType }[]>([]);
  const [showAddTimePicker, setShowAddTimePicker] = useState(false);
  const [addPickerTime, setAddPickerTime] = useState(new Date());

  // ── 詳細シート state ──────────────────────────────────────
  const [detailTask, setDetailTask] = useState<Task | null>(null);
  const [detailTitle, setDetailTitle] = useState('');
  const [taskNotifs, setTaskNotifs] = useState<NotificationSetting[]>([]);
  const [notifType, setNotifType] = useState<NotifType>('full');
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [showTargetPicker, setShowTargetPicker] = useState(false);
  const [pickerTime, setPickerTime] = useState(new Date());
  const [targetPickerTime, setTargetPickerTime] = useState(new Date());
  const [freqMode, setFreqMode] = useState<FreqMode>('daily');
  const [freqWeeklyN, setFreqWeeklyN] = useState(1);
  const [freqDays, setFreqDays] = useState<number[]>([]);

  const load = useCallback(async () => {
    const ts = await getTasks(db);
    const cs = await getCompletionsForDate(db, today);
    const map = new Map<number, string | null>();
    for (const c of cs) map.set(c.task_id, c.completed_at);
    setTasks(ts);
    setCompletedMap(map);
  }, [db, today]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const done = tasks.filter((t) => completedMap.has(t.id)).length;
  const total = tasks.length;
  const progress = total > 0 ? done / total : 0;

  const sortedTasks = [...tasks].sort((a, b) => {
    const aDone = completedMap.has(a.id) ? 1 : 0;
    const bDone = completedMap.has(b.id) ? 1 : 0;
    return bDone - aDone;
  });

  useEffect(() => {
    Animated.timing(progressAnim, {
      toValue: progress,
      duration: 700,
      useNativeDriver: false,
    }).start();
  }, [progress]);

  const triggerCelebration = () => {
    setShowThumb(true);
    thumbAnim.setValue(0);
    Animated.sequence([
      Animated.spring(thumbAnim, { toValue: 1, useNativeDriver: true, tension: 180, friction: 6 }),
      Animated.delay(500),
      Animated.timing(thumbAnim, { toValue: 0, duration: 250, useNativeDriver: true }),
    ]).start(() => setShowThumb(false));
  };

  const toggle = async (id: number) => {
    if (completedMap.has(id)) {
      await markIncomplete(db, id, today);
    } else {
      await markComplete(db, id, today);
      triggerCelebration();
    }
    load();
  };

  const buildFrequency = (mode: FreqMode, n: number, days: number[]): string => {
    if (mode === 'daily') return 'daily';
    if (mode === 'weekly') return `weekly:${n}`;
    if (mode === 'days' && days.length > 0) return `days:${[...days].sort().join(',')}`;
    return 'daily';
  };

  // ── 追加シート handlers ───────────────────────────────────
  const resetAdd = () => {
    setAddTitle('');
    setAddIcon('✅');
    setAddPriority(1);
    setAddFreqMode('daily');
    setAddFreqWeeklyN(1);
    setAddFreqDays([]);
    setAddTargetTime(null);
    setAddNotifs([]);
    setAddNotifType('full');
    setShowAddTimePicker(false);
    setShowAddTargetPicker(false);
    setShowAdd(false);
  };

  const handleAdd = async () => {
    const title = addTitle.trim();
    if (!title) return;
    const taskId = await addTask(db, title);
    await updateTaskIcon(db, taskId, addIcon);
    await updateTaskPriority(db, taskId, addPriority);
    if (addTargetTime) await updateTaskTargetTime(db, taskId, addTargetTime);
    await updateTaskFrequency(db, taskId, buildFrequency(addFreqMode, addFreqWeeklyN, addFreqDays));
    if (addNotifs.length > 0) {
      const { status } = await Notifications.requestPermissionsAsync();
      if (status === 'granted') {
        for (const n of addNotifs) {
          const identifier = await scheduleNotif(n.time, n.type);
          await addNotificationSetting(db, n.time, n.type, identifier, taskId);
        }
      }
    }
    resetAdd();
    load();
  };

  const handleAddNotifToList = (date: Date) => {
    setShowAddTimePicker(false);
    const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    setAddNotifs(prev => [...prev, { time, type: addNotifType }]);
  };

  const toggleAddFreqDay = (day: number) => {
    setAddFreqDays(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]);
  };

  // ── 詳細シート handlers ───────────────────────────────────
  const openDetail = async (task: Task) => {
    const notifs = await getNotificationSettingsForTask(db, task.id);
    const freq = parseFreq(task.frequency ?? 'daily');
    setDetailTask(task);
    setDetailTitle(task.title);
    setTaskNotifs(notifs);
    setFreqMode(freq.mode);
    setFreqWeeklyN(freq.weeklyN);
    setFreqDays(freq.days);
    if (task.target_time) {
      const [h, m] = task.target_time.split(':').map(Number);
      const d = new Date(); d.setHours(h, m, 0, 0);
      setTargetPickerTime(d);
    }
  };

  const handleSaveTitle = async () => {
    if (!detailTask || !detailTitle.trim()) return;
    await updateTask(db, detailTask.id, detailTitle.trim());
    setDetailTask(t => t ? { ...t, title: detailTitle.trim() } : null);
    load();
  };

  const handleSetIcon = async (icon: string) => {
    if (!detailTask) return;
    await updateTaskIcon(db, detailTask.id, icon);
    setDetailTask(t => t ? { ...t, icon } : null);
    load();
  };

  const handleSetPriority = async (priority: number) => {
    if (!detailTask) return;
    await updateTaskPriority(db, detailTask.id, priority);
    setDetailTask(t => t ? { ...t, priority } : null);
    load();
  };

  const handleSetTargetTime = async (date: Date) => {
    setShowTargetPicker(false);
    if (!detailTask) return;
    const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    await updateTaskTargetTime(db, detailTask.id, time);
    setDetailTask(t => t ? { ...t, target_time: time } : null);
    load();
  };

  const handleClearTargetTime = async () => {
    if (!detailTask) return;
    await updateTaskTargetTime(db, detailTask.id, null);
    setDetailTask(t => t ? { ...t, target_time: null } : null);
    load();
  };

  const handleFreqChange = async (mode: FreqMode, n: number, days: number[]) => {
    if (!detailTask) return;
    const freq = buildFrequency(mode, n, days);
    await updateTaskFrequency(db, detailTask.id, freq);
    setDetailTask(t => t ? { ...t, frequency: freq } : null);
    load();
  };

  const toggleFreqDay = (day: number) => {
    const newDays = freqDays.includes(day) ? freqDays.filter(d => d !== day) : [...freqDays, day];
    setFreqDays(newDays);
    handleFreqChange('days', freqWeeklyN, newDays);
  };

  const handleAddNotif = async (date: Date) => {
    setShowTimePicker(false);
    if (!detailTask) return;
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('通知の許可が必要です', '設定から通知を許可してください。');
      return;
    }
    const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    const identifier = await scheduleNotif(time, notifType);
    await addNotificationSetting(db, time, notifType, identifier, detailTask.id);
    setTaskNotifs(await getNotificationSettingsForTask(db, detailTask.id));
  };

  const handleDeleteNotif = async (notif: NotificationSetting) => {
    const id = await deleteNotificationSetting(db, notif.id);
    if (id) await Notifications.cancelScheduledNotificationAsync(id);
    if (detailTask) setTaskNotifs(await getNotificationSettingsForTask(db, detailTask.id));
  };

  const handleDelete = (task: Task) => {
    Alert.alert('削除', `「${task.title}」を削除しますか？`, [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: '削除', style: 'destructive',
        onPress: async () => {
          const identifiers = await deleteTask(db, task.id);
          for (const id of identifiers) await Notifications.cancelScheduledNotificationAsync(id);
          setDetailTask(null);
          load();
        },
      },
    ]);
  };

  const now = new Date();
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  const dateLabel = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')} (${weekdays[now.getDay()]})`;

  const renderFreqControls = (
    mode: FreqMode, weeklyN: number, days: number[],
    setMode: (m: FreqMode) => void,
    setN: (n: number) => void,
    toggleDay: (d: number) => void,
    onModeChange?: (m: FreqMode) => void,
  ) => (
    <>
      <View style={s.typeRow}>
        {(['daily', 'weekly', 'days'] as FreqMode[]).map((m) => (
          <TouchableOpacity
            key={m}
            style={[s.typeChip, mode === m && s.typeChipActive]}
            onPress={() => { setMode(m); onModeChange?.(m); }}
          >
            <Text style={[s.typeChipText, mode === m && s.typeChipTextActive]}>
              {m === 'daily' ? '毎日' : m === 'weekly' ? '週N回' : '曜日'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      {mode === 'weekly' && (
        <View style={s.weeklyRow}>
          <TouchableOpacity style={s.weeklyBtn} onPress={() => setN(Math.max(1, weeklyN - 1))}>
            <Text style={s.weeklyBtnText}>－</Text>
          </TouchableOpacity>
          <Text style={s.weeklyNum}>週{weeklyN}回</Text>
          <TouchableOpacity style={s.weeklyBtn} onPress={() => setN(Math.min(6, weeklyN + 1))}>
            <Text style={s.weeklyBtnText}>＋</Text>
          </TouchableOpacity>
        </View>
      )}
      {mode === 'days' && (
        <View style={s.daysRow}>
          {WEEKDAY_LABELS.map((label, i) => (
            <TouchableOpacity
              key={i}
              style={[s.dayChip, days.includes(i) && s.dayChipActive]}
              onPress={() => toggleDay(i)}
            >
              <Text style={[s.dayChipText, days.includes(i) && s.dayChipTextActive]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </>
  );

  return (
    <SafeAreaView style={s.safeArea} edges={['top', 'bottom']}>
      <StatusBar barStyle="light-content" backgroundColor={C.header} />

      <View style={s.headerCard}>
        <Text style={s.dateText}>{dateLabel}</Text>
        <Text style={s.headerLabel}>今日の進捗</Text>
        <View style={s.progressRow}>
          <View style={s.progressBg}>
            <Animated.View style={[s.progressFill, {
              width: progressAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
            }]} />
          </View>
          <Text style={s.progressText}>{done} / {total}</Text>
        </View>
      </View>

      <FlatList
        data={sortedTasks}
        keyExtractor={(item) => String(item.id)}
        style={s.list}
        contentContainerStyle={{ padding: 16, gap: 10 }}
        ListHeaderComponent={
          <View style={s.sectionBar}>
            <Text style={s.metaLabel}>チェックリスト</Text>
            {total > 0 && <Text style={s.stone}>{total}件</Text>}
          </View>
        }
        ListEmptyComponent={
          <View style={s.empty}>
            <Text style={s.emptyTitle}>タスクなし</Text>
            <Text style={s.emptyBody}>右下の ＋ から追加できます</Text>
          </View>
        }
        renderItem={({ item }) => {
          const isDone = completedMap.has(item.id);
          const completedAt = formatTime(completedMap.get(item.id));
          const targetTime = item.target_time ?? null;
          const showTimes = targetTime || completedAt;
          return (
            <TouchableOpacity
              style={[s.taskCard, isDone && s.taskCardDone]}
              onPress={() => openDetail(item)}
              activeOpacity={0.85}
            >
              {item.priority === 2 && <View style={s.priorityBar} />}
              <TouchableOpacity
                style={[s.checkBox, isDone && s.checkBoxDone]}
                onPress={() => toggle(item.id)}
                hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
              >
                {isDone && <Text style={s.checkMark}>✓</Text>}
              </TouchableOpacity>
              <View style={s.taskBody}>
                <View style={s.taskRow}>
                  <Text style={s.taskIcon}>{item.icon || '✅'}</Text>
                  <Text style={[s.taskTitle, isDone && s.taskTitleDone]} numberOfLines={2}>
                    {item.title}
                  </Text>
                  {isDone && <View style={s.doneBadge}><Text style={s.doneBadgeText}>完了</Text></View>}
                </View>
                {showTimes && (
                  <View style={s.timeRow}>
                    {targetTime && <Text style={s.timeLabel}>目標 {targetTime}</Text>}
                    {completedAt && <Text style={[s.timeLabel, s.timeDone]}>完了 {completedAt}</Text>}
                  </View>
                )}
              </View>
            </TouchableOpacity>
          );
        }}
        ListFooterComponent={<View style={{ height: 80 }} />}
      />

      <TabBar current="Home" navigation={navigation} />

      <TouchableOpacity style={s.fab} onPress={() => setShowAdd(true)} activeOpacity={0.85}>
        <Text style={s.fabText}>＋</Text>
      </TouchableOpacity>

      {showThumb && (
        <Animated.View style={[s.thumbOverlay, {
          opacity: thumbAnim,
          transform: [{ scale: thumbAnim.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }],
        }]} pointerEvents="none">
          <Text style={s.thumbEmoji}>👍</Text>
        </Animated.View>
      )}

      {/* ── 追加シート ─────────────────────────────────────── */}
      <Modal visible={showAdd} transparent animationType="slide" onRequestClose={resetAdd}>
        <TouchableOpacity style={s.sheetBg} activeOpacity={1} onPress={resetAdd}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <TouchableOpacity activeOpacity={1} onPress={() => {}}>
              <View style={s.sheet}>
                <View style={s.sheetHandle} />
                <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                  <Text style={s.sheetTitle}>タスクを追加</Text>

                  <Text style={s.sheetSection}>タスク名</Text>
                  <TextInput
                    style={s.addInput}
                    value={addTitle}
                    onChangeText={setAddTitle}
                    placeholder="例：歯磨き、運動、水を飲む"
                    placeholderTextColor={C.muted}
                    returnKeyType="done"
                    autoFocus
                  />

                  <Text style={[s.sheetSection, { marginTop: 16 }]}>アイコン</Text>
                  <View style={s.iconGrid}>
                    {ICONS.map((icon) => (
                      <TouchableOpacity
                        key={icon}
                        style={[s.iconBtn, addIcon === icon && s.iconBtnActive]}
                        onPress={() => setAddIcon(icon)}
                      >
                        <Text style={s.iconEmoji}>{icon}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <Text style={[s.sheetSection, { marginTop: 16 }]}>優先順位</Text>
                  <View style={s.typeRow}>
                    {([0, 1, 2] as const).map((p) => (
                      <TouchableOpacity
                        key={p}
                        style={[s.typeChip, addPriority === p && s.typeChipActive]}
                        onPress={() => setAddPriority(p)}
                      >
                        <Text style={[s.typeChipText, addPriority === p && s.typeChipTextActive]}>
                          {p === 0 ? '低' : p === 1 ? '中' : '⚡ 高'}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <Text style={[s.sheetSection, { marginTop: 16 }]}>目標時間</Text>
                  <View style={s.targetRow}>
                    <TouchableOpacity style={s.targetBtn} onPress={() => setShowAddTargetPicker(true)}>
                      <Text style={s.targetBtnText}>
                        {addTargetTime ? `🕐 ${addTargetTime}` : '＋ 時間を設定'}
                      </Text>
                    </TouchableOpacity>
                    {addTargetTime && (
                      <TouchableOpacity style={s.targetClearBtn} onPress={() => setAddTargetTime(null)}>
                        <Text style={s.targetClearText}>×</Text>
                      </TouchableOpacity>
                    )}
                  </View>

                  <Text style={[s.sheetSection, { marginTop: 16 }]}>頻度</Text>
                  {renderFreqControls(
                    addFreqMode, addFreqWeeklyN, addFreqDays,
                    setAddFreqMode,
                    setAddFreqWeeklyN,
                    toggleAddFreqDay,
                  )}

                  <Text style={[s.sheetSection, { marginTop: 16 }]}>通知</Text>
                  <View style={s.typeRow}>
                    <TouchableOpacity style={[s.typeChip, addNotifType === 'full' && s.typeChipActive]} onPress={() => setAddNotifType('full')}>
                      <Text style={[s.typeChipText, addNotifType === 'full' && s.typeChipTextActive]}>🔔 通常</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[s.typeChip, addNotifType === 'silent' && s.typeChipActive]} onPress={() => setAddNotifType('silent')}>
                      <Text style={[s.typeChipText, addNotifType === 'silent' && s.typeChipTextActive]}>🔕 サイレント</Text>
                    </TouchableOpacity>
                  </View>
                  {addNotifs.map((n, i) => (
                    <View key={i} style={s.notifRow}>
                      <Text style={s.notifTime}>{n.time}</Text>
                      <Text style={s.notifTypeText}>{n.type === 'full' ? '🔔' : '🔕'}</Text>
                      <TouchableOpacity onPress={() => setAddNotifs(prev => prev.filter((_, j) => j !== i))} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <Text style={s.deleteBtnText}>🗑️</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                  <TouchableOpacity style={s.addNotifBtn} onPress={() => setShowAddTimePicker(true)}>
                    <Text style={s.addNotifBtnText}>＋ 通知時間を追加</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[s.addConfirmBtn, !addTitle.trim() && s.addConfirmBtnDisabled]}
                    onPress={handleAdd}
                    disabled={!addTitle.trim()}
                  >
                    <Text style={s.addConfirmBtnText}>タスクを追加</Text>
                  </TouchableOpacity>

                  <View style={{ height: 20 }} />
                </ScrollView>
              </View>
            </TouchableOpacity>
          </KeyboardAvoidingView>
        </TouchableOpacity>
      </Modal>

      {/* ── 詳細シート ─────────────────────────────────────── */}
      <Modal visible={!!detailTask} transparent animationType="slide" onRequestClose={() => setDetailTask(null)}>
        <TouchableOpacity style={s.sheetBg} activeOpacity={1} onPress={() => setDetailTask(null)}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <TouchableOpacity activeOpacity={1} onPress={() => {}}>
              <View style={s.sheet}>
                <View style={s.sheetHandle} />
                <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

                  <Text style={s.sheetSection}>タスク名</Text>
                  <View style={s.sheetTitleRow}>
                    <TextInput
                      style={s.sheetTitleInput}
                      value={detailTitle}
                      onChangeText={setDetailTitle}
                      returnKeyType="done"
                      onSubmitEditing={handleSaveTitle}
                    />
                    <TouchableOpacity
                      style={[s.sheetSaveBtn, detailTitle === detailTask?.title && s.sheetSaveBtnDisabled]}
                      onPress={handleSaveTitle}
                      disabled={detailTitle === detailTask?.title}
                    >
                      <Text style={s.sheetSaveBtnText}>保存</Text>
                    </TouchableOpacity>
                  </View>

                  <Text style={[s.sheetSection, { marginTop: 16 }]}>アイコン</Text>
                  <View style={s.iconGrid}>
                    {ICONS.map((icon) => (
                      <TouchableOpacity
                        key={icon}
                        style={[s.iconBtn, detailTask?.icon === icon && s.iconBtnActive]}
                        onPress={() => handleSetIcon(icon)}
                      >
                        <Text style={s.iconEmoji}>{icon}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <Text style={[s.sheetSection, { marginTop: 16 }]}>優先順位</Text>
                  <View style={s.typeRow}>
                    {([0, 1, 2] as const).map((p) => (
                      <TouchableOpacity
                        key={p}
                        style={[s.typeChip, (detailTask?.priority ?? 1) === p && s.typeChipActive]}
                        onPress={() => handleSetPriority(p)}
                      >
                        <Text style={[s.typeChipText, (detailTask?.priority ?? 1) === p && s.typeChipTextActive]}>
                          {p === 0 ? '低' : p === 1 ? '中' : '⚡ 高'}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <Text style={[s.sheetSection, { marginTop: 16 }]}>目標時間</Text>
                  <View style={s.targetRow}>
                    <TouchableOpacity style={s.targetBtn} onPress={() => setShowTargetPicker(true)}>
                      <Text style={s.targetBtnText}>
                        {detailTask?.target_time ? `🕐 ${detailTask.target_time}` : '＋ 時間を設定'}
                      </Text>
                    </TouchableOpacity>
                    {detailTask?.target_time && (
                      <TouchableOpacity style={s.targetClearBtn} onPress={handleClearTargetTime}>
                        <Text style={s.targetClearText}>×</Text>
                      </TouchableOpacity>
                    )}
                  </View>

                  <Text style={[s.sheetSection, { marginTop: 16 }]}>頻度</Text>
                  {renderFreqControls(
                    freqMode, freqWeeklyN, freqDays,
                    (m) => { setFreqMode(m); if (m !== 'days') handleFreqChange(m, freqWeeklyN, freqDays); },
                    (n) => { setFreqWeeklyN(n); handleFreqChange('weekly', n, freqDays); },
                    toggleFreqDay,
                  )}

                  <Text style={[s.sheetSection, { marginTop: 16 }]}>通知</Text>
                  <View style={s.typeRow}>
                    <TouchableOpacity style={[s.typeChip, notifType === 'full' && s.typeChipActive]} onPress={() => setNotifType('full')}>
                      <Text style={[s.typeChipText, notifType === 'full' && s.typeChipTextActive]}>🔔 通常</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[s.typeChip, notifType === 'silent' && s.typeChipActive]} onPress={() => setNotifType('silent')}>
                      <Text style={[s.typeChipText, notifType === 'silent' && s.typeChipTextActive]}>🔕 サイレント</Text>
                    </TouchableOpacity>
                  </View>
                  {taskNotifs.map((n) => (
                    <View key={n.id} style={s.notifRow}>
                      <Text style={s.notifTime}>{n.time}</Text>
                      <Text style={s.notifTypeText}>{n.notification_type === 'full' ? '🔔' : '🔕'}</Text>
                      <TouchableOpacity onPress={() => handleDeleteNotif(n)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <Text style={s.deleteBtnText}>🗑️</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                  <TouchableOpacity style={s.addNotifBtn} onPress={() => setShowTimePicker(true)}>
                    <Text style={s.addNotifBtnText}>＋ 通知時間を追加</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={s.deleteTaskBtn}
                    onPress={() => detailTask && handleDelete(detailTask)}
                  >
                    <Text style={s.deleteTaskBtnText}>🗑️ このタスクを削除</Text>
                  </TouchableOpacity>

                  <View style={{ height: 20 }} />
                </ScrollView>
              </View>
            </TouchableOpacity>
          </KeyboardAvoidingView>
        </TouchableOpacity>
      </Modal>

      {/* ── 時刻ピッカー群 ──────────────────────────────────── */}
      {showTimePicker && (
        <DateTimePicker
          value={pickerTime} mode="time"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={(_, date) => {
            if (Platform.OS === 'android') { if (date) handleAddNotif(date); else setShowTimePicker(false); }
            else { if (date) setPickerTime(date); }
          }}
        />
      )}
      {Platform.OS === 'ios' && showTimePicker && (
        <View style={s.iosRow}>
          <TouchableOpacity style={s.iosCancelBtn} onPress={() => setShowTimePicker(false)}><Text style={s.iosCancelText}>キャンセル</Text></TouchableOpacity>
          <TouchableOpacity style={s.iosConfirmBtn} onPress={() => handleAddNotif(pickerTime)}><Text style={s.iosConfirmText}>追加</Text></TouchableOpacity>
        </View>
      )}

      {showTargetPicker && (
        <DateTimePicker
          value={targetPickerTime} mode="time"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={(_, date) => {
            if (Platform.OS === 'android') { if (date) handleSetTargetTime(date); else setShowTargetPicker(false); }
            else { if (date) setTargetPickerTime(date); }
          }}
        />
      )}
      {Platform.OS === 'ios' && showTargetPicker && (
        <View style={s.iosRow}>
          <TouchableOpacity style={s.iosCancelBtn} onPress={() => setShowTargetPicker(false)}><Text style={s.iosCancelText}>キャンセル</Text></TouchableOpacity>
          <TouchableOpacity style={s.iosConfirmBtn} onPress={() => handleSetTargetTime(targetPickerTime)}><Text style={s.iosConfirmText}>設定</Text></TouchableOpacity>
        </View>
      )}

      {showAddTimePicker && (
        <DateTimePicker
          value={addPickerTime} mode="time"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={(_, date) => {
            if (Platform.OS === 'android') { if (date) handleAddNotifToList(date); else setShowAddTimePicker(false); }
            else { if (date) setAddPickerTime(date); }
          }}
        />
      )}
      {Platform.OS === 'ios' && showAddTimePicker && (
        <View style={s.iosRow}>
          <TouchableOpacity style={s.iosCancelBtn} onPress={() => setShowAddTimePicker(false)}><Text style={s.iosCancelText}>キャンセル</Text></TouchableOpacity>
          <TouchableOpacity style={s.iosConfirmBtn} onPress={() => handleAddNotifToList(addPickerTime)}><Text style={s.iosConfirmText}>追加</Text></TouchableOpacity>
        </View>
      )}

      {showAddTargetPicker && (
        <DateTimePicker
          value={addTargetPickerTime} mode="time"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={(_, date) => {
            if (Platform.OS === 'android') {
              if (date) {
                setAddTargetTime(`${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`);
              }
              setShowAddTargetPicker(false);
            } else { if (date) setAddTargetPickerTime(date); }
          }}
        />
      )}
      {Platform.OS === 'ios' && showAddTargetPicker && (
        <View style={s.iosRow}>
          <TouchableOpacity style={s.iosCancelBtn} onPress={() => setShowAddTargetPicker(false)}><Text style={s.iosCancelText}>キャンセル</Text></TouchableOpacity>
          <TouchableOpacity style={s.iosConfirmBtn} onPress={() => {
            setAddTargetTime(`${String(addTargetPickerTime.getHours()).padStart(2, '0')}:${String(addTargetPickerTime.getMinutes()).padStart(2, '0')}`);
            setShowAddTargetPicker(false);
          }}><Text style={s.iosConfirmText}>設定</Text></TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: C.header },

  headerCard: { backgroundColor: C.header, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 24 },
  dateText: { color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: '600', marginBottom: 12 },
  headerLabel: { color: 'rgba(255,255,255,0.6)', fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 },
  progressBg: { flex: 1, height: 4, backgroundColor: 'rgba(255,255,255,0.25)', borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: '#ffffff' },
  progressText: { color: '#ffffff', fontSize: 11, fontWeight: '700' },

  list: { flex: 1, backgroundColor: C.body },
  sectionBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  metaLabel: { color: C.muted, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  stone: { color: C.stone, fontSize: 11, fontWeight: '700' },

  taskCard: {
    flexDirection: 'row', alignItems: 'flex-start',
    backgroundColor: C.card, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 14, gap: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4,
    elevation: 2,
  },
  taskCardDone: { opacity: 0.6 },
  priorityBar: { position: 'absolute', left: 0, top: 10, bottom: 10, width: 4, backgroundColor: '#ef4444', borderRadius: 2 },
  checkBox: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: C.border, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  checkBoxDone: { backgroundColor: C.primary, borderColor: C.primary },
  checkMark: { color: C.onPrimary, fontSize: 11, fontWeight: '700' },
  taskBody: { flex: 1, gap: 4 },
  taskRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  taskIcon: { fontSize: 18 },
  taskTitle: { flex: 1, color: C.onDark, fontSize: 14, fontWeight: '500', lineHeight: 20 },
  taskTitleDone: { color: C.muted, textDecorationLine: 'line-through' },
  doneBadge: { backgroundColor: C.header, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  doneBadgeText: { color: C.onPrimary, fontSize: 9, fontWeight: '700', letterSpacing: 0.5 },
  timeRow: { flexDirection: 'row', gap: 10, paddingLeft: 26 },
  timeLabel: { color: C.muted, fontSize: 11, fontWeight: '600' },
  timeDone: { color: '#22c55e' },
  deleteBtnText: { fontSize: 16 },

  empty: { paddingVertical: 60, alignItems: 'center', gap: 8 },
  emptyTitle: { color: C.stone, fontSize: 16, fontWeight: '700' },
  emptyBody: { color: C.muted, fontSize: 13 },

  fab: { position: 'absolute', bottom: 72, right: 20, width: 52, height: 52, borderRadius: 26, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center', elevation: 6, shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.25, shadowRadius: 6 },
  fabText: { color: C.onPrimary, fontSize: 26, fontWeight: '400', lineHeight: 30 },

  sheetBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: C.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingTop: 12, maxHeight: '88%' },
  sheetHandle: { width: 40, height: 4, backgroundColor: C.border, borderRadius: 2, alignSelf: 'center', marginBottom: 12 },
  sheetTitle: { color: C.onDark, fontSize: 17, fontWeight: '700', marginBottom: 16 },
  sheetSection: { color: C.muted, fontSize: 11, fontWeight: '700', letterSpacing: 0.5, marginBottom: 8 },
  sheetTitleRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  sheetTitleInput: { flex: 1, borderWidth: 1, borderColor: C.border, borderRadius: 10, padding: 12, fontSize: 15, color: C.onDark, backgroundColor: C.body },
  addInput: { borderWidth: 1, borderColor: C.border, borderRadius: 10, padding: 12, fontSize: 15, color: C.onDark, backgroundColor: C.body },
  sheetSaveBtn: { backgroundColor: C.primary, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12 },
  sheetSaveBtnDisabled: { backgroundColor: C.border },
  sheetSaveBtnText: { color: C.onPrimary, fontSize: 13, fontWeight: '700' },

  iconGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
  iconBtn: { width: 44, height: 44, borderRadius: 10, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  iconBtnActive: { backgroundColor: C.primary, borderColor: C.primary },
  iconEmoji: { fontSize: 22 },

  typeRow: { flexDirection: 'row', gap: 8 },
  typeChip: { flex: 1, borderWidth: 1, borderColor: C.border, borderRadius: 20, paddingVertical: 8, alignItems: 'center' },
  typeChipActive: { backgroundColor: C.primary, borderColor: C.primary },
  typeChipText: { color: C.muted, fontSize: 12, fontWeight: '700' },
  typeChipTextActive: { color: C.onPrimary },

  targetRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  targetBtn: { flex: 1, borderWidth: 1, borderColor: C.border, borderRadius: 10, padding: 12, alignItems: 'center' },
  targetBtnText: { color: C.primary, fontSize: 14, fontWeight: '700' },
  targetClearBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#fee2e2', alignItems: 'center', justifyContent: 'center' },
  targetClearText: { color: C.error, fontSize: 18, fontWeight: '700' },

  weeklyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 20, marginTop: 10 },
  weeklyBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.body, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  weeklyBtnText: { color: C.primary, fontSize: 20, fontWeight: '700' },
  weeklyNum: { color: C.onDark, fontSize: 16, fontWeight: '700', minWidth: 60, textAlign: 'center' },
  daysRow: { flexDirection: 'row', gap: 6, marginTop: 10, flexWrap: 'wrap' },
  dayChip: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  dayChipActive: { backgroundColor: C.primary, borderColor: C.primary },
  dayChipText: { color: C.muted, fontSize: 12, fontWeight: '700' },
  dayChipTextActive: { color: C.onPrimary },

  notifRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.border, gap: 12 },
  notifTime: { flex: 1, fontSize: 18, fontWeight: '700', color: C.onDark },
  notifTypeText: { fontSize: 16 },
  addNotifBtn: { backgroundColor: C.body, borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 4 },
  addNotifBtnText: { color: C.primary, fontSize: 14, fontWeight: '700' },

  addConfirmBtn: { marginTop: 20, backgroundColor: C.primary, borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
  addConfirmBtnDisabled: { backgroundColor: C.border },
  addConfirmBtnText: { color: C.onPrimary, fontSize: 15, fontWeight: '700' },

  deleteTaskBtn: { marginTop: 20, borderWidth: 1, borderColor: '#fee2e2', backgroundColor: '#fff5f5', borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  deleteTaskBtnText: { color: C.error, fontSize: 14, fontWeight: '700' },

  iosRow: { flexDirection: 'row', backgroundColor: C.card, borderTopWidth: 1, borderTopColor: C.border, padding: 12, gap: 12 },
  iosCancelBtn: { flex: 1, borderWidth: 1, borderColor: C.border, borderRadius: 8, paddingVertical: 12, alignItems: 'center' },
  iosCancelText: { color: C.stone, fontSize: 14, fontWeight: '700' },
  iosConfirmBtn: { flex: 1, backgroundColor: C.primary, borderRadius: 8, paddingVertical: 12, alignItems: 'center' },
  iosConfirmText: { color: C.onPrimary, fontSize: 14, fontWeight: '700' },

  thumbOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  thumbEmoji: { fontSize: 80 },
});
