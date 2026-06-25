import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, Modal,
  TextInput, StyleSheet, Alert, KeyboardAvoidingView,
  Platform, StatusBar, Animated, ScrollView, PanResponder, Dimensions, Switch,
  LayoutAnimation, UIManager,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSQLiteContext } from 'expo-sqlite';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { LinearGradient } from 'expo-linear-gradient';
import * as Notifications from 'expo-notifications';
import { RootStackParamList } from '../../App';
import {
  Task, TaskFields, getToday, getTasks, addTask, updateTask, deleteTask,
  getCompletedTaskIds, markComplete, markIncomplete, updateTaskSortOrders,
} from '../db/database';
import {
  TASK_ICONS, PRIORITIES, priorityMeta, WEEKDAYS,
  FreqType, FREQ_TYPES, NTH_WEEKS, frequencyLabel, parseDays, nextNthWeekdayDate, isDueToday,
} from '../constants/taskMeta';
import { GRAD, GRAD_START, GRAD_END } from '../constants/theme';
import TabBar from '../components/TabBar';

const C = {
  header:    '#2563eb',
  body:      '#ffffff',
  card:      '#ffffff',
  border:    '#dbeafe',
  primary:   '#2563eb',
  onPrimary: '#ffffff',
  onDark:    '#2d3748',
  muted:     '#111827',
  stone:     '#111827',
  error:     '#e52020',
};

type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'Home'> };

const pad = (n: number) => String(n).padStart(2, '0');
const daysToCsv = (days: number[]) => days.slice().sort((a, b) => a - b).join(',');
const DRAG_ROW_HEIGHT = 88;

type FilterStatus = 'all' | 'incomplete' | 'done';
type FilterFreq = 'all' | 'daily' | 'other';
type FilterDue = 'all' | 'today';
type SortKey = 'manual' | 'priority' | 'time' | 'name';

const STATUS_OPTS: { k: FilterStatus; l: string }[] = [
  { k: 'all', l: 'すべて' }, { k: 'incomplete', l: '未完了' }, { k: 'done', l: '完了' },
];
const FREQ_OPTS: { k: FilterFreq; l: string }[] = [
  { k: 'all', l: 'すべて' }, { k: 'daily', l: '毎日' }, { k: 'other', l: 'その他' },
];
const DUE_OPTS: { k: FilterDue; l: string }[] = [
  { k: 'all', l: 'すべて' }, { k: 'today', l: '今日' },
];
const SORT_OPTS: { k: SortKey; l: string }[] = [
  { k: 'manual', l: '手動' }, { k: 'priority', l: '優先度' }, { k: 'time', l: '時刻' }, { k: 'name', l: '名前' },
];
const SWIPE_DELETE_THRESHOLD = 92;

// Minimal shape required to schedule a task's reminder.
type Schedulable = {
  title: string;
  icon: string | null;
  scheduled_time: string | null;
  notify: number;
  notify_id?: string | null;
  notify_type?: string;
  freq_type: FreqType;
  freq_days: string | null;
  freq_week: number | null;
  freq_weekday: number | null;
  freq_day: number | null;
  once_date?: string | null;
};

async function ensurePermission(): Promise<boolean> {
  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted') {
    Alert.alert('通知の許可が必要です', '端末の設定から通知を許可してください。');
    return false;
  }
  return true;
}

// Schedule reminders for a task according to its recurrence. Returns identifiers.
async function scheduleTaskNotifs(task: Schedulable): Promise<string[]> {
  if (!task.scheduled_time) return [];
  const [h, m] = task.scheduled_time.split(':').map(Number);
  const body = `${task.icon ? task.icon + ' ' : ''}${task.title} の時間です`;
  const isAlarm = task.notify_type === 'alarm';
  const content = {
    title: '毎日タスク', body,
    sound: isAlarm,
    android: { channelId: isAlarm ? 'full' : 'silent' },
  } as any;
  const ids: string[] = [];
  try {
    if (task.freq_type === 'daily') {
      ids.push(await Notifications.scheduleNotificationAsync({ content, trigger: { hour: h, minute: m, repeats: true } as any }));
    } else if (task.freq_type === 'weekly') {
      for (const d of parseDays(task.freq_days)) {
        ids.push(await Notifications.scheduleNotificationAsync({ content, trigger: { weekday: d + 1, hour: h, minute: m, repeats: true } as any }));
      }
    } else if (task.freq_type === 'monthly_day') {
      ids.push(await Notifications.scheduleNotificationAsync({ content, trigger: { day: task.freq_day ?? 1, hour: h, minute: m, repeats: true } as any }));
    } else if (task.freq_type === 'monthly_nth') {
      const when = nextNthWeekdayDate(task.freq_week ?? 1, task.freq_weekday ?? 0, h, m);
      ids.push(await Notifications.scheduleNotificationAsync({ content, trigger: { date: when } as any }));
    } else if (task.freq_type === 'once') {
      const when = task.once_date ? new Date(`${task.once_date}T${task.scheduled_time}:00`) : new Date();
      if (when.getTime() > Date.now()) {
        ids.push(await Notifications.scheduleNotificationAsync({ content, trigger: { date: when } as any }));
      }
    }
  } catch {
    // ignore scheduling failures (e.g. permission revoked); UI still works.
  }
  return ids;
}

async function cancelIds(csv: string | null | undefined): Promise<void> {
  if (!csv) return;
  for (const id of csv.split(',').filter(Boolean)) {
    try { await Notifications.cancelScheduledNotificationAsync(id); } catch {}
  }
}

// Cancel any existing reminders for a task and (re)schedule based on its state.
async function rescheduleTask(task: Schedulable): Promise<string | null> {
  await cancelIds(task.notify_id);
  if (!task.notify || !task.scheduled_time) return null;
  const ids = await scheduleTaskNotifs(task);
  return ids.length ? ids.join(',') : null;
}

