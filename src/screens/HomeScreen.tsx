import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, Modal,
  TextInput, StyleSheet, Alert, KeyboardAvoidingView,
  Platform, StatusBar, Animated, ScrollView, PanResponder, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSQLiteContext } from 'expo-sqlite';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Notifications from 'expo-notifications';
import { RootStackParamList } from '../../App';
import {
  Task, TaskFields, getToday, getTasks, addTask, updateTask, deleteTask,
  getCompletedTaskIds, markComplete, markIncomplete,
  NotificationSetting, getNotificationSettingsForTask,
  addNotificationSetting, deleteNotificationSetting,
} from '../db/database';
import { TASK_ICONS, PRIORITIES, priorityMeta, FREQUENCIES } from '../constants/taskMeta';
import TabBar from '../components/TabBar';

const C = {
  header:    '#60a5fa',
  body:      '#ffffff',
  card:      '#ffffff',
  border:    '#dbeafe',
  primary:   '#60a5fa',
  onPrimary: '#ffffff',
  onDark:    '#2d3748',
  muted:     '#93c5fd',
  stone:     '#3b82f6',
  error:     '#e52020',
};

type NotifType = 'full' | 'silent';
type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'Home'> };

async function scheduleNotif(time: string, type: NotifType): Promise<string | null> {
  const [h, m] = time.split(':').map(Number);
  try {
    return await Notifications.scheduleNotificationAsync({
      content: ({
        title: '毎日タスク',
        body: '今日のタスクを確認しましょう！',
        sound: type === 'full',
        android: { channelId: type === 'full' ? 'full' : 'silent' } as any,
      } as any),
      trigger: { hour: h, minute: m, repeats: true } as any,
    });
  } catch { return null; }
}

