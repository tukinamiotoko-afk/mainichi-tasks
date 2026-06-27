import React, { useState, useCallback, useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, StatusBar, Modal, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSQLiteContext } from 'expo-sqlite';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { LinearGradient } from 'expo-linear-gradient';
import { RootStackParamList } from '../../App';
import {
  Task, FlowBranch, getToday, getTasks, getCompletedTaskIds,
  markComplete, markIncomplete, updateTaskSortOrders,
  getFlowBranches, addFlowBranch, updateFlowBranch, deleteFlowBranch,
} from '../db/database';
import { isDueToday, WEEKDAYS } from '../constants/taskMeta';
import { GRAD_START, GRAD_END } from '../constants/theme';
import TabBar from '../components/TabBar';
import { useTheme, ColorSet } from '../contexts/ThemeContext';

const pad = (n: number) => String(n).padStart(2, '0');

type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'Flow'> };

type FlowNode = { type: 'task'; task: Task } | { type: 'branch'; branch: FlowBranch };

type BranchModal = {
  mode: 'add' | 'edit';
  afterTaskId: number | null;
  editId: number | null;
  question: string;
  yesLabel: string;
  yesText: string;
  noLabel: string;
  noText: string;
};

function buildNodes(tasks: Task[], branches: FlowBranch[]): FlowNode[] {
  const nodes: FlowNode[] = [];
  for (const task of tasks) {
    nodes.push({ type: 'task', task });
    branches
      .filter((b) => b.after_task_id === task.id)
      .forEach((b) => nodes.push({ type: 'branch', branch: b }));
  }
  return nodes;
}

const downStyles = StyleSheet.create({
  down: { alignItems: 'center', justifyContent: 'center' },
  downLine: { width: 2 },
  arrowHead: { width: 0, height: 0, borderLeftWidth: 6, borderRightWidth: 6, borderTopWidth: 9, borderLeftColor: 'transparent', borderRightColor: 'transparent', marginTop: -1 },
});

function Down({ color = '#64748b', h = 22 }: { color?: string; h?: number }) {
  return (
    <View style={downStyles.down} pointerEvents="none">
      <View style={[downStyles.downLine, { height: h, backgroundColor: color }]} />
      <View style={[downStyles.arrowHead, { borderTopColor: color }]} />
    </View>
  );
}

