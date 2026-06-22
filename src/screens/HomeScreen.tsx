import React, { useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, Modal,
  TextInput, StyleSheet, Alert, KeyboardAvoidingView,
  Platform, StatusBar,
} from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../App';
import {
  Task, getToday, getTasks, addTask, deleteTask,
  getCompletedTaskIds, markComplete, markIncomplete,
} from '../db/database';

const C = {
  carbon:      '#21242e',
  gold:        '#e48600',
  amber:       '#ecab37',
  signal:      '#f68d1f',
  canvas:      '#7a8aba',
  canvasSoft:  '#9fbee7',
  chrome:      '#3d4f97',
  mutedIndigo: '#60619c',
  platinum:    '#dedede',
  surface:     '#ffffff',
  periwinkle:  '#8ba1d4',
  onPrimary:   '#ffffff',
  inkSoft:     '#3d4f97',
  red:         '#e60012',
};

type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'Home'> };

export default function HomeScreen({ navigation }: Props) {
  const db = useSQLiteContext();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [completedIds, setCompletedIds] = useState<Set<number>>(new Set());
  const [showAdd, setShowAdd] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const today = getToday();

  const load = useCallback(async () => {
    const ts = await getTasks(db);
    const ids = await getCompletedTaskIds(db, today);
    setTasks(ts);
    setCompletedIds(new Set(ids));
  }, [db, today]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const toggle = async (id: number) => {
    if (completedIds.has(id)) {
      await markIncomplete(db, id, today);
    } else {
      await markComplete(db, id, today);
    }
    load();
  };

  const handleAdd = async () => {
    const title = newTitle.trim();
    if (!title) return;
    await addTask(db, title);
    setNewTitle('');
    setShowAdd(false);
    load();
  };

  const handleDelete = (task: Task) => {
    Alert.alert('削除', `「${task.title}」を削除しますか？`, [
      { text: 'キャンセル', style: 'cancel' },
      { text: '削除', style: 'destructive', onPress: async () => { await deleteTask(db, task.id); load(); } },
    ]);
  };

  const done = tasks.filter((t) => completedIds.has(t.id)).length;
  const total = tasks.length;
  const progress = total > 0 ? done / total : 0;

  // Japanese date display
  const now = new Date();
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  const dateLabel = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')} (${weekdays[now.getDay()]})`;

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor={C.carbon} />

      {/* ── Nav bar ────────────────────────────────────────────────── */}
      <View style={s.navBar}>
        <Text style={s.navTitle}>毎日やること</Text>
        <View style={s.navButtons}>
          <TouchableOpacity style={s.chipMuted} onPress={() => navigation.navigate('Stats')}>
            <Text style={s.chipMutedText}>実行率</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.chipAmber} onPress={() => setShowAdd(true)}>
            <Text style={s.chipAmberText}>＋ ADD</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Sub-nav strip ──────────────────────────────────────────── */}
      <View style={s.subNav}>
        <Text style={s.subNavText}>{dateLabel}</Text>
      </View>

      {/* ── Progress panel ─────────────────────────────────────────── */}
      <View style={s.progressPanel}>
        <Text style={s.sectionLabel}>≡ TODAY'S PROGRESS</Text>
        <View style={s.progressRow}>
          <View style={s.progressBg}>
            <View style={[s.progressFill, { width: `${progress * 100}%` }]} />
          </View>
          <Text style={s.progressText}>{done} / {total} 完了</Text>
        </View>
      </View>

      {/* ── Section label ──────────────────────────────────────────── */}
      <View style={s.sectionBar}>
        <Text style={s.sectionLabel}>≡ CHECKLIST</Text>
        {total > 0 && <Text style={s.sectionCount}>{total}件</Text>}
      </View>

      {/* ── Task list ──────────────────────────────────────────────── */}
      {tasks.length === 0 ? (
        <View style={s.empty}>
          <View style={s.emptyBox}>
            <Text style={s.emptyTitle}>NO TASKS</Text>
            <Text style={s.emptyBody}>毎日やることを追加しましょう</Text>
            <TouchableOpacity style={s.emptyButton} onPress={() => setShowAdd(true)}>
              <Text style={s.emptyButtonText}>＋</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <FlatList
          data={tasks}
          keyExtractor={(item) => String(item.id)}
          style={s.list}
          renderItem={({ item }) => {
            const done = completedIds.has(item.id);
            return (
              <>
                <TouchableOpacity style={s.taskRow} onPress={() => toggle(item.id)} onLongPress={() => handleDelete(item)}>
                  <View style={[s.checkCircle, done && s.checkCircleDone]}>
                    {done && <Text style={s.checkMark}>✓</Text>}
                  </View>
                  <Text style={[s.taskTitle, done && s.taskTitleDone]} numberOfLines={2}>{item.title}</Text>
                  <View style={[s.arrowChip, done && s.arrowChipDone]}>
                    <Text style={s.arrowText}>{done ? '✓' : '›'}</Text>
                  </View>
                </TouchableOpacity>
                <View style={s.divider} />
              </>
            );
          }}
          ListFooterComponent={<View style={{ height: 16 }} />}
        />
      )}

      {/* ── Add button (bottom) ─────────────────────────────────────── */}
      <View style={s.bottomBar}>
        <TouchableOpacity style={s.addButton} onPress={() => setShowAdd(true)}>
          <Text style={s.addButtonText}>＋ タスクを追加する</Text>
        </TouchableOpacity>
      </View>

      {/* ── Add task modal ──────────────────────────────────────────── */}
      <Modal visible={showAdd} transparent animationType="fade" onRequestClose={() => setShowAdd(false)}>
        <KeyboardAvoidingView style={s.modalBg} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>≡ ADD TASK</Text>
            <View style={s.modalDivider} />
            <Text style={s.modalLabel}>タスク名</Text>
            <TextInput
              style={s.modalInput}
              value={newTitle}
              onChangeText={setNewTitle}
              placeholder="例：歯磨き、運動、水を飲む"
              placeholderTextColor="#999"
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleAdd}
            />
            <View style={s.modalButtons}>
              <TouchableOpacity style={s.modalCancel} onPress={() => { setShowAdd(false); setNewTitle(''); }}>
                <Text style={s.modalCancelText}>キャンセル</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.modalConfirm, !newTitle.trim() && s.modalConfirmDisabled]} onPress={handleAdd} disabled={!newTitle.trim()}>
                <Text style={s.modalConfirmText}>追加</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.canvas },

  // Nav bar
  navBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.carbon, height: 52, paddingHorizontal: 12, borderBottomWidth: 2, borderBottomColor: C.chrome },
  navTitle: { flex: 1, color: C.gold, fontSize: 13, fontWeight: '700', letterSpacing: 0.5 },
  navButtons: { flexDirection: 'row', gap: 6 },
  chipMuted: { backgroundColor: C.mutedIndigo, borderRadius: 2, paddingHorizontal: 10, paddingVertical: 5, justifyContent: 'center' },
  chipMutedText: { color: C.onPrimary, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  chipAmber: { backgroundColor: C.amber, borderRadius: 2, paddingHorizontal: 10, paddingVertical: 5, justifyContent: 'center' },
  chipAmberText: { color: C.carbon, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },

  // Sub-nav
  subNav: { backgroundColor: C.canvasSoft, paddingHorizontal: 12, paddingVertical: 5 },
  subNavText: { color: C.carbon, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },

  // Progress
  progressPanel: { margin: 12, backgroundColor: C.periwinkle, borderRadius: 4, borderWidth: 1, borderColor: C.chrome, padding: 10, elevation: 2 },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  progressBg: { flex: 1, height: 8, backgroundColor: C.mutedIndigo, borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: C.signal, borderRadius: 2 },
  progressText: { color: C.onPrimary, fontSize: 11, fontWeight: '700' },

  // Section bar
  sectionBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 5 },
  sectionLabel: { color: C.carbon, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  sectionCount: { color: C.inkSoft, fontSize: 10, fontWeight: '700' },

  // Task list
  list: { flex: 1, paddingHorizontal: 12 },
  taskRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.platinum, paddingHorizontal: 12, paddingVertical: 12, gap: 10 },
  checkCircle: { width: 22, height: 22, borderRadius: 11, borderWidth: 1, borderColor: C.mutedIndigo, backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  checkCircleDone: { backgroundColor: C.signal, borderColor: C.signal },
  checkMark: { color: C.onPrimary, fontSize: 12, fontWeight: '700' },
  taskTitle: { flex: 1, color: C.carbon, fontSize: 12, fontWeight: '700' },
  taskTitleDone: { color: C.inkSoft, textDecorationLine: 'line-through' },
  arrowChip: { width: 18, height: 18, borderRadius: 2, backgroundColor: C.amber, alignItems: 'center', justifyContent: 'center' },
  arrowChipDone: { backgroundColor: C.signal },
  arrowText: { color: C.carbon, fontSize: 11, fontWeight: '700' },
  divider: { height: 1, backgroundColor: C.mutedIndigo, opacity: 0.3 },

  // Empty
  empty: { flex: 1, padding: 24, justifyContent: 'center' },
  emptyBox: { backgroundColor: C.canvasSoft, borderRadius: 4, borderWidth: 1, borderColor: C.chrome, padding: 24, alignItems: 'center', gap: 10 },
  emptyTitle: { color: C.chrome, fontSize: 13, fontWeight: '700', letterSpacing: 0.5 },
  emptyBody: { color: C.inkSoft, fontSize: 12 },
  emptyButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: C.signal, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  emptyButtonText: { color: C.onPrimary, fontSize: 22, fontWeight: '700' },

  // Bottom bar
  bottomBar: { backgroundColor: C.carbon, padding: 12 },
  addButton: { backgroundColor: C.signal, borderRadius: 2, height: 42, alignItems: 'center', justifyContent: 'center' },
  addButtonText: { color: C.onPrimary, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },

  // Modal
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 24 },
  modalCard: { backgroundColor: C.surface, borderRadius: 4, padding: 20, gap: 10 },
  modalTitle: { color: C.carbon, fontSize: 13, fontWeight: '700', letterSpacing: 0.5 },
  modalDivider: { height: 1, backgroundColor: C.platinum },
  modalLabel: { color: C.carbon, fontSize: 12, fontWeight: '700' },
  modalInput: { borderWidth: 1, borderColor: C.chrome, borderRadius: 2, padding: 8, fontSize: 12, color: C.carbon },
  modalButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 4 },
  modalCancel: { backgroundColor: C.carbon, borderRadius: 2, paddingHorizontal: 14, paddingVertical: 8 },
  modalCancelText: { color: C.canvasSoft, fontSize: 11, fontWeight: '700' },
  modalConfirm: { backgroundColor: C.signal, borderRadius: 2, paddingHorizontal: 16, paddingVertical: 8 },
  modalConfirmDisabled: { backgroundColor: C.platinum },
  modalConfirmText: { color: C.onPrimary, fontSize: 11, fontWeight: '700' },
});
