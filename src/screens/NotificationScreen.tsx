import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Platform, Alert, StatusBar, Switch } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSQLiteContext } from 'expo-sqlite';
import { useFocusEffect } from '@react-navigation/native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Notifications from 'expo-notifications';
import { LinearGradient } from 'expo-linear-gradient';
import { RootStackParamList } from '../../App';
import {
  NotificationSetting,
  TimeLog,
  addNotificationSetting,
  deleteNotificationSetting,
  getNotificationSettings,
  getTimeLogsForDate,
  getToday,
  getTotalTimeForDate,
  getSetting,
  setSetting,
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
  error: '#e52020',
};

type NotifType = 'full' | 'silent';
type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'Notifications'> };

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

function formatDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatClock(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

async function scheduleNotification(time: string, type: NotifType): Promise<string | null> {
  const [h, m] = time.split(':').map(Number);
  try {
    const identifier = await Notifications.scheduleNotificationAsync({
      content: ({
        title: '毎日タスク',
        body: '今日のタスクを確認しましょう。',
        sound: type === 'full',
        android: { channelId: type === 'full' ? 'full' : 'silent' } as any,
      } as any),
      trigger: { hour: h, minute: m, repeats: true } as any,
    });
    return identifier;
  } catch {
    return null;
  }
}

export default function NotificationScreen({ navigation }: Props) {
  const db = useSQLiteContext();
  const insets = useSafeAreaInsets();
  const today = getToday();
  const [settings, setSettings] = useState<NotificationSetting[]>([]);
  const [timeLogs, setTimeLogs] = useState<TimeLog[]>([]);
  const [totalSeconds, setTotalSeconds] = useState(0);
  const [showPicker, setShowPicker] = useState(false);
  const [pickerTime, setPickerTime] = useState(new Date());
  const [newType, setNewType] = useState<NotifType>('full');
  const [tagRight, setTagRight] = useState(false);
  const [scheduleSize, setScheduleSize] = useState<'small' | 'normal' | 'large'>('normal');

  const load = useCallback(async () => {
    const [data, logs, total, layout, size] = await Promise.all([
      getNotificationSettings(db),
      getTimeLogsForDate(db, today),
      getTotalTimeForDate(db, today),
      getSetting(db, 'card_layout'),
      getSetting(db, 'schedule_size'),
    ]);
    setSettings(data);
    setTimeLogs(logs);
    setTotalSeconds(total);
    setTagRight(layout === 'tag_right');
    if (size === 'small' || size === 'large' || size === 'normal') setScheduleSize(size);
  }, [db, today]);

  const toggleTagRight = async (val: boolean) => {
    setTagRight(val);
    await setSetting(db, 'card_layout', val ? 'tag_right' : 'tag_left');
  };

  const changeScheduleSize = async (val: 'small' | 'normal' | 'large') => {
    setScheduleSize(val);
    await setSetting(db, 'schedule_size', val);
  };

  useFocusEffect(useCallback(() => {
    load();
    if (Platform.OS === 'android') {
      Notifications.setNotificationChannelAsync('full', {
        name: '通常通知',
        importance: Notifications.AndroidImportance.HIGH,
        sound: 'default',
      });
      Notifications.setNotificationChannelAsync('silent', {
        name: 'サイレント通知',
        importance: Notifications.AndroidImportance.LOW,
        sound: null,
      });
    }
  }, [load]));

  const handleAdd = async (date: Date) => {
    setShowPicker(false);
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('通知の許可が必要です', '端末の設定から通知を許可してください。');
      return;
    }
    const h = date.getHours();
    const m = date.getMinutes();
    const time = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    const identifier = await scheduleNotification(time, newType);
    await addNotificationSetting(db, time, newType, identifier);
    load();
  };

  const handleDelete = (item: NotificationSetting) => {
    Alert.alert('削除', `${item.time} の通知を削除しますか？`, [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: '削除',
        style: 'destructive',
        onPress: async () => {
          const id = await deleteNotificationSetting(db, item.id);
          if (id) await Notifications.cancelScheduledNotificationAsync(id);
          load();
        },
      },
    ]);
  };

  return (
    <View style={s.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      <LinearGradient colors={GRAD.header} start={GRAD_START} end={GRAD_END} style={[s.headerCard, { paddingTop: insets.top + 12 }]}>
        <Text style={s.headerTitle}>設定</Text>
      </LinearGradient>

      <FlatList
        data={settings}
        keyExtractor={(item) => String(item.id)}
        style={s.list}
        contentContainerStyle={{ padding: 16, gap: 10 }}
        ListHeaderComponent={
          <View style={s.addSection}>
            <View style={s.timerCard}>
              <View style={s.timerHeader}>
                <View>
                  <Text style={s.typeLabel}>今日のタイマー記録</Text>
                  <Text style={s.timerTotal}>{formatDuration(totalSeconds)}</Text>
                </View>
                <TouchableOpacity onPress={() => navigation.navigate('Timer')} activeOpacity={0.85}>
                  <LinearGradient colors={GRAD.brand} start={GRAD_START} end={GRAD_END} style={s.timerBtn}>
                    <Text style={s.timerBtnText}>開く</Text>
                  </LinearGradient>
                </TouchableOpacity>
              </View>
              {timeLogs.length === 0 ? (
                <Text style={s.timerEmpty}>まだ記録がありません</Text>
              ) : (
                timeLogs.slice(0, 3).map((log) => (
                  <View key={log.id} style={s.logRow}>
                    <View style={s.logMain}>
                      <Text style={s.logTitle} numberOfLines={1}>{log.title}</Text>
                      <Text style={s.logTime}>{formatClock(log.started_at)} - {formatClock(log.ended_at)}</Text>
                    </View>
                    <Text style={s.logDuration}>{formatDuration(log.duration_seconds)}</Text>
                  </View>
                ))
              )}
            </View>

            <View style={s.typeCard}>
              <Text style={s.typeLabel}>表示設定</Text>
              <View style={s.settingRow}>
                <View style={s.settingRowText}>
                  <Text style={s.settingRowLabel}>タグ・完了ボタンの位置</Text>
                  <Text style={s.settingRowSub}>{tagRight ? 'タグ：右　チェック：左' : 'タグ：左　チェック：右'}</Text>
                </View>
                <Switch
                  value={tagRight}
                  onValueChange={toggleTagRight}
                  trackColor={{ false: C.border, true: C.primary }}
                  thumbColor="#ffffff"
                />
              </View>
              <View style={s.sizeBlock}>
                <Text style={s.settingRowLabel}>タイムスケジュールの大きさ</Text>
                <View style={s.typeRow}>
                  {([['small', '小'], ['normal', '標準'], ['large', '大']] as ['small' | 'normal' | 'large', string][]).map(([v, label]) => (
                    <TouchableOpacity
                      key={v}
                      style={[s.typeChip, scheduleSize === v && s.typeChipActive]}
                      onPress={() => changeScheduleSize(v)}
                    >
                      <Text style={[s.typeChipText, scheduleSize === v && s.typeChipTextActive]}>{label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </View>

            <View style={s.typeCard}>
              <Text style={s.typeLabel}>通知タイプ</Text>
              <View style={s.typeRow}>
                <TouchableOpacity
                  style={[s.typeChip, newType === 'full' && s.typeChipActive]}
                  onPress={() => setNewType('full')}
                >
                  <Text style={[s.typeChipText, newType === 'full' && s.typeChipTextActive]}>通常</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.typeChip, newType === 'silent' && s.typeChipActive]}
                  onPress={() => setNewType('silent')}
                >
                  <Text style={[s.typeChipText, newType === 'silent' && s.typeChipTextActive]}>サイレント</Text>
                </TouchableOpacity>
              </View>
            </View>
            <TouchableOpacity onPress={() => setShowPicker(true)} activeOpacity={0.85}>
              <LinearGradient colors={GRAD.brand} start={GRAD_START} end={GRAD_END} style={s.addBtn}>
                <Text style={s.addBtnText}>通知時間を追加</Text>
              </LinearGradient>
            </TouchableOpacity>
            {settings.length > 0 && <Text style={s.sectionLabel}>設定済みの通知</Text>}
          </View>
        }
        ListEmptyComponent={
          <View style={s.empty}>
            <Text style={s.emptyText}>通知が設定されていません</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={s.settingCard}>
            <Text style={s.settingTime}>{item.time}</Text>
            <Text style={s.settingType}>{item.notification_type === 'full' ? '通常' : 'サイレント'}</Text>
            <TouchableOpacity style={s.deleteBtn} onPress={() => handleDelete(item)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={s.deleteBtnText}>削除</Text>
            </TouchableOpacity>
          </View>
        )}
        ListFooterComponent={<View style={{ height: 8 }} />}
      />

      <TabBar current="Notifications" navigation={navigation} />

      {showPicker && (
        <DateTimePicker
          value={pickerTime}
          mode="time"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={(_, date) => {
            if (Platform.OS === 'android') {
              if (date) handleAdd(date);
              else setShowPicker(false);
            } else if (date) {
              setPickerTime(date);
            }
          }}
        />
      )}
      {Platform.OS === 'ios' && showPicker && (
        <View style={s.iosRow}>
          <TouchableOpacity style={s.iosCancelBtn} onPress={() => setShowPicker(false)}>
            <Text style={s.iosCancelText}>キャンセル</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.iosConfirmBtn} onPress={() => handleAdd(pickerTime)}>
            <Text style={s.iosConfirmText}>追加</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: C.body },
  headerCard: { backgroundColor: C.header, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 20 },
  headerTitle: { color: '#ffffff', fontSize: 20, fontWeight: '700' },

  list: { flex: 1, backgroundColor: C.body },
  addSection: { gap: 10, marginBottom: 4 },
  timerCard: { backgroundColor: C.card, borderRadius: 12, padding: 14, gap: 10, elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4 },
  timerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  timerTotal: { color: C.onDark, fontSize: 28, fontWeight: '800', marginTop: 2 },
  timerBtn: { backgroundColor: C.primary, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  timerBtnText: { color: C.onPrimary, fontSize: 12, fontWeight: '800' },
  timerEmpty: { color: C.muted, fontSize: 13, fontWeight: '600' },
  logRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: 1, borderTopColor: C.border, paddingTop: 8 },
  logMain: { flex: 1, gap: 2 },
  logTitle: { color: C.onDark, fontSize: 13, fontWeight: '700' },
  logTime: { color: C.muted, fontSize: 11, fontWeight: '700' },
  logDuration: { color: C.onDark, fontSize: 15, fontWeight: '800' },
  typeCard: { backgroundColor: C.card, borderRadius: 12, padding: 14, gap: 10, elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4 },
  typeLabel: { color: C.stone, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  settingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  sizeBlock: { gap: 8, borderTopWidth: 1, borderTopColor: C.border, paddingTop: 10 },
  settingRowText: { flex: 1, gap: 2 },
  settingRowLabel: { color: C.onDark, fontSize: 13, fontWeight: '700' },
  settingRowSub: { color: '#64748b', fontSize: 11, fontWeight: '600' },
  typeRow: { flexDirection: 'row', gap: 8 },
  typeChip: { flex: 1, borderWidth: 1, borderColor: C.border, borderRadius: 20, paddingVertical: 10, alignItems: 'center' },
  typeChipActive: { backgroundColor: C.primary, borderColor: C.primary },
  typeChipText: { color: C.muted, fontSize: 13, fontWeight: '700' },
  typeChipTextActive: { color: C.onPrimary },

  addBtn: { backgroundColor: C.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center', elevation: 2 },
  addBtnText: { color: C.onPrimary, fontSize: 14, fontWeight: '700' },
  sectionLabel: { color: C.muted, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },

  settingCard: { backgroundColor: C.card, borderRadius: 12, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12, elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4 },
  settingTime: { fontSize: 22, fontWeight: '700', color: C.onDark, flex: 1 },
  settingType: { color: C.stone, fontSize: 13, fontWeight: '600' },
  deleteBtn: { borderRadius: 16, backgroundColor: '#fee2e2', paddingHorizontal: 10, paddingVertical: 6, alignItems: 'center', justifyContent: 'center' },
  deleteBtnText: { color: C.error, fontSize: 11, fontWeight: '800' },

  empty: { paddingVertical: 40, alignItems: 'center' },
  emptyText: { color: C.muted, fontSize: 14, fontWeight: '600' },

  iosRow: { flexDirection: 'row', backgroundColor: C.card, borderTopWidth: 1, borderTopColor: C.border, padding: 12, gap: 12 },
  iosCancelBtn: { flex: 1, borderWidth: 1, borderColor: C.border, borderRadius: 8, paddingVertical: 12, alignItems: 'center' },
  iosCancelText: { color: C.stone, fontSize: 14, fontWeight: '700' },
  iosConfirmBtn: { flex: 1, backgroundColor: C.primary, borderRadius: 8, paddingVertical: 12, alignItems: 'center' },
  iosConfirmText: { color: C.onPrimary, fontSize: 14, fontWeight: '700' },
});