const makeStyles = (C: ColorSet) => StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: C.body },
  headerCard: { backgroundColor: C.primary, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 16 },
  dateNavRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dateNavBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  dateNavArrow: { color: '#ffffff', fontSize: 24, fontWeight: '800', marginTop: -2 },
  dateNavCenter: { flex: 1, alignItems: 'center' },
  dateText: { color: '#ffffff', fontSize: 15, fontWeight: '800' },
  dateTodayHint: { color: 'rgba(255,255,255,0.75)', fontSize: 10, fontWeight: '700', marginTop: 1 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  editBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.22)' },
  editBtnActive: { backgroundColor: '#ffffff' },
  editBtnText: { color: '#ffffff', fontSize: 13, fontWeight: '800' },
  editBtnTextActive: { color: C.primary },

  bodyView: { flex: 1, backgroundColor: C.body },

  // ── flowchart ──
  flowContent: { padding: 16, paddingBottom: 40, alignItems: 'center' },
  terminator: { backgroundColor: C.termBg, borderWidth: 1.5, borderColor: C.termBorder, borderRadius: 22, paddingHorizontal: 30, paddingVertical: 10 },
  terminatorText: { color: C.termText, fontSize: 14, fontWeight: '800', letterSpacing: 1 },
  terminatorEndText: { color: '#ffffff' },
  terminatorDone: { backgroundColor: C.doneBg, borderColor: C.doneBorder },
  stepWrap: { alignItems: 'center', width: '100%' },
  process: { flexDirection: 'row', alignItems: 'center', gap: 10, width: '82%', backgroundColor: C.termBg, borderWidth: 1.5, borderColor: C.termBorder, borderRadius: 4, paddingHorizontal: 12, paddingVertical: 12 },
  processDone: { backgroundColor: C.successBg, borderColor: C.doneBorder },
  stepNo: { width: 22, height: 22, borderRadius: 4, backgroundColor: C.termBorder, alignItems: 'center', justifyContent: 'center' },
  stepNoDone: { backgroundColor: C.doneBg },
  stepNoText: { color: '#ffffff', fontSize: 12, fontWeight: '800' },
  processText: { flex: 1, color: C.procText, fontSize: 13, fontWeight: '700' },
  processTextDone: { color: '#166534', textDecorationLine: 'line-through' },
  processCheck: { color: C.doneBg, fontSize: 14, fontWeight: '900' },
  diamond: { width: 96, height: 96, borderRadius: 8, borderWidth: 1.5, borderColor: C.diaBorder, backgroundColor: C.diaBg, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '45deg' }] },
  diamondDone: { backgroundColor: '#86efac' },
  diamondCustom: { borderColor: '#7c3aed', backgroundColor: '#ede9fe' },
  diamondInner: { width: 140, alignItems: 'center', transform: [{ rotate: '-45deg' }] },
  diamondText: { color: C.diaText, fontSize: 13, fontWeight: '800', textAlign: 'center' },
  diamondTextDone: { color: '#14532d' },
  diamondTextCustom: { color: '#4c1d95' },
  branchRow: { flexDirection: 'row', width: '100%', marginTop: 2 },
  branchCol: { flex: 1, alignItems: 'center' },
  branchLabel: { fontSize: 12, fontWeight: '800', marginBottom: -2 },
  outBox: { backgroundColor: C.termBg, borderWidth: 1.5, borderColor: C.termBorder, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 8, minWidth: 92, alignItems: 'center' },
  outBoxDone: { backgroundColor: C.doneBg, borderColor: C.doneBorder },
  outBoxNo: { backgroundColor: '#fef3c7', borderColor: '#d97706' },
  outBoxYes: { backgroundColor: '#f0fdf4', borderColor: '#86efac' },
  outBoxCustomNo: { backgroundColor: '#faf5ff', borderColor: '#c4b5fd' },
  outText: { color: C.termText, fontSize: 13, fontWeight: '800' },
  outTextDone: { color: '#ffffff' },
  outNoText: { color: '#92400e', fontSize: 13, fontWeight: '800' },
  outYesText: { color: '#166534', fontSize: 13, fontWeight: '800' },
  outCustomNoText: { color: '#5b21b6', fontSize: 13, fontWeight: '800' },
  mergeRailWrap: { width: '50%', alignItems: 'center', marginTop: 14 },
  mergeRail: { width: '100%', height: 2, backgroundColor: C.line },

  // ── edit mode ──
  editList: { paddingHorizontal: 12, paddingTop: 12, paddingBottom: 40, gap: 0 },
  editHint: { color: C.muted, fontSize: 12, textAlign: 'center', marginBottom: 10 },
  editTaskRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.card, borderRadius: 10, borderWidth: 1, borderColor: C.border, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 6 },
  editHandle: { fontSize: 16, color: C.muted },
  editStepNo: { width: 22, height: 22, borderRadius: 4, backgroundColor: C.termBorder, alignItems: 'center', justifyContent: 'center' },
  editStepNoText: { color: '#ffffff', fontSize: 12, fontWeight: '800' },
  editTaskTitle: { flex: 1, color: C.ink, fontSize: 13, fontWeight: '700' },
  editArrowBtn: { width: 30, height: 30, borderRadius: 8, backgroundColor: C.primarySoft, alignItems: 'center', justifyContent: 'center' },
  editArrowText: { color: C.primary, fontSize: 16, fontWeight: '900' },
  editArrowDisabled: { opacity: 0.25 },
  editBranchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#faf5ff', borderRadius: 10, borderWidth: 1, borderColor: '#c4b5fd', paddingHorizontal: 12, paddingVertical: 9, marginBottom: 4, marginLeft: 20 },
  editBranchIcon: { fontSize: 14, color: '#7c3aed' },
  editBranchBody: { flex: 1 },
  editBranchQuestion: { color: '#4c1d95', fontSize: 13, fontWeight: '800' },
  editBranchLabels: { color: '#7c3aed', fontSize: 11, marginTop: 1 },
  editBranchActionBtn: { width: 28, height: 28, borderRadius: 8, backgroundColor: '#ede9fe', alignItems: 'center', justifyContent: 'center' },
  editBranchActionText: { fontSize: 13, fontWeight: '800' },
  addBranchBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6, paddingHorizontal: 12, marginLeft: 20, marginBottom: 10 },
  addBranchText: { color: '#7c3aed', fontSize: 12, fontWeight: '700' },

  // ── modal ──
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: C.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 10 },
  modalTitle: { color: C.ink, fontSize: 16, fontWeight: '800', marginBottom: 2 },
  modalSection: { color: C.muted, fontSize: 11, fontWeight: '700', marginTop: 6, marginBottom: 2 },
  modalInput: { borderWidth: 1.5, borderColor: C.grid, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: C.ink, fontSize: 14, backgroundColor: C.body },
  modalRow: { flexDirection: 'row', gap: 8 },
  modalHalf: { flex: 1 },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 6 },
  modalCancel: { flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1.5, borderColor: C.grid, alignItems: 'center' },
  modalCancelText: { color: C.muted, fontSize: 14, fontWeight: '700' },
  modalOk: { flex: 1, paddingVertical: 12, borderRadius: 10, backgroundColor: '#7c3aed', alignItems: 'center' },
  modalOkText: { color: '#ffffff', fontSize: 14, fontWeight: '700' },

  empty: { paddingVertical: 60, alignItems: 'center', gap: 8 },
  emptyTitle: { color: C.ink, fontSize: 16, fontWeight: '700' },
  emptyBody: { color: C.muted, fontSize: 13, textAlign: 'center', paddingHorizontal: 24 },
});