export default function HomeScreen({ navigation }: Props) {
  const db = useSQLiteContext();
  const insets = useSafeAreaInsets();
  const screen = Dimensions.get('window');
  const [tasks, setTasks] = useState<Task[]>([]);
  const tasksRef = useRef<Task[]>([]);
  const [completedIds, setCompletedIds] = useState<Set<number>>(new Set());
  const [showThumb, setShowThumb] = useState(false);
  const thumbAnim = useRef(new Animated.Value(0)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;
  const fabPosition = useRef({ x: Math.max(screen.width - 72, 20), y: Math.max(screen.height - 150, 120) });
  const fabStartPosition = useRef(fabPosition.current);
  const fabAnim = useRef(new Animated.ValueXY(fabPosition.current)).current;
  const [activeDragId, setActiveDragId] = useState<number | null>(null);
  const dragState = useRef({ taskId: null as number | null, currentIndex: 0, anchorDy: 0, changed: false });
  const dragY = useRef(new Animated.Value(0)).current;
  const dragScale = useRef(new Animated.Value(1)).current;
  const swipeState = useRef({ taskId: null as number | null });
  const swipeAnim = useRef(new Animated.Value(0)).current;
  // Mirror of the actively-swiping card id, in state so the swipe transform
  // actually binds (a ref alone won't re-render to apply the animated styles).
  const [swipingId, setSwipingId] = useState<number | null>(null);
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [filterFreq, setFilterFreq] = useState<FilterFreq>('all');
  const [filterDue, setFilterDue] = useState<FilterDue>('all');
  const [sortKey, setSortKey] = useState<SortKey>('manual');
  const [activePanel, setActivePanel] = useState<'filter' | 'sort' | null>(null);
  const panelAnim = useRef(new Animated.Value(0)).current;
  const lastPanelRef = useRef<'filter' | 'sort'>('filter');
  if (activePanel) lastPanelRef.current = activePanel;
  const today = getToday();

  // Add task sheet draft
  const [showAdd, setShowAdd] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newIcon, setNewIcon] = useState<string | null>(null);
  const [newPriority, setNewPriority] = useState(-1);
  const [addPicker, setAddPicker] = useState<'icon' | 'priority' | null>(null);
  const [newTime, setNewTime] = useState<string | null>(null);
  const [newNotify, setNewNotify] = useState(false);
  const [newNotifyType, setNewNotifyType] = useState<'push' | 'alarm'>('push');
  const [newFreqType, setNewFreqType] = useState<FreqType>('daily');
  const [newDays, setNewDays] = useState<number[]>([]);
  const [newWeek, setNewWeek] = useState(1);
  const [newWeekday, setNewWeekday] = useState(1);
  const [newDay, setNewDay] = useState(1);

  // Task detail sheet
  const [detailTask, setDetailTask] = useState<Task | null>(null);
  const [detailTitle, setDetailTitle] = useState('');
  const [detailPicker, setDetailPicker] = useState<'icon' | 'priority' | null>(null);

  // Shared time editor (numeric input)
  const [timePickerFor, setTimePickerFor] = useState<'add' | 'edit' | null>(null);
  const [hourInput, setHourInput] = useState('8');
  const [minuteInput, setMinuteInput] = useState('00');

  const load = useCallback(async () => {
    const ts = await getTasks(db);
    const ids = await getCompletedTaskIds(db, today);
    setTasks(ts);
    setCompletedIds(new Set(ids));
  }, [db, today]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  useEffect(() => {
    if (Platform.OS === 'android') {
      UIManager.setLayoutAnimationEnabledExperimental?.(true);
    }
  }, []);

  // Keep monthly-nth reminders (which can't natively repeat) armed for the next occurrence.
  useFocusEffect(useCallback(() => {
    (async () => {
      const ts = await getTasks(db);
      for (const t of ts) {
        if (t.notify && t.scheduled_time && t.freq_type === 'monthly_nth') {
          const notify_id = await rescheduleTask(t);
          await updateTask(db, t.id, { notify_id });
        }
      }
    })();
  }, [db]));

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
    if (completedIds.has(id)) {
      await markIncomplete(db, id, today);
    } else {
      await markComplete(db, id, today);
      triggerCelebration();
    }
    load();
  };

  const resetAddDraft = () => {
    setNewTitle('');
    setNewIcon(null);
    setNewPriority(-1);
    setAddPicker(null);
    setNewTime(null);
    setNewNotify(false);
    setNewNotifyType('push');
    setNewFreqType('daily');
    setNewDays([]);
    setNewWeek(1);
    setNewWeekday(1);
    setNewDay(1);
  };

  const handleAdd = async () => {
    const title = newTitle.trim();
    if (!title) return;
    const taskId = await addTask(db, title);
    const fields: TaskFields = {
      icon: newIcon,
      priority: newPriority,
      scheduled_time: newTime,
      notify: newNotify ? 1 : 0,
      notify_type: newNotifyType,
      freq_type: newFreqType,
      freq_days: newFreqType === 'weekly' ? daysToCsv(newDays) : null,
      freq_week: newFreqType === 'monthly_nth' ? newWeek : null,
      freq_weekday: newFreqType === 'monthly_nth' ? newWeekday : null,
      freq_day: newFreqType === 'monthly_day' ? newDay : null,
      once_date: newFreqType === 'once' ? today : null,
    };
    await updateTask(db, taskId, fields);
    if (newNotify && newTime) {
      const notify_id = await rescheduleTask({
        title, icon: newIcon, scheduled_time: newTime, notify: 1, notify_id: null, notify_type: newNotifyType,
        freq_type: fields.freq_type!, freq_days: fields.freq_days ?? null,
        freq_week: fields.freq_week ?? null, freq_weekday: fields.freq_weekday ?? null, freq_day: fields.freq_day ?? null,
        once_date: fields.once_date ?? null,
      });
      await updateTask(db, taskId, { notify_id });
    }
    resetAddDraft();
    setShowAdd(false);
    load();
  };

  const closeAddSheet = () => {
    setShowAdd(false);
    resetAddDraft();
    setTimePickerFor(null);
  };

  const openDetail = (task: Task) => {
    setDetailTask(task);
    setDetailTitle(task.title);
    setDetailPicker(null);
  };

  const handleSaveTitle = async () => {
    if (!detailTask || !detailTitle.trim()) return;
    await updateTask(db, detailTask.id, { title: detailTitle.trim() });
    setDetailTask(t => t ? { ...t, title: detailTitle.trim() } : null);
    load();
  };

  // Persist a change to the open task; reschedule reminders when relevant.
  const patchDetail = async (patch: TaskFields) => {
    if (!detailTask) return;
    const merged = { ...detailTask, ...patch } as Task;
    await updateTask(db, detailTask.id, patch);
    const scheduleKeys: (keyof TaskFields)[] = ['scheduled_time', 'notify', 'notify_type', 'freq_type', 'freq_days', 'freq_week', 'freq_weekday', 'freq_day', 'once_date'];
    let next = merged;
    if (scheduleKeys.some(k => k in patch)) {
      const notify_id = await rescheduleTask(merged);
      await updateTask(db, detailTask.id, { notify_id });
      next = { ...merged, notify_id };
    }
    setDetailTask(next);
    load();
  };

  const handleDelete = (task: Task, onCancel?: () => void) => {
    Alert.alert('削除', `「${task.title}」を削除しますか？`, [
      { text: 'キャンセル', style: 'cancel', onPress: onCancel },
      {
        text: '削除', style: 'destructive',
        onPress: async () => {
          const identifiers = await deleteTask(db, task.id);
          await cancelIds(identifiers.join(','));
          if (detailTask?.id === task.id) setDetailTask(null);
          setSwipingId(null);
          load();
        },
      },
    ]);
  };

  const openTimeEditor = (target: 'add' | 'edit', current: string | null) => {
    if (current) {
      const [h, m] = current.split(':');
      setHourInput(String(Number(h)));
      setMinuteInput(m);
    } else {
      setHourInput('8');
      setMinuteInput('00');
    }
    setTimePickerFor(target);
  };

  const confirmTime = async () => {
    const h = Math.max(0, Math.min(23, parseInt(hourInput, 10) || 0));
    const m = Math.max(0, Math.min(59, parseInt(minuteInput, 10) || 0));
    const time = `${pad(h)}:${pad(m)}`;
    const target = timePickerFor;
    setTimePickerFor(null);
    if (target === 'add') setNewTime(time);
    else if (target === 'edit') await patchDetail({ scheduled_time: time });
  };

  const toggleNewNotify = async (value: boolean) => {
    if (value && !(await ensurePermission())) return;
    setNewNotify(value);
  };

  const toggleDetailNotify = async (value: boolean) => {
    if (value && !(await ensurePermission())) return;
    await patchDetail({ notify: value ? 1 : 0 });
  };

  const done = tasks.filter((t) => completedIds.has(t.id)).length;
  const total = tasks.length;
  const progress = total > 0 ? done / total : 0;
  // Gauge gradient color by completion ratio.
  const gaugeColors = (
    progress >= 1 ? ['#34d399', '#059669'] :
    progress >= 0.67 ? ['#4ade80', '#16a34a'] :
    progress >= 0.34 ? ['#facc15', '#f59e0b'] :
    ['#fb7185', '#e11d48']
  ) as readonly [string, string];
  const sortedTasks = [...tasks].sort((a, b) => {
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    return a.id - b.id;
  });

  // Drag reorder only makes sense in unfiltered manual order.
  const reorderEnabled = sortKey === 'manual' && filterStatus === 'all' && filterFreq === 'all' && filterDue === 'all';
  const displayedTasks = (() => {
    // Hide one-time tasks whose day has already passed.
    let list = sortedTasks.filter((t) => !(t.freq_type === 'once' && t.once_date && t.once_date < today));
    if (filterStatus === 'incomplete') list = list.filter((t) => !completedIds.has(t.id));
    else if (filterStatus === 'done') list = list.filter((t) => completedIds.has(t.id));
    if (filterFreq === 'daily') list = list.filter((t) => t.freq_type === 'daily');
    else if (filterFreq === 'other') list = list.filter((t) => t.freq_type !== 'daily');
    if (filterDue === 'today') list = list.filter((t) => isDueToday(t));
    if (sortKey === 'priority') {
      list = [...list].sort((a, b) => (b.priority - a.priority) || (a.sort_order - b.sort_order));
    } else if (sortKey === 'time') {
      list = [...list].sort((a, b) => {
        const at = a.scheduled_time ?? '99:99';
        const bt = b.scheduled_time ?? '99:99';
        return at < bt ? -1 : at > bt ? 1 : a.sort_order - b.sort_order;
      });
    } else if (sortKey === 'name') {
      list = [...list].sort((a, b) => a.title.localeCompare(b.title, 'ja'));
    }
    return list;
  })();

  const persistTaskOrder = async () => {
    const ordered = [...tasksRef.current].sort((a, b) => {
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
      return a.id - b.id;
    });
    await updateTaskSortOrders(db, ordered.map((task) => task.id));
    load();
  };

  const moveTask = (taskId: number, toIndex: number) => {
    setTasks((current) => {
      const ordered = [...current].sort((a, b) => {
        if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
        return a.id - b.id;
      });
      const fromIndex = ordered.findIndex((task) => task.id === taskId);
      if (fromIndex < 0) return current;
      const nextIndex = Math.max(0, Math.min(toIndex, ordered.length - 1));
      if (fromIndex === nextIndex) return current;
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      const [moved] = ordered.splice(fromIndex, 1);
      ordered.splice(nextIndex, 0, moved);
      dragState.current.changed = true;
      return ordered.map((task, index) => ({ ...task, sort_order: index }));
    });
  };

  const startDrag = (taskId: number, index: number) => {
    swipeState.current.taskId = null;
    setSwipingId(null);
    swipeAnim.setValue(0);
    setActiveDragId(taskId);
    dragState.current = { taskId, currentIndex: index, anchorDy: 0, changed: false };
    dragY.setValue(0);
    Animated.spring(dragScale, {
      toValue: 1.04,
      useNativeDriver: true,
      tension: 220,
      friction: 14,
    }).start();
  };

  const updateDrag = (dy: number) => {
    const { taskId, currentIndex, anchorDy } = dragState.current;
    if (taskId == null) return;
    const relativeDy = dy - anchorDy;
    dragY.setValue(Math.max(-DRAG_ROW_HEIGHT * 0.75, Math.min(DRAG_ROW_HEIGHT * 0.75, relativeDy)));
    const nextIndex = Math.max(0, Math.min(currentIndex + Math.round(relativeDy / DRAG_ROW_HEIGHT), tasksRef.current.length - 1));
    if (nextIndex !== currentIndex) {
      moveTask(taskId, nextIndex);
      dragState.current.currentIndex = nextIndex;
      dragState.current.anchorDy = dy;
      dragY.setValue(0);
    }
  };

  const endDrag = () => {
    if (dragState.current.changed) persistTaskOrder();
    dragState.current = { taskId: null, currentIndex: 0, anchorDy: 0, changed: false };
    setActiveDragId(null);
    Animated.parallel([
      Animated.spring(dragY, { toValue: 0, useNativeDriver: true, tension: 220, friction: 14 }),
      Animated.spring(dragScale, { toValue: 1, useNativeDriver: true, tension: 220, friction: 14 }),
    ]).start();
  };

  const resetSwipe = () => {
    swipeState.current.taskId = null;
    setSwipingId(null);
    Animated.spring(swipeAnim, { toValue: 0, useNativeDriver: true, tension: 180, friction: 12 }).start();
  };

  const confirmSwipeDelete = (task: Task, dx: number) => {
    const direction = dx < 0 ? -1 : 1;
    Animated.spring(swipeAnim, {
      toValue: direction * (screen.width + 80),
      speed: 22,
      bounciness: 0,
      useNativeDriver: true,
    }).start(() => {
      handleDelete(task, resetSwipe);
    });
  };

  const createTaskPanResponder = (task: Task, index: number) => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, gesture) => {
      if (dragState.current.taskId === task.id) return true;
      return Math.abs(gesture.dx) > 18 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.4;
    },
    onPanResponderGrant: () => {
      if (dragState.current.taskId !== task.id) {
        swipeState.current.taskId = task.id;
        setSwipingId(task.id);
        swipeAnim.setValue(0);
      }
    },
    onPanResponderMove: (_, gesture) => {
      if (dragState.current.taskId === task.id) {
        updateDrag(gesture.dy);
        return;
      }
      swipeAnim.setValue(Math.max(-220, Math.min(220, gesture.dx)));
    },
    onPanResponderRelease: (_, gesture) => {
      if (dragState.current.taskId === task.id) {
        endDrag();
        return;
      }
      if (Math.abs(gesture.dx) >= SWIPE_DELETE_THRESHOLD) {
        confirmSwipeDelete(task, gesture.dx);
      } else {
        resetSwipe();
      }
    },
    onPanResponderTerminate: () => {
      if (dragState.current.taskId === task.id) endDrag();
      resetSwipe();
    },
  });
  const clampFab = (x: number, y: number) => ({
    x: Math.max(8, Math.min(x, screen.width - 60)),
    y: Math.max(100, Math.min(y, screen.height - 130)),
  });
  const fabPanResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 4 || Math.abs(gesture.dy) > 4,
    onPanResponderGrant: () => { fabStartPosition.current = fabPosition.current; },
    onPanResponderMove: (_, gesture) => {
      const next = clampFab(fabStartPosition.current.x + gesture.dx, fabStartPosition.current.y + gesture.dy);
      fabAnim.setValue(next);
    },
    onPanResponderRelease: (_, gesture) => {
      const next = clampFab(fabStartPosition.current.x + gesture.dx, fabStartPosition.current.y + gesture.dy);
      fabPosition.current = next;
      fabAnim.setValue(next);
    },
    onPanResponderTerminate: () => { fabAnim.setValue(fabPosition.current); },
  })).current;

  useEffect(() => {
    Animated.timing(progressAnim, { toValue: progress, duration: 450, useNativeDriver: false }).start();
  }, [progress, progressAnim]);

  useEffect(() => {
    Animated.timing(panelAnim, { toValue: activePanel ? 1 : 0, duration: 200, useNativeDriver: true }).start();
  }, [activePanel, panelAnim]);

  const now = new Date();
  const dateLabel = `${now.getFullYear()}/${pad(now.getMonth() + 1)}/${pad(now.getDate())} (${WEEKDAYS[now.getDay()]})`;

  // ── Reusable editor sections ────────────────────────────────────────────

  const renderSchedule = (
    time: string | null,
    notify: boolean,
    onPick: () => void,
    onClear: () => void,
    onToggleNotify: (v: boolean) => void,
    notifyType: 'push' | 'alarm',
    onSetNotifyType: (t: 'push' | 'alarm') => void,
  ) => (
    <View style={s.scheduleCard}>
      <View style={s.scheduleRow}>
        <View style={s.scheduleLeft}>
          <Text style={s.scheduleLabel}>通知の時間</Text>
          <TouchableOpacity onPress={onPick}>
            <Text style={[s.scheduleTime, !time && s.scheduleTimeEmpty]}>{time ?? '未設定'}</Text>
          </TouchableOpacity>
        </View>
        <View style={s.scheduleRight}>
          <Text style={s.scheduleLabel}>通知する</Text>
          <Switch
            value={notify}
            onValueChange={onToggleNotify}
            trackColor={{ true: C.primary, false: C.border }}
            thumbColor="#ffffff"
          />
        </View>
      </View>
      {time && (
        <TouchableOpacity onPress={onClear} style={s.clearTimeBtn}>
          <Text style={s.clearTimeText}>時間をクリア</Text>
        </TouchableOpacity>
      )}
      {notify && !time && <Text style={s.scheduleHint}>※ 通知するには時間を設定してください</Text>}
      {notify && (
        <View style={s.notifyTypeRow}>
          <TouchableOpacity style={[s.notifyTypeChip, notifyType === 'push' && s.notifyTypeChipActive]} onPress={() => onSetNotifyType('push')}>
            <Text style={[s.notifyTypeText, notifyType === 'push' && s.notifyTypeTextActive]}>🔔 プッシュ通知</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.notifyTypeChip, notifyType === 'alarm' && s.notifyTypeChipActive]} onPress={() => onSetNotifyType('alarm')}>
            <Text style={[s.notifyTypeText, notifyType === 'alarm' && s.notifyTypeTextActive]}>⏰ アラーム音</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );

  const renderFrequency = (
    freqType: FreqType,
    days: number[],
    week: number,
    weekday: number,
    day: number,
    on: {
      setType: (t: FreqType) => void;
      toggleDay: (d: number) => void;
      setWeek: (w: number) => void;
      setWeekday: (d: number) => void;
      setDay: (d: number) => void;
    },
  ) => (
    <>
      <Text style={[s.sheetSection, { marginTop: 16 }]}>頻度</Text>
      <View style={s.freqTypeRow}>
        {FREQ_TYPES.map((ft) => (
          <TouchableOpacity
            key={ft.value}
            style={[s.freqTypeChip, freqType === ft.value && s.freqTypeChipActive]}
            onPress={() => on.setType(ft.value)}
          >
            <Text style={[s.freqTypeText, freqType === ft.value && s.freqTypeTextActive]}>{ft.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {freqType === 'weekly' && (
        <View style={s.weekdayRow}>
          {WEEKDAYS.map((w, i) => {
            const active = days.includes(i);
            return (
              <TouchableOpacity
                key={w}
                style={[s.dayChip, active && s.dayChipActive, i === 0 && s.daySun, i === 6 && s.daySat]}
                onPress={() => on.toggleDay(i)}
              >
                <Text style={[s.dayChipText, active && s.dayChipTextActive]}>{w}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {freqType === 'monthly_nth' && (
        <>
          <View style={s.weekChoiceRow}>
            {NTH_WEEKS.map((w) => (
              <TouchableOpacity
                key={w.value}
                style={[s.weekChip, week === w.value && s.weekChipActive]}
                onPress={() => on.setWeek(w.value)}
              >
                <Text style={[s.weekChipText, week === w.value && s.weekChipTextActive]}>{w.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={s.weekdayRow}>
            {WEEKDAYS.map((w, i) => {
              const active = weekday === i;
              return (
                <TouchableOpacity
                  key={w}
                  style={[s.dayChip, active && s.dayChipActive, i === 0 && s.daySun, i === 6 && s.daySat]}
                  onPress={() => on.setWeekday(i)}
                >
                  <Text style={[s.dayChipText, active && s.dayChipTextActive]}>{w}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </>
      )}

      {freqType === 'monthly_day' && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.monthDayRow}>
          {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
            <TouchableOpacity
              key={d}
              style={[s.monthDayChip, day === d && s.monthDayChipActive]}
              onPress={() => on.setDay(d)}
            >
              <Text style={[s.monthDayText, day === d && s.monthDayTextActive]}>{d}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </>
  );

  const renderIconPriority = (
    icon: string | null,
    priority: number,
    onIcon: (ic: string | null) => void,
    onPriority: (p: number) => void,
    openPicker: 'icon' | 'priority' | null,
    setOpenPicker: (picker: 'icon' | 'priority' | null) => void,
  ) => (
    <>
      <Text style={[s.sheetSection, { marginTop: 16 }]}>アイコン</Text>
      <TouchableOpacity
        style={s.metaSelectBtn}
        onPress={() => setOpenPicker(openPicker === 'icon' ? null : 'icon')}
        activeOpacity={0.8}
      >
        <View style={s.metaSelectLeft}>
          <Text style={[s.metaSelectIcon, !icon && s.metaSelectIconEmpty]}>{icon ?? '🏷'}</Text>
          <Text style={s.metaSelectText}>{icon ? 'アイコンを変更' : 'アイコンなし'}</Text>
        </View>
        <Text style={s.metaSelectArrow}>{openPicker === 'icon' ? '▲' : '▼'}</Text>
      </TouchableOpacity>
      {openPicker === 'icon' && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.iconRow}>
          <TouchableOpacity style={[s.iconChip, icon === null && s.iconChipActive]} onPress={() => { onIcon(null); setOpenPicker(null); }}>
            <Text style={s.iconNone}>なし</Text>
          </TouchableOpacity>
          {TASK_ICONS.map((ic) => (
            <TouchableOpacity key={ic} style={[s.iconChip, icon === ic && s.iconChipActive]} onPress={() => { onIcon(ic); setOpenPicker(null); }}>
              <Text style={s.iconEmoji}>{ic}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      <Text style={[s.sheetSection, { marginTop: 16 }]}>優先度</Text>
      <TouchableOpacity
        style={s.metaSelectBtn}
        onPress={() => setOpenPicker(openPicker === 'priority' ? null : 'priority')}
        activeOpacity={0.8}
      >
        <View style={s.metaSelectLeft}>
          <View style={[s.prioritySwatch, { backgroundColor: priorityMeta(priority).cardColor, borderColor: priorityMeta(priority).borderColor }]} />
          <Text style={s.metaSelectText}>優先度：{priorityMeta(priority).label}</Text>
        </View>
        <Text style={s.metaSelectArrow}>{openPicker === 'priority' ? '▲' : '▼'}</Text>
      </TouchableOpacity>
      {openPicker === 'priority' && (
        <View style={s.typeRow}>
          {PRIORITIES.map((p) => (
            <TouchableOpacity
              key={p.value}
              style={[s.typeChip, priority === p.value && { backgroundColor: p.color, borderColor: p.color }]}
              onPress={() => { onPriority(p.value); setOpenPicker(null); }}
            >
              <Text style={[s.typeChipText, priority === p.value && s.typeChipTextActive]}>{p.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </>
  );

  return (
    <View style={s.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      <LinearGradient colors={GRAD.header} start={GRAD_START} end={GRAD_END} style={[s.headerCard, { paddingTop: insets.top + 12 }]}>
        <Text style={s.dateText}>{dateLabel}</Text>
        <Text style={s.headerLabel}>今日の進捗</Text>
        <View style={s.progressRow}>
          <View style={s.progressBg}>
            <Animated.View
              style={[s.progressFill, { width: progressAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]}
            >
              <LinearGradient colors={gaugeColors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.progressGrad} />
            </Animated.View>
          </View>
          <Text style={s.progressText}>{done} / {total}</Text>
        </View>
      </LinearGradient>

      {/* fixed section bar with toggles */}
      <View style={s.sectionBar}>
        <Text style={s.metaLabel}>チェックリスト</Text>
        <View style={s.toggleRow}>
          <TouchableOpacity style={[s.filterToggle, activePanel === 'filter' && s.filterToggleActive]} onPress={() => setActivePanel((p) => (p === 'filter' ? null : 'filter'))}>
            <Text style={[s.filterToggleText, activePanel === 'filter' && s.filterToggleTextActive]}>絞り込み {activePanel === 'filter' ? '▲' : '▼'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.filterToggle, activePanel === 'sort' && s.filterToggleActive]} onPress={() => setActivePanel((p) => (p === 'sort' ? null : 'sort'))}>
            <Text style={[s.filterToggleText, activePanel === 'sort' && s.filterToggleTextActive]}>並び替え {activePanel === 'sort' ? '▲' : '▼'}</Text>
          </TouchableOpacity>
        </View>
        {total > 0 && <Text style={s.stone}>{displayedTasks.length}/{total}件</Text>}
      </View>

      <View style={s.listWrap}>
      <FlatList
        data={displayedTasks}
        keyExtractor={(item) => String(item.id)}
        style={s.list}
        contentContainerStyle={{ padding: 16, gap: 10 }}
        ListEmptyComponent={
          <View style={s.empty}>
            <Text style={s.emptyTitle}>{total > 0 ? '該当なし' : 'タスクなし'}</Text>
            <Text style={s.emptyBody}>{total > 0 ? '絞り込み条件を変えてみてください' : '右下の ＋ から追加できます'}</Text>
          </View>
        }
        renderItem={({ item, index }) => {
          const isDone = completedIds.has(item.id);
          const panResponder = createTaskPanResponder(item, index);
          const isDragging = activeDragId === item.id;
          const swipeStyle = swipingId === item.id
            ? {
                transform: [
                  { translateX: swipeAnim },
                  {
                    rotate: swipeAnim.interpolate({
                      inputRange: [-220, 0, 220],
                      outputRange: ['-5deg', '0deg', '5deg'],
                      extrapolate: 'clamp',
                    }),
                  },
                  {
                    scale: swipeAnim.interpolate({
                      inputRange: [-220, 0, 220],
                      outputRange: [0.96, 1, 0.96],
                      extrapolate: 'clamp',
                    }),
                  },
                ],
              }
            : null;
          const swipeBgStyle = swipingId === item.id
            ? {
                opacity: swipeAnim.interpolate({
                  inputRange: [-SWIPE_DELETE_THRESHOLD, 0, SWIPE_DELETE_THRESHOLD],
                  outputRange: [1, 0, 1],
                  extrapolate: 'clamp',
                }),
              }
            : { opacity: 0 };
          const dragStyle = isDragging
            ? {
                transform: [{ translateY: dragY }, { scale: dragScale }],
                zIndex: 30,
                elevation: 8,
                shadowOpacity: 0.18,
                shadowRadius: 10,
              }
            : null;
          const priority = priorityMeta(item.priority);
          return (
            <View style={s.swipeWrap}>
              <Animated.View style={[s.swipeDeleteBg, swipeBgStyle]}>
                <Text style={s.swipeDeleteText}>削除</Text>
              </Animated.View>
              <Animated.View
                style={[
                  s.taskCard,
                  { backgroundColor: priority.cardColor, borderColor: priority.borderColor },
                  isDone && s.taskCardDone,
                  swipeStyle,
                  dragStyle,
                ]}
                {...panResponder.panHandlers}
              >
              <TouchableOpacity
                style={[s.checkBox, isDone && s.checkBoxDone]}
                onPress={() => toggle(item.id)}
                hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
              >
                {isDone && <Text style={s.checkMark}>✓</Text>}
              </TouchableOpacity>
              <TouchableOpacity
                style={s.taskBody}
                onPress={() => openDetail(item)}
                onLongPress={reorderEnabled ? () => startDrag(item.id, index) : undefined}
                delayLongPress={250}
                activeOpacity={0.7}
              >
                <View style={s.taskTextWrap}>
                  <Text style={[s.taskTitle, isDone && s.taskTitleDone]} numberOfLines={2}>{item.title}</Text>
                  <View style={s.taskMetaRow}>
                    {item.scheduled_time && <Text style={s.scheduleTag}>{item.notify ? '🔔 ' : ''}{item.scheduled_time}</Text>}
                    <Text style={s.freqTag}>{frequencyLabel(item)}</Text>
                  </View>
                </View>
                {isDone && <View style={s.doneBadge}><Text style={s.doneBadgeText}>完了</Text></View>}
              </TouchableOpacity>
              <TouchableOpacity style={s.tagBtn} onPress={() => openDetail(item)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={[s.tagIcon, !item.icon && s.tagIconEmpty]}>{item.icon ?? '🏷'}</Text>
              </TouchableOpacity>
              </Animated.View>
            </View>
          );
        }}
        ListFooterComponent={<View style={{ height: 80 }} />}
      />

      {/* Slide-down filter / sort overlay (overlaps the list) */}
      <Animated.View
        pointerEvents={activePanel ? 'auto' : 'none'}
        style={[s.panelOverlay, {
          opacity: panelAnim,
          transform: [{ translateY: panelAnim.interpolate({ inputRange: [0, 1], outputRange: [-16, 0] }) }],
        }]}
      >
        {lastPanelRef.current === 'filter' ? (
          <View style={s.filterPanel}>
            <Text style={s.filterLabel}>状態</Text>
            <View style={s.filterRow}>
              {STATUS_OPTS.map((o) => (
                <TouchableOpacity key={o.k} style={[s.fChip, filterStatus === o.k && s.fChipActive]} onPress={() => setFilterStatus(o.k)}>
                  <Text style={[s.fChipText, filterStatus === o.k && s.fChipTextActive]}>{o.l}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={s.filterLabel}>頻度</Text>
            <View style={s.filterRow}>
              {FREQ_OPTS.map((o) => (
                <TouchableOpacity key={o.k} style={[s.fChip, filterFreq === o.k && s.fChipActive]} onPress={() => setFilterFreq(o.k)}>
                  <Text style={[s.fChipText, filterFreq === o.k && s.fChipTextActive]}>{o.l}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={s.filterLabel}>対象</Text>
            <View style={s.filterRow}>
              {DUE_OPTS.map((o) => (
                <TouchableOpacity key={o.k} style={[s.fChip, filterDue === o.k && s.fChipActive]} onPress={() => setFilterDue(o.k)}>
                  <Text style={[s.fChipText, filterDue === o.k && s.fChipTextActive]}>{o.l}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ) : (
          <View style={s.filterPanel}>
            <Text style={s.filterLabel}>並べ替え</Text>
            <View style={s.filterRow}>
              {SORT_OPTS.map((o) => (
                <TouchableOpacity key={o.k} style={[s.fChip, sortKey === o.k && s.fChipActive]} onPress={() => setSortKey(o.k)}>
                  <Text style={[s.fChipText, sortKey === o.k && s.fChipTextActive]}>{o.l}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {!reorderEnabled && <Text style={s.filterHint}>※ この表示中はドラッグでの並び替えはできません（「手動」かつ絞り込み「すべて」で可能）</Text>}
          </View>
        )}
      </Animated.View>
      </View>

      <TabBar current="Home" navigation={navigation} />

      <Animated.View style={[s.fabWrap, fabAnim.getLayout()]} {...fabPanResponder.panHandlers}>
        <TouchableOpacity onPress={() => setShowAdd(true)} activeOpacity={0.85}>
          <LinearGradient colors={GRAD.brand} start={GRAD_START} end={GRAD_END} style={s.fab}>
            <Text style={s.fabText}>＋</Text>
          </LinearGradient>
        </TouchableOpacity>
      </Animated.View>

      {showThumb && (
        <Animated.View style={[s.thumbOverlay, {
          opacity: thumbAnim,
          transform: [{ scale: thumbAnim.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }],
        }]} pointerEvents="none">
          <Text style={s.thumbEmoji}>👍</Text>
        </Animated.View>
      )}

      {/* Add task bottom sheet */}
      <Modal visible={showAdd} transparent animationType="slide" onRequestClose={closeAddSheet}>
        <TouchableOpacity style={s.sheetBg} activeOpacity={1} onPress={closeAddSheet}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <TouchableOpacity activeOpacity={1} onPress={() => {}}>
              <View style={[s.sheet, { maxHeight: screen.height * 0.85 }]}>
                <View style={s.sheetHandle} />
                <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}>

                  {/* Task name (top) */}
                  <Text style={s.sheetSection}>タスク名</Text>
                  <View style={s.sheetTitleRow}>
                    <TextInput
                      style={s.sheetTitleInput}
                      value={newTitle}
                      onChangeText={setNewTitle}
                      placeholder="例：歯磨き、運動、水を飲む"
                      placeholderTextColor={C.muted}
                      returnKeyType="done"
                      onSubmitEditing={handleAdd}
                    />
                    <TouchableOpacity onPress={handleAdd} disabled={!newTitle.trim()} activeOpacity={0.85}>
                      <LinearGradient
                        colors={!newTitle.trim() ? [C.border, C.border] : GRAD.brand}
                        start={GRAD_START} end={GRAD_END} style={s.sheetSaveBtn}
                      >
                        <Text style={s.sheetSaveBtnText}>追加</Text>
                      </LinearGradient>
                    </TouchableOpacity>
                  </View>

                  {/* Notification time + notify (second) */}
                  <Text style={[s.sheetSection, { marginTop: 16 }]}>通知</Text>
                  {renderSchedule(
                    newTime,
                    newNotify,
                    () => openTimeEditor('add', newTime),
                    () => setNewTime(null),
                    toggleNewNotify,
                    newNotifyType,
                    setNewNotifyType,
                  )}

                  {renderIconPriority(newIcon, newPriority, setNewIcon, setNewPriority, addPicker, setAddPicker)}

                  {renderFrequency(newFreqType, newDays, newWeek, newWeekday, newDay, {
                    setType: (t) => {
                      setNewFreqType(t);
                      if (t === 'weekly' && newDays.length === 0) setNewDays([new Date().getDay()]);
                    },
                    toggleDay: (d) => setNewDays((ds) => ds.includes(d) ? ds.filter((x) => x !== d) : [...ds, d]),
                    setWeek: setNewWeek,
                    setWeekday: setNewWeekday,
                    setDay: setNewDay,
                  })}

                  <View style={{ height: 12 }} />
                </ScrollView>
              </View>
            </TouchableOpacity>
          </KeyboardAvoidingView>
        </TouchableOpacity>
      </Modal>

      {/* Task detail bottom sheet */}
      <Modal visible={!!detailTask} transparent animationType="slide" onRequestClose={() => setDetailTask(null)}>
        <TouchableOpacity style={s.sheetBg} activeOpacity={1} onPress={() => setDetailTask(null)}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <TouchableOpacity activeOpacity={1} onPress={() => {}}>
              <View style={[s.sheet, { maxHeight: screen.height * 0.85 }]}>
                <View style={s.sheetHandle} />
                <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}>
                  {detailTask && (
                    <>
                      {/* Task name (top) */}
                      <Text style={s.sheetSection}>タスク名</Text>
                      <View style={s.sheetTitleRow}>
                        <TextInput
                          style={s.sheetTitleInput}
                          value={detailTitle}
                          onChangeText={setDetailTitle}
                          returnKeyType="done"
                          onSubmitEditing={handleSaveTitle}
                        />
                        <TouchableOpacity onPress={handleSaveTitle} disabled={detailTitle === detailTask.title} activeOpacity={0.85}>
                          <LinearGradient
                            colors={detailTitle === detailTask.title ? [C.border, C.border] : GRAD.brand}
                            start={GRAD_START} end={GRAD_END} style={s.sheetSaveBtn}
                          >
                            <Text style={s.sheetSaveBtnText}>保存</Text>
                          </LinearGradient>
                        </TouchableOpacity>
                      </View>

                      {/* Notification time + notify (second) */}
                      <Text style={[s.sheetSection, { marginTop: 16 }]}>通知</Text>
                      {renderSchedule(
                        detailTask.scheduled_time,
                        !!detailTask.notify,
                        () => openTimeEditor('edit', detailTask.scheduled_time),
                        () => patchDetail({ scheduled_time: null }),
                        toggleDetailNotify,
                        (detailTask.notify_type === 'alarm' ? 'alarm' : 'push'),
                        (t) => patchDetail({ notify_type: t }),
                      )}

                      {renderIconPriority(
                        detailTask.icon,
                        detailTask.priority,
                        (ic) => patchDetail({ icon: ic }),
                        (p) => patchDetail({ priority: p }),
                        detailPicker,
                        setDetailPicker,
                      )}

                      {renderFrequency(
                        detailTask.freq_type,
                        parseDays(detailTask.freq_days),
                        detailTask.freq_week ?? 1,
                        detailTask.freq_weekday ?? 1,
                        detailTask.freq_day ?? 1,
                        {
                          setType: (t) => {
                            const patch: TaskFields = { freq_type: t };
                            if (t === 'weekly') patch.freq_days = daysToCsv(parseDays(detailTask.freq_days).length ? parseDays(detailTask.freq_days) : [new Date().getDay()]);
                            if (t === 'monthly_nth') { patch.freq_week = detailTask.freq_week ?? 1; patch.freq_weekday = detailTask.freq_weekday ?? 1; }
                            if (t === 'monthly_day') patch.freq_day = detailTask.freq_day ?? 1;
                            if (t === 'once') patch.once_date = detailTask.once_date ?? today;
                            patchDetail(patch);
                          },
                          toggleDay: (d) => {
                            const cur = parseDays(detailTask.freq_days);
                            const next = cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d];
                            patchDetail({ freq_days: daysToCsv(next) });
                          },
                          setWeek: (w) => patchDetail({ freq_week: w }),
                          setWeekday: (d) => patchDetail({ freq_weekday: d }),
                          setDay: (d) => patchDetail({ freq_day: d }),
                        },
                      )}

                      <View style={{ height: 12 }} />
                    </>
                  )}
                </ScrollView>
              </View>
            </TouchableOpacity>
          </KeyboardAvoidingView>
        </TouchableOpacity>
      </Modal>

      {/* Shared time editor (numeric) */}
      <Modal visible={!!timePickerFor} transparent animationType="fade" onRequestClose={() => setTimePickerFor(null)}>
        <View style={s.timeModalBg}>
          <View style={s.timeModalCard}>
            <Text style={s.timeModalTitle}>時間を入力</Text>
            <View style={s.timeInputRow}>
              <TextInput
                style={s.timeInput}
                value={hourInput}
                onChangeText={setHourInput}
                keyboardType="number-pad"
                maxLength={2}
                selectTextOnFocus
                placeholder="8"
                placeholderTextColor={C.muted}
              />
              <Text style={s.timeColon}>:</Text>
              <TextInput
                style={s.timeInput}
                value={minuteInput}
                onChangeText={setMinuteInput}
                keyboardType="number-pad"
                maxLength={2}
                selectTextOnFocus
                placeholder="00"
                placeholderTextColor={C.muted}
              />
            </View>
            <Text style={s.timeHint}>24時間制（時 0〜23 ／ 分 0〜59）</Text>
            <View style={s.timeBtnRow}>
              <TouchableOpacity style={s.timeCancelBtn} onPress={() => setTimePickerFor(null)}>
                <Text style={s.timeCancelText}>キャンセル</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.timeConfirmBtnWrap} onPress={confirmTime} activeOpacity={0.85}>
                <LinearGradient colors={GRAD.brand} start={GRAD_START} end={GRAD_END} style={s.timeConfirmBtn}>
                  <Text style={s.timeConfirmText}>決定</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: C.body },

  headerCard: { backgroundColor: C.header, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 24 },
  dateText: { color: '#ffffff', fontSize: 22, fontWeight: '800', marginBottom: 12 },
  headerLabel: { color: 'rgba(255,255,255,0.6)', fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 },
  progressBg: { flex: 1, height: 4, backgroundColor: 'rgba(255,255,255,0.45)', borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 2, overflow: 'hidden' },
  progressGrad: { flex: 1 },
  progressText: { color: '#ffffff', fontSize: 11, fontWeight: '700' },

  list: { flex: 1, backgroundColor: C.body },
  listWrap: { flex: 1, position: 'relative' },
  panelOverlay: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 16, paddingTop: 8, zIndex: 20 },
  listHeader: { marginBottom: 4 },
  sectionBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  metaLabel: { color: C.muted, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  stone: { color: C.stone, fontSize: 11, fontWeight: '700' },
  toggleRow: { flexDirection: 'row', gap: 6, flexShrink: 1 },
  filterToggle: { backgroundColor: '#eff6ff', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 5 },
  filterToggleActive: { backgroundColor: C.primary },
  filterToggleText: { color: C.primary, fontSize: 11, fontWeight: '800' },
  filterToggleTextActive: { color: C.onPrimary },
  filterPanel: { backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 12, marginTop: 8, gap: 6, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 10, elevation: 8 },
  filterLabel: { color: C.muted, fontSize: 10, fontWeight: '800', letterSpacing: 0.5, marginTop: 2 },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  fChip: { borderWidth: 1, borderColor: C.border, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 5 },
  fChipActive: { backgroundColor: C.primary, borderColor: C.primary },
  fChipText: { color: C.onDark, fontSize: 12, fontWeight: '700' },
  fChipTextActive: { color: C.onPrimary },
  filterHint: { color: C.muted, fontSize: 10, fontWeight: '600', marginTop: 4 },

  swipeWrap: { borderRadius: 12 },
  swipeDeleteBg: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    borderRadius: 12,
    backgroundColor: '#1f2937',
    alignItems: 'center',
    justifyContent: 'center',
  },
  swipeDeleteText: { color: '#ffffff', fontSize: 14, fontWeight: '800', letterSpacing: 1 },
  taskCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 14, gap: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2,
  },
  taskCardDone: { opacity: 0.6 },
  checkBox: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  checkBoxDone: { backgroundColor: C.primary, borderColor: C.primary },
  checkMark: { color: C.onPrimary, fontSize: 11, fontWeight: '700' },
  taskBody: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  taskTextWrap: { flex: 1, gap: 4 },
  taskTitle: { color: C.onDark, fontSize: 14, fontWeight: '500', lineHeight: 20 },
  taskTitleDone: { color: C.muted, textDecorationLine: 'line-through' },
  taskMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  priorityBadge: { borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1 },
  priorityBadgeText: { color: C.onPrimary, fontSize: 9, fontWeight: '800' },
  scheduleTag: { color: C.stone, fontSize: 10, fontWeight: '700' },
  freqTag: { color: C.muted, fontSize: 10, fontWeight: '700' },
  doneBadge: { backgroundColor: '#fef3c7', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  doneBadgeText: { color: '#b45309', fontSize: 9, fontWeight: '700', letterSpacing: 0.5 },
  tagBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#f3f4f6', alignItems: 'center', justifyContent: 'center' },
  tagIcon: { fontSize: 17 },
  tagIconEmpty: { opacity: 0.35 },

  empty: { paddingVertical: 60, alignItems: 'center', gap: 8 },
  emptyTitle: { color: C.stone, fontSize: 16, fontWeight: '700' },
  emptyBody: { color: C.muted, fontSize: 13 },

  fabWrap: { position: 'absolute', zIndex: 20 },
  fab: { width: 52, height: 52, borderRadius: 26, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center', elevation: 6, shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.25, shadowRadius: 6 },
  fabText: { color: C.onPrimary, fontSize: 26, fontWeight: '400', lineHeight: 30 },

  sheetBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: C.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingTop: 12, gap: 8, maxHeight: '88%' },
  sheetHandle: { width: 40, height: 4, backgroundColor: C.border, borderRadius: 2, alignSelf: 'center', marginBottom: 12 },
  sheetSection: { color: C.muted, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  sheetTitleRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  sheetTitleInput: { flex: 1, borderWidth: 1, borderColor: C.border, borderRadius: 10, padding: 12, fontSize: 15, color: C.onDark, backgroundColor: C.body },
  sheetSaveBtn: { backgroundColor: C.primary, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
  sheetSaveBtnDisabled: { backgroundColor: C.border },
  sheetSaveBtnText: { color: C.onPrimary, fontSize: 13, fontWeight: '700' },

  // Schedule (time + notify)
  scheduleCard: { backgroundColor: '#eff6ff', borderRadius: 14, padding: 14, gap: 8 },
  scheduleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  scheduleLeft: { gap: 2 },
  scheduleRight: { alignItems: 'center', gap: 2 },
  scheduleLabel: { color: C.stone, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  scheduleTime: { color: C.onDark, fontSize: 30, fontWeight: '800' },
  scheduleTimeEmpty: { color: C.muted, fontSize: 20, fontWeight: '700' },
  clearTimeBtn: { alignSelf: 'flex-start' },
  clearTimeText: { color: C.muted, fontSize: 11, fontWeight: '700' },
  scheduleHint: { color: C.error, fontSize: 11, fontWeight: '600' },
  notifyTypeRow: { flexDirection: 'row', gap: 8, marginTop: 2 },
  notifyTypeChip: { flex: 1, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingVertical: 8, alignItems: 'center', backgroundColor: '#ffffff' },
  notifyTypeChipActive: { backgroundColor: C.primary, borderColor: C.primary },
  notifyTypeText: { color: C.onDark, fontSize: 12, fontWeight: '700' },
  notifyTypeTextActive: { color: C.onPrimary },

  // Icon
  metaSelectBtn: { borderWidth: 1, borderColor: C.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11, backgroundColor: '#ffffff', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  metaSelectLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  metaSelectIcon: { width: 28, textAlign: 'center', fontSize: 20 },
  metaSelectIconEmpty: { opacity: 0.35 },
  metaSelectText: { color: C.onDark, fontSize: 13, fontWeight: '700' },
  metaSelectArrow: { color: C.muted, fontSize: 11, fontWeight: '800' },
  prioritySwatch: { width: 28, height: 20, borderRadius: 7, borderWidth: 1 },
  iconRow: { gap: 8, paddingVertical: 2 },
  iconChip: { width: 44, height: 44, borderRadius: 12, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  iconChipActive: { backgroundColor: '#eff6ff', borderColor: C.primary },
  iconEmoji: { fontSize: 22 },
  iconNone: { color: C.muted, fontSize: 11, fontWeight: '700' },

  // Priority / generic chips
  typeRow: { flexDirection: 'row', gap: 8 },
  typeChip: { flex: 1, borderWidth: 1, borderColor: C.border, borderRadius: 20, paddingVertical: 8, alignItems: 'center' },
  typeChipText: { color: C.muted, fontSize: 12, fontWeight: '700' },
  typeChipTextActive: { color: C.onPrimary },

  // Frequency
  freqTypeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  freqTypeChip: { borderWidth: 1, borderColor: C.border, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8 },
  freqTypeChipActive: { backgroundColor: C.primary, borderColor: C.primary },
  freqTypeText: { color: C.muted, fontSize: 12, fontWeight: '700' },
  freqTypeTextActive: { color: C.onPrimary },
  weekdayRow: { flexDirection: 'row', gap: 6, marginTop: 8 },
  dayChip: { flex: 1, height: 38, borderRadius: 10, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  dayChipActive: { backgroundColor: C.primary, borderColor: C.primary },
  dayChipText: { color: C.onDark, fontSize: 13, fontWeight: '700' },
  dayChipTextActive: { color: C.onPrimary },
  daySun: { },
  daySat: { },
  weekChoiceRow: { flexDirection: 'row', gap: 6, marginTop: 8 },
  weekChip: { flex: 1, borderRadius: 10, borderWidth: 1, borderColor: C.border, paddingVertical: 8, alignItems: 'center' },
  weekChipActive: { backgroundColor: C.primary, borderColor: C.primary },
  weekChipText: { color: C.onDark, fontSize: 12, fontWeight: '700' },
  weekChipTextActive: { color: C.onPrimary },
  monthDayRow: { gap: 6, paddingVertical: 8 },
  monthDayChip: { width: 40, height: 40, borderRadius: 10, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  monthDayChipActive: { backgroundColor: C.primary, borderColor: C.primary },
  monthDayText: { color: C.onDark, fontSize: 13, fontWeight: '700' },
  monthDayTextActive: { color: C.onPrimary },

  timeModalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', padding: 32 },
  timeModalCard: { width: '100%', backgroundColor: C.card, borderRadius: 18, padding: 20, gap: 12, alignItems: 'center' },
  timeModalTitle: { color: C.onDark, fontSize: 15, fontWeight: '800' },
  timeInputRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  timeInput: { width: 76, borderWidth: 1, borderColor: C.border, borderRadius: 12, paddingVertical: 10, fontSize: 30, fontWeight: '800', color: C.onDark, textAlign: 'center', backgroundColor: C.body },
  timeColon: { fontSize: 30, fontWeight: '800', color: C.onDark },
  timeHint: { color: C.muted, fontSize: 11, fontWeight: '600' },
  timeBtnRow: { flexDirection: 'row', gap: 10, alignSelf: 'stretch', marginTop: 4 },
  timeCancelBtn: { flex: 1, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  timeCancelText: { color: C.stone, fontSize: 14, fontWeight: '700' },
  timeConfirmBtnWrap: { flex: 1 },
  timeConfirmBtn: { borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  timeConfirmText: { color: C.onPrimary, fontSize: 14, fontWeight: '700' },

  thumbOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  thumbEmoji: { fontSize: 80 },
});