export default function HomeScreen({ navigation }: Props) {
  const db = useSQLiteContext();
  const screen = Dimensions.get('window');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [completedIds, setCompletedIds] = useState<Set<number>>(new Set());
  const [showAdd, setShowAdd] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newIcon, setNewIcon] = useState<string | null>(null);
  const [newPriority, setNewPriority] = useState(1);
  const [newFrequency, setNewFrequency] = useState<string>('毎日');
  const [addNotifs, setAddNotifs] = useState<{ time: string; type: NotifType }[]>([]);
  const [showAddTimePicker, setShowAddTimePicker] = useState(false);
  const [addPickerTime, setAddPickerTime] = useState(new Date());
  const [showThumb, setShowThumb] = useState(false);
  const thumbAnim = useRef(new Animated.Value(0)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;
  const fabPosition = useRef({ x: Math.max(screen.width - 72, 20), y: Math.max(screen.height - 150, 120) });
  const fabStartPosition = useRef(fabPosition.current);
  const fabAnim = useRef(new Animated.ValueXY(fabPosition.current)).current;
  const today = getToday();

  // Task detail sheet
  const [detailTask, setDetailTask] = useState<Task | null>(null);
  const [detailTitle, setDetailTitle] = useState('');
  const [taskNotifs, setTaskNotifs] = useState<NotificationSetting[]>([]);
  const [notifType, setNotifType] = useState<NotifType>('full');
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [pickerTime, setPickerTime] = useState(new Date());

  const load = useCallback(async () => {
    const ts = await getTasks(db);
    const ids = await getCompletedTaskIds(db, today);
    setTasks(ts);
    setCompletedIds(new Set(ids));
  }, [db, today]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

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

  const handleAdd = async () => {
    const title = newTitle.trim();
    if (!title) return;
    const taskId = await addTask(db, title, { icon: newIcon, priority: newPriority, frequency: newFrequency });
    if (addNotifs.length > 0) {
      const { status } = await Notifications.requestPermissionsAsync();
      if (status === 'granted') {
        for (const item of addNotifs) {
          const identifier = await scheduleNotif(item.time, item.type);
          await addNotificationSetting(db, item.time, item.type, identifier, taskId);
        }
      }
    }
    setNewTitle('');
    setNewIcon(null);
    setNewPriority(1);
    setNewFrequency('毎日');
    setAddNotifs([]);
    setShowAdd(false);
    load();
  };

  const closeAddSheet = () => {
    setShowAdd(false);
    setNewTitle('');
    setNewIcon(null);
    setNewPriority(1);
    setNewFrequency('毎日');
    setAddNotifs([]);
    setShowAddTimePicker(false);
  };

  const handleAddNotifToNewTask = (date: Date) => {
    setShowAddTimePicker(false);
    const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    setAddNotifs((items) => [...items, { time, type: notifType }]);
  };

  const openDetail = async (task: Task) => {
    const notifs = await getNotificationSettingsForTask(db, task.id);
    setDetailTask(task);
    setDetailTitle(task.title);
    setTaskNotifs(notifs);
  };

  const handleSaveTitle = async () => {
    if (!detailTask || !detailTitle.trim()) return;
    await updateTask(db, detailTask.id, { title: detailTitle.trim() });
    setDetailTask(t => t ? { ...t, title: detailTitle.trim() } : null);
    load();
  };

  const updateDetailMeta = async (fields: TaskFields) => {
    if (!detailTask) return;
    await updateTask(db, detailTask.id, fields);
    setDetailTask(t => t ? { ...t, ...fields } : null);
    load();
  };

  const handleAddNotif = async (date: Date) => {
    setShowTimePicker(false);
    if (!detailTask) return;
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('通知の許可が必要です', '設定から通知を許可してください。');
      return;
    }
    const h = date.getHours();
    const m = date.getMinutes();
    const time = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    const identifier = await scheduleNotif(time, notifType);
    await addNotificationSetting(db, time, notifType, identifier, detailTask.id);
    const notifs = await getNotificationSettingsForTask(db, detailTask.id);
    setTaskNotifs(notifs);
  };

  const handleDeleteNotif = async (notif: NotificationSetting) => {
    const id = await deleteNotificationSetting(db, notif.id);
    if (id) await Notifications.cancelScheduledNotificationAsync(id);
    if (detailTask) {
      const notifs = await getNotificationSettingsForTask(db, detailTask.id);
      setTaskNotifs(notifs);
    }
  };

  const handleDelete = (task: Task) => {
    Alert.alert('削除', `「${task.title}」を削除しますか？`, [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: '削除', style: 'destructive',
        onPress: async () => {
          const identifiers = await deleteTask(db, task.id);
          for (const id of identifiers) await Notifications.cancelScheduledNotificationAsync(id);
          if (detailTask?.id === task.id) setDetailTask(null);
          load();
        },
      },
    ]);
  };

  const done = tasks.filter((t) => completedIds.has(t.id)).length;
  const total = tasks.length;
  const progress = total > 0 ? done / total : 0;
  const sortedTasks = [...tasks].sort((a, b) => {
    const aDone = completedIds.has(a.id) ? 1 : 0;
    const bDone = completedIds.has(b.id) ? 1 : 0;
    if (aDone !== bDone) return bDone - aDone;
    if (a.priority !== b.priority) return b.priority - a.priority;
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    return a.id - b.id;
  });
  const clampFab = (x: number, y: number) => ({
    x: Math.max(8, Math.min(x, screen.width - 60)),
    y: Math.max(100, Math.min(y, screen.height - 130)),
  });
  const fabPanResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 4 || Math.abs(gesture.dy) > 4,
    onPanResponderGrant: () => {
      fabStartPosition.current = fabPosition.current;
    },
    onPanResponderMove: (_, gesture) => {
      const next = clampFab(fabStartPosition.current.x + gesture.dx, fabStartPosition.current.y + gesture.dy);
      fabAnim.setValue(next);
    },
    onPanResponderRelease: (_, gesture) => {
      const next = clampFab(fabStartPosition.current.x + gesture.dx, fabStartPosition.current.y + gesture.dy);
      fabPosition.current = next;
      fabAnim.setValue(next);
    },
    onPanResponderTerminate: () => {
      fabAnim.setValue(fabPosition.current);
    },
  })).current;

  useEffect(() => {
    Animated.timing(progressAnim, {
      toValue: progress,
      duration: 450,
      useNativeDriver: false,
    }).start();
  }, [progress, progressAnim]);

  const now = new Date();
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  const dateLabel = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')} (${weekdays[now.getDay()]})`;

  return (
    <SafeAreaView style={s.safeArea} edges={['top', 'bottom']}>
      <StatusBar barStyle="light-content" backgroundColor={C.header} />

      <View style={s.headerCard}>
        <Text style={s.dateText}>{dateLabel}</Text>
        <Text style={s.headerLabel}>今日の進捗</Text>
        <View style={s.progressRow}>
          <View style={s.progressBg}>
            <Animated.View
              style={[
                s.progressFill,
                { width: progressAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) },
              ]}
            />
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
          const isDone = completedIds.has(item.id);
          return (
            <View style={[s.taskCard, isDone && s.taskCardDone]}>
              <TouchableOpacity
                style={[s.checkBox, isDone && s.checkBoxDone]}
                onPress={() => toggle(item.id)}
                hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
              >
                {isDone && <Text style={s.checkMark}>✓</Text>}
              </TouchableOpacity>
              <TouchableOpacity style={s.taskBody} onPress={() => openDetail(item)} activeOpacity={0.7}>
                {item.icon && <Text style={s.taskIcon}>{item.icon}</Text>}
                <View style={s.taskTextWrap}>
                  <Text style={[s.taskTitle, isDone && s.taskTitleDone]} numberOfLines={2}>
                    {item.title}
                  </Text>
                  <View style={s.taskMetaRow}>
                    <View style={[s.priorityBadge, { backgroundColor: priorityMeta(item.priority).color }]}>
                      <Text style={s.priorityBadgeText}>{priorityMeta(item.priority).label}</Text>
                    </View>
                    {item.frequency !== '毎日' && <Text style={s.freqTag}>{item.frequency}</Text>}
                  </View>
                </View>
                {isDone && <View style={s.doneBadge}><Text style={s.doneBadgeText}>完了</Text></View>}
              </TouchableOpacity>
              <TouchableOpacity style={s.deleteBtn} onPress={() => handleDelete(item)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={s.deleteBtnText}>🗑️</Text>
              </TouchableOpacity>
            </View>
          );
        }}
        ListFooterComponent={<View style={{ height: 80 }} />}
      />

      <TabBar current="Home" navigation={navigation} />

      <Animated.View style={[s.fabWrap, fabAnim.getLayout()]} {...fabPanResponder.panHandlers}>
        <TouchableOpacity
          style={s.fab}
          onPress={() => setShowAdd(true)}
          activeOpacity={0.85}
        >
          <Text style={s.fabText}>＋</Text>
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
              <View style={s.sheet}>
                <View style={s.sheetHandle} />
                <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                <Text style={s.sheetSection}>タスク名</Text>
                <View style={s.sheetTitleRow}>
                  <TextInput
                    style={s.sheetTitleInput}
                    value={newTitle}
                    onChangeText={setNewTitle}
                    placeholder="例：歯磨き、運動、水を飲む"
                    placeholderTextColor={C.muted}
                    autoFocus
                    returnKeyType="done"
                    onSubmitEditing={handleAdd}
                  />
                  <TouchableOpacity
                    style={[s.sheetSaveBtn, !newTitle.trim() && s.sheetSaveBtnDisabled]}
                    onPress={handleAdd}
                    disabled={!newTitle.trim()}
                  >
                    <Text style={s.sheetSaveBtnText}>追加</Text>
                  </TouchableOpacity>
                </View>

                <Text style={[s.sheetSection, { marginTop: 16 }]}>アイコン</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.iconRow}>
                  <TouchableOpacity
                    style={[s.iconChip, newIcon === null && s.iconChipActive]}
                    onPress={() => setNewIcon(null)}
                  >
                    <Text style={s.iconNone}>なし</Text>
                  </TouchableOpacity>
                  {TASK_ICONS.map((ic) => (
                    <TouchableOpacity
                      key={ic}
                      style={[s.iconChip, newIcon === ic && s.iconChipActive]}
                      onPress={() => setNewIcon(ic)}
                    >
                      <Text style={s.iconEmoji}>{ic}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                <Text style={[s.sheetSection, { marginTop: 16 }]}>優先度</Text>
                <View style={s.typeRow}>
                  {PRIORITIES.map((p) => (
                    <TouchableOpacity
                      key={p.value}
                      style={[s.typeChip, newPriority === p.value && { backgroundColor: p.color, borderColor: p.color }]}
                      onPress={() => setNewPriority(p.value)}
                    >
                      <Text style={[s.typeChipText, newPriority === p.value && s.typeChipTextActive]}>{p.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={[s.sheetSection, { marginTop: 16 }]}>頻度</Text>
                <View style={s.typeRow}>
                  {FREQUENCIES.map((f) => (
                    <TouchableOpacity
                      key={f}
                      style={[s.typeChip, newFrequency === f && s.typeChipActive]}
                      onPress={() => setNewFrequency(f)}
                    >
                      <Text style={[s.typeChipText, newFrequency === f && s.typeChipTextActive]}>{f}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={[s.sheetSection, { marginTop: 16 }]}>通知</Text>
                <View style={s.typeRow}>
                  <TouchableOpacity style={[s.typeChip, notifType === 'full' && s.typeChipActive]} onPress={() => setNotifType('full')}>
                    <Text style={[s.typeChipText, notifType === 'full' && s.typeChipTextActive]}>通常</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[s.typeChip, notifType === 'silent' && s.typeChipActive]} onPress={() => setNotifType('silent')}>
                    <Text style={[s.typeChipText, notifType === 'silent' && s.typeChipTextActive]}>サイレント</Text>
                  </TouchableOpacity>
                </View>

                {addNotifs.map((item, index) => (
                  <View key={`${item.time}-${index}`} style={s.notifRow}>
                    <Text style={s.notifTime}>{item.time}</Text>
                    <Text style={s.notifType}>{item.type === 'full' ? '通常' : 'サイレント'}</Text>
                    <TouchableOpacity onPress={() => setAddNotifs((items) => items.filter((_, i) => i !== index))}>
                      <Text style={s.deleteBtnText}>削除</Text>
                    </TouchableOpacity>
                  </View>
                ))}

                <TouchableOpacity style={s.addNotifBtn} onPress={() => setShowAddTimePicker(true)}>
                  <Text style={s.addNotifBtnText}>通知時間を追加</Text>
                </TouchableOpacity>
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
              <View style={s.sheet}>
                <View style={s.sheetHandle} />
                <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

                {/* Title edit */}
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

                {/* Icon section */}
                <Text style={[s.sheetSection, { marginTop: 16 }]}>アイコン</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.iconRow}>
                  <TouchableOpacity
                    style={[s.iconChip, !detailTask?.icon && s.iconChipActive]}
                    onPress={() => updateDetailMeta({ icon: null })}
                  >
                    <Text style={s.iconNone}>なし</Text>
                  </TouchableOpacity>
                  {TASK_ICONS.map((ic) => (
                    <TouchableOpacity
                      key={ic}
                      style={[s.iconChip, detailTask?.icon === ic && s.iconChipActive]}
                      onPress={() => updateDetailMeta({ icon: ic })}
                    >
                      <Text style={s.iconEmoji}>{ic}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                {/* Priority section */}
                <Text style={[s.sheetSection, { marginTop: 16 }]}>優先度</Text>
                <View style={s.typeRow}>
                  {PRIORITIES.map((p) => (
                    <TouchableOpacity
                      key={p.value}
                      style={[s.typeChip, detailTask?.priority === p.value && { backgroundColor: p.color, borderColor: p.color }]}
                      onPress={() => updateDetailMeta({ priority: p.value })}
                    >
                      <Text style={[s.typeChipText, detailTask?.priority === p.value && s.typeChipTextActive]}>{p.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Frequency section */}
                <Text style={[s.sheetSection, { marginTop: 16 }]}>頻度</Text>
                <View style={s.typeRow}>
                  {FREQUENCIES.map((f) => (
                    <TouchableOpacity
                      key={f}
                      style={[s.typeChip, detailTask?.frequency === f && s.typeChipActive]}
                      onPress={() => updateDetailMeta({ frequency: f })}
                    >
                      <Text style={[s.typeChipText, detailTask?.frequency === f && s.typeChipTextActive]}>{f}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Notification section */}
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
                    <Text style={s.notifType}>{n.notification_type === 'full' ? '🔔' : '🔕'}</Text>
                    <TouchableOpacity onPress={() => handleDeleteNotif(n)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Text style={s.deleteBtnText}>🗑️</Text>
                    </TouchableOpacity>
                  </View>
                ))}

                <TouchableOpacity style={s.addNotifBtn} onPress={() => setShowTimePicker(true)}>
                  <Text style={s.addNotifBtnText}>＋ 通知時間を追加</Text>
                </TouchableOpacity>
                </ScrollView>
              </View>
            </TouchableOpacity>
          </KeyboardAvoidingView>
        </TouchableOpacity>
      </Modal>

      {showAddTimePicker && (
        <DateTimePicker
          value={addPickerTime}
          mode="time"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={(_, date) => {
            if (Platform.OS === 'android') {
              if (date) handleAddNotifToNewTask(date);
              else setShowAddTimePicker(false);
            } else {
              if (date) setAddPickerTime(date);
            }
          }}
        />
      )}
      {Platform.OS === 'ios' && showAddTimePicker && (
        <View style={s.iosRow}>
          <TouchableOpacity style={s.iosCancelBtn} onPress={() => setShowAddTimePicker(false)}>
            <Text style={s.iosCancelText}>キャンセル</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.iosConfirmBtn} onPress={() => handleAddNotifToNewTask(addPickerTime)}>
            <Text style={s.iosConfirmText}>追加</Text>
          </TouchableOpacity>
        </View>
      )}

      {showTimePicker && (
        <DateTimePicker
          value={pickerTime}
          mode="time"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={(_, date) => {
            if (Platform.OS === 'android') {
              if (date) handleAddNotif(date);
              else setShowTimePicker(false);
            } else {
              if (date) setPickerTime(date);
            }
          }}
        />
      )}
      {Platform.OS === 'ios' && showTimePicker && (
        <View style={s.iosRow}>
          <TouchableOpacity style={s.iosCancelBtn} onPress={() => setShowTimePicker(false)}>
            <Text style={s.iosCancelText}>キャンセル</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.iosConfirmBtn} onPress={() => handleAddNotif(pickerTime)}>
            <Text style={s.iosConfirmText}>追加</Text>
          </TouchableOpacity>
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
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.card,
    borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 14, gap: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4,
    elevation: 2,
  },
  taskCardDone: { opacity: 0.6 },
  checkBox: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  checkBoxDone: { backgroundColor: C.primary, borderColor: C.primary },
  checkMark: { color: C.onPrimary, fontSize: 11, fontWeight: '700' },
  taskBody: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  taskIcon: { fontSize: 18 },
  taskTextWrap: { flex: 1, gap: 4 },
  taskTitle: { color: C.onDark, fontSize: 14, fontWeight: '500', lineHeight: 20 },
  taskTitleDone: { color: C.muted, textDecorationLine: 'line-through' },
  taskMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  priorityBadge: { borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1 },
  priorityBadgeText: { color: C.onPrimary, fontSize: 9, fontWeight: '800' },
  freqTag: { color: C.muted, fontSize: 10, fontWeight: '700' },
  doneBadge: { backgroundColor: C.header, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  doneBadgeText: { color: C.onPrimary, fontSize: 9, fontWeight: '700', letterSpacing: 0.5 },
  deleteBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#fee2e2', alignItems: 'center', justifyContent: 'center' },
  deleteBtnText: { fontSize: 16 },

  empty: { paddingVertical: 60, alignItems: 'center', gap: 8 },
  emptyTitle: { color: C.stone, fontSize: 16, fontWeight: '700' },
  emptyBody: { color: C.muted, fontSize: 13 },

  fabWrap: { position: 'absolute', zIndex: 20 },
  fab: { width: 52, height: 52, borderRadius: 26, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center', elevation: 6, shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.25, shadowRadius: 6 },
  fabText: { color: C.onPrimary, fontSize: 26, fontWeight: '400', lineHeight: 30 },

  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: C.card, borderRadius: 16, padding: 20, gap: 12, elevation: 8 },
  modalTitle: { color: C.onDark, fontSize: 16, fontWeight: '700' },
  modalDivider: { height: 1, backgroundColor: C.border },
  modalLabel: { color: C.muted, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  modalInput: { borderWidth: 1, borderColor: C.border, borderRadius: 10, padding: 12, fontSize: 14, color: C.onDark, backgroundColor: C.body },
  modalButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 4 },
  modalCancel: { borderRadius: 8, borderWidth: 1, borderColor: C.border, paddingHorizontal: 16, paddingVertical: 9 },
  modalCancelText: { color: C.stone, fontSize: 13, fontWeight: '700' },
  modalConfirm: { backgroundColor: C.primary, borderRadius: 8, paddingHorizontal: 20, paddingVertical: 9 },
  modalConfirmDisabled: { backgroundColor: C.border },
  modalConfirmText: { color: C.onPrimary, fontSize: 13, fontWeight: '700' },

  sheetBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: C.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingTop: 12, gap: 8, maxHeight: '85%' },
  sheetHandle: { width: 40, height: 4, backgroundColor: C.border, borderRadius: 2, alignSelf: 'center', marginBottom: 12 },
  sheetSection: { color: C.muted, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  sheetTitleRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  sheetTitleInput: { flex: 1, borderWidth: 1, borderColor: C.border, borderRadius: 10, padding: 12, fontSize: 15, color: C.onDark, backgroundColor: C.body },
  sheetSaveBtn: { backgroundColor: C.primary, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12 },
  sheetSaveBtnDisabled: { backgroundColor: C.border },
  sheetSaveBtnText: { color: C.onPrimary, fontSize: 13, fontWeight: '700' },
  iconRow: { gap: 8, paddingVertical: 2 },
  iconChip: { width: 44, height: 44, borderRadius: 12, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  iconChipActive: { backgroundColor: '#eff6ff', borderColor: C.primary },
  iconEmoji: { fontSize: 22 },
  iconNone: { color: C.muted, fontSize: 11, fontWeight: '700' },
  typeRow: { flexDirection: 'row', gap: 8 },
  typeChip: { flex: 1, borderWidth: 1, borderColor: C.border, borderRadius: 20, paddingVertical: 8, alignItems: 'center' },
  typeChipActive: { backgroundColor: C.primary, borderColor: C.primary },
  typeChipText: { color: C.muted, fontSize: 12, fontWeight: '700' },
  typeChipTextActive: { color: C.onPrimary },
  notifRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.border, gap: 12 },
  notifTime: { flex: 1, fontSize: 18, fontWeight: '700', color: C.onDark },
  notifType: { fontSize: 16 },
  addNotifBtn: { backgroundColor: C.body, borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 4 },
  addNotifBtnText: { color: C.primary, fontSize: 14, fontWeight: '700' },

  iosRow: { flexDirection: 'row', backgroundColor: C.card, borderTopWidth: 1, borderTopColor: C.border, padding: 12, gap: 12 },
  iosCancelBtn: { flex: 1, borderWidth: 1, borderColor: C.border, borderRadius: 8, paddingVertical: 12, alignItems: 'center' },
  iosCancelText: { color: C.stone, fontSize: 14, fontWeight: '700' },
  iosConfirmBtn: { flex: 1, backgroundColor: C.primary, borderRadius: 8, paddingVertical: 12, alignItems: 'center' },
  iosConfirmText: { color: C.onPrimary, fontSize: 14, fontWeight: '700' },

  thumbOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  thumbEmoji: { fontSize: 80 },
});