export default function FlowScreen({ navigation }: Props) {
  const db = useSQLiteContext();
  const insets = useSafeAreaInsets();
  const { C, grad } = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  const today = getToday();

  const [selectedDate, setSelectedDate] = useState(today);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [completedIds, setCompletedIds] = useState<Set<number>>(new Set());
  const [branches, setBranches] = useState<FlowBranch[]>([]);
  const [editMode, setEditMode] = useState(false);
  const [editOrdered, setEditOrdered] = useState<Task[]>([]);
  const [modal, setModal] = useState<BranchModal | null>(null);

  const isToday = selectedDate === today;
  const selDateObj = useMemo(() => new Date(`${selectedDate}T00:00:00`), [selectedDate]);
  const dateLabel = `${selDateObj.getFullYear()}/${pad(selDateObj.getMonth() + 1)}/${pad(selDateObj.getDate())} (${WEEKDAYS[selDateObj.getDay()]})`;

  const shiftSelected = (days: number) => {
    const d = new Date(`${selectedDate}T00:00:00`);
    d.setDate(d.getDate() + days);
    setSelectedDate(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
  };

  const load = useCallback(async () => {
    const [ts, ids, brs] = await Promise.all([
      getTasks(db),
      getCompletedTaskIds(db, selectedDate),
      getFlowBranches(db),
    ]);
    setTasks(ts);
    setCompletedIds(new Set(ids));
    setBranches(brs);
  }, [db, selectedDate]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const toggle = async (id: number) => {
    if (completedIds.has(id)) await markIncomplete(db, id, selectedDate);
    else await markComplete(db, id, selectedDate);
    load();
  };

  const due = tasks.filter((t) => isDueToday(t, selDateObj));
  const ordered = [...due].sort((a, b) => {
    const at = a.scheduled_time ?? '99:99';
    const bt = b.scheduled_time ?? '99:99';
    if (at !== bt) return at < bt ? -1 : 1;
    return a.sort_order - b.sort_order;
  });
  const doneCount = due.filter((t) => completedIds.has(t.id)).length;
  const remaining = due.length - doneCount;
  const allDone = due.length > 0 && remaining === 0;

  const dueIds = useMemo(() => new Set(ordered.map((t) => t.id)), [ordered]);
  const flowNodes = useMemo(
    () => buildNodes(ordered, branches.filter((b) => b.after_task_id !== null && dueIds.has(b.after_task_id!))),
    [ordered, branches, dueIds],
  );

  const enterEdit = () => {
    setEditOrdered([...ordered]);
    setEditMode(true);
  };

  const exitEdit = async () => {
    await updateTaskSortOrders(db, editOrdered.map((t) => t.id));
    setEditMode(false);
    load();
  };

  const moveStep = (idx: number, dir: -1 | 1) => {
    const next = idx + dir;
    if (next < 0 || next >= editOrdered.length) return;
    setEditOrdered((prev) => {
      const arr = [...prev];
      [arr[idx], arr[next]] = [arr[next], arr[idx]];
      return arr;
    });
  };

  const openAddBranch = (afterTaskId: number) => {
    setModal({ mode: 'add', afterTaskId, editId: null, question: '', yesLabel: 'はい', yesText: '', noLabel: 'いいえ', noText: '' });
  };

  const openEditBranch = (branch: FlowBranch) => {
    setModal({
      mode: 'edit', afterTaskId: branch.after_task_id, editId: branch.id,
      question: branch.question, yesLabel: branch.yes_label, yesText: branch.yes_text ?? '',
      noLabel: branch.no_label, noText: branch.no_text ?? '',
    });
  };

  const saveBranch = async () => {
    if (!modal) return;
    const data: Omit<FlowBranch, 'id'> = {
      after_task_id: modal.afterTaskId,
      question: modal.question.trim() || '確認',
      yes_label: modal.yesLabel.trim() || 'はい',
      yes_text: modal.yesText.trim() || null,
      no_label: modal.noLabel.trim() || 'いいえ',
      no_text: modal.noText.trim() || null,
    };
    if (modal.mode === 'add') await addFlowBranch(db, data);
    else if (modal.editId !== null) await updateFlowBranch(db, modal.editId, data);
    setModal(null);
    load();
  };

  const removeBranch = async (id: number) => {
    await deleteFlowBranch(db, id);
    load();
  };

  const setField = (field: keyof BranchModal, value: string) =>
    setModal((m) => (m ? { ...m, [field]: value } : m));

  // Branches visible in edit mode (only for today's due tasks)
  const editIds = useMemo(() => new Set(editOrdered.map((t) => t.id)), [editOrdered]);
  const editBranches = useMemo(
    () => branches.filter((b) => b.after_task_id !== null && editIds.has(b.after_task_id!)),
    [branches, editIds],
  );

  let taskCounter = 0;

  return (
    <View style={s.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      <LinearGradient colors={grad.header} start={GRAD_START} end={GRAD_END} style={[s.headerCard, { paddingTop: insets.top + 12 }]}>
        <View style={s.dateNavRow}>
          <TouchableOpacity onPress={() => shiftSelected(-1)} style={s.dateNavBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} disabled={editMode}>
            <Text style={[s.dateNavArrow, editMode && { opacity: 0.3 }]}>‹</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setSelectedDate(today)} activeOpacity={0.7} style={s.dateNavCenter} disabled={editMode}>
            <Text style={s.dateText}>{dateLabel}</Text>
            {!isToday && <Text style={s.dateTodayHint}>タップで今日へ</Text>}
          </TouchableOpacity>
          <View style={s.headerRight}>
            <TouchableOpacity onPress={() => shiftSelected(1)} style={s.dateNavBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} disabled={editMode}>
              <Text style={[s.dateNavArrow, editMode && { opacity: 0.3 }]}>›</Text>
            </TouchableOpacity>
            {due.length > 0 && (
              <TouchableOpacity style={[s.editBtn, editMode && s.editBtnActive]} onPress={editMode ? exitEdit : enterEdit}>
                <Text style={[s.editBtnText, editMode && s.editBtnTextActive]}>{editMode ? '完了' : '編集'}</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </LinearGradient>

      {editMode ? (
        /* ── edit mode ── */
        <ScrollView style={s.bodyView} contentContainerStyle={s.editList}>
          <Text style={s.editHint}>↑↓ でステップ順変更 / ◇ で分岐追加</Text>
          {editOrdered.map((task, i) => {
            taskCounter += 1;
            const taskBranches = editBranches.filter((b) => b.after_task_id === task.id);
            return (
              <View key={task.id}>
                <View style={s.editTaskRow}>
                  <Text style={s.editHandle}>☰</Text>
                  <View style={s.editStepNo}><Text style={s.editStepNoText}>{taskCounter}</Text></View>
                  <Text style={s.editTaskTitle} numberOfLines={2}>
                    {task.icon ? `${task.icon} ` : ''}{task.title}{task.scheduled_time ? `  (${task.scheduled_time})` : ''}
                  </Text>
                  <TouchableOpacity style={[s.editArrowBtn, i === 0 && s.editArrowDisabled]} onPress={() => moveStep(i, -1)} disabled={i === 0}>
                    <Text style={s.editArrowText}>↑</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[s.editArrowBtn, i === editOrdered.length - 1 && s.editArrowDisabled]} onPress={() => moveStep(i, 1)} disabled={i === editOrdered.length - 1}>
                    <Text style={s.editArrowText}>↓</Text>
                  </TouchableOpacity>
                </View>
                {taskBranches.map((br) => (
                  <View key={br.id} style={s.editBranchRow}>
                    <Text style={s.editBranchIcon}>◇</Text>
                    <View style={s.editBranchBody}>
                      <Text style={s.editBranchQuestion}>{br.question}</Text>
                      <Text style={s.editBranchLabels}>
                        {br.yes_label}{br.yes_text ? `→${br.yes_text}` : ''} / {br.no_label}{br.no_text ? `→${br.no_text}` : ''}
                      </Text>
                    </View>
                    <TouchableOpacity style={s.editBranchActionBtn} onPress={() => openEditBranch(br)}>
                      <Text style={s.editBranchActionText}>✎</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={s.editBranchActionBtn} onPress={() => removeBranch(br.id)}>
                      <Text style={[s.editBranchActionText, { color: '#ef4444' }]}>×</Text>
                    </TouchableOpacity>
                  </View>
                ))}
                <TouchableOpacity style={s.addBranchBtn} onPress={() => openAddBranch(task.id)}>
                  <Text style={{ color: '#7c3aed', fontSize: 14 }}>◇</Text>
                  <Text style={s.addBranchText}>分岐を追加</Text>
                </TouchableOpacity>
              </View>
            );
          })}
        </ScrollView>
      ) : (
        /* ── flowchart view ── */
        <ScrollView style={s.bodyView} contentContainerStyle={s.flowContent}>
          {due.length === 0 ? (
            <View style={s.empty}>
              <Text style={s.emptyTitle}>この日のフローはありません</Text>
              <Text style={s.emptyBody}>頻度がこの日に当たるタスクがワークフローになります</Text>
            </View>
          ) : (
            <>
              <View style={s.terminator}><Text style={s.terminatorText}>開始</Text></View>
              {(() => {
                let tIdx = 0;
                return flowNodes.map((node) => {
                  if (node.type === 'task') {
                    tIdx += 1;
                    const isDone = completedIds.has(node.task.id);
                    return (
                      <View key={`task-${node.task.id}`} style={s.stepWrap}>
                        <Down color={isDone ? C.doneBg : C.line} />
                        <TouchableOpacity style={[s.process, isDone && s.processDone]} onPress={() => toggle(node.task.id)} activeOpacity={0.8}>
                          <View style={[s.stepNo, isDone && s.stepNoDone]}><Text style={s.stepNoText}>{tIdx}</Text></View>
                          <Text style={[s.processText, isDone && s.processTextDone]} numberOfLines={2}>
                            {node.task.icon ? `${node.task.icon} ` : ''}{node.task.title}{node.task.scheduled_time ? `  (${node.task.scheduled_time})` : ''}
                          </Text>
                          {isDone && <Text style={s.processCheck}>✓</Text>}
                        </TouchableOpacity>
                      </View>
                    );
                  }
                  // branch node
                  const br = node.branch;
                  return (
                    <View key={`branch-${br.id}`} style={s.stepWrap}>
                      <Down color={C.line} />
                      <View style={[s.diamond, s.diamondCustom]}>
                        <View style={s.diamondInner}>
                          <Text style={[s.diamondText, s.diamondTextCustom]} numberOfLines={3}>{br.question}</Text>
                        </View>
                      </View>
                      <View style={s.branchRow}>
                        <View style={s.branchCol}>
                          <Text style={[s.branchLabel, { color: '#7c3aed' }]}>{br.yes_label}</Text>
                          <Down color={C.line} h={16} />
                          {br.yes_text ? (
                            <View style={s.outBoxYes}><Text style={s.outYesText}>{br.yes_text}</Text></View>
                          ) : null}
                        </View>
                        <View style={s.branchCol}>
                          <Text style={[s.branchLabel, { color: '#a78bfa' }]}>{br.no_label}</Text>
                          <Down color={C.line} h={16} />
                          {br.no_text ? (
                            <View style={s.outBoxCustomNo}><Text style={s.outCustomNoText}>{br.no_text}</Text></View>
                          ) : null}
                        </View>
                      </View>
                      <View style={s.mergeRailWrap}><View style={s.mergeRail} /></View>
                    </View>
                  );
                });
              })()}
              <Down color={allDone ? C.doneBg : C.line} />
              <View style={[s.diamond, allDone && s.diamondDone]}>
                <View style={s.diamondInner}>
                  <Text style={[s.diamondText, allDone && s.diamondTextDone]}>全部{'\n'}完了?</Text>
                </View>
              </View>
              <View style={s.branchRow}>
                <View style={s.branchCol}>
                  <Text style={[s.branchLabel, { color: C.diaBorder }]}>はい</Text>
                  <Down color={allDone ? C.doneBg : C.line} h={16} />
                  <View style={[s.outBox, allDone && s.outBoxDone]}>
                    <Text style={[s.outText, allDone && s.outTextDone]}>完了 🎉</Text>
                  </View>
                </View>
                <View style={s.branchCol}>
                  <Text style={[s.branchLabel, { color: C.muted }]}>いいえ</Text>
                  <Down color={C.line} h={16} />
                  <View style={[s.outBox, s.outBoxNo]}>
                    <Text style={s.outNoText}>残り {remaining} 件</Text>
                  </View>
                </View>
              </View>
              <View style={s.mergeRailWrap}><View style={s.mergeRail} /></View>
              <Down color={allDone ? C.doneBg : C.line} h={16} />
              <View style={[s.terminator, allDone && s.terminatorDone]}>
                <Text style={[s.terminatorText, allDone && s.terminatorEndText]}>終了</Text>
              </View>
            </>
          )}
        </ScrollView>
      )}

      {/* ── branch edit modal ── */}
      <Modal visible={modal !== null} transparent animationType="slide" onRequestClose={() => setModal(null)}>
        <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={() => setModal(null)}>
          <TouchableOpacity activeOpacity={1} style={s.modalCard} onPress={() => {}}>
            <Text style={s.modalTitle}>{modal?.mode === 'add' ? '分岐を追加' : '分岐を編集'}</Text>

            <Text style={s.modalSection}>◇ 条件（ひし形のテキスト）</Text>
            <TextInput
              style={s.modalInput}
              placeholder="例：全部完了？"
              placeholderTextColor={C.muted}
              value={modal?.question ?? ''}
              onChangeText={(v) => setField('question', v)}
              returnKeyType="next"
            />

            <Text style={s.modalSection}>はい側</Text>
            <View style={s.modalRow}>
              <View style={s.modalHalf}>
                <TextInput style={s.modalInput} placeholder="ラベル" placeholderTextColor={C.muted} value={modal?.yesLabel ?? ''} onChangeText={(v) => setField('yesLabel', v)} />
              </View>
              <View style={s.modalHalf}>
                <TextInput style={s.modalInput} placeholder="テキスト（任意）" placeholderTextColor={C.muted} value={modal?.yesText ?? ''} onChangeText={(v) => setField('yesText', v)} />
              </View>
            </View>

            <Text style={s.modalSection}>いいえ側</Text>
            <View style={s.modalRow}>
              <View style={s.modalHalf}>
                <TextInput style={s.modalInput} placeholder="ラベル" placeholderTextColor={C.muted} value={modal?.noLabel ?? ''} onChangeText={(v) => setField('noLabel', v)} />
              </View>
              <View style={s.modalHalf}>
                <TextInput style={s.modalInput} placeholder="テキスト（任意）" placeholderTextColor={C.muted} value={modal?.noText ?? ''} onChangeText={(v) => setField('noText', v)} />
              </View>
            </View>

            <View style={s.modalActions}>
              <TouchableOpacity style={s.modalCancel} onPress={() => setModal(null)}>
                <Text style={s.modalCancelText}>キャンセル</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.modalOk} onPress={saveBranch}>
                <Text style={s.modalOkText}>保存</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <TabBar current="Flow" navigation={navigation} />
    </View>
  );
}
