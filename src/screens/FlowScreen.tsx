import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, StatusBar, Modal,
  Animated, PanResponder, Platform, TextInput, Alert, GestureResponderEvent,
  useWindowDimensions,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSQLiteContext } from 'expo-sqlite';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { LinearGradient } from 'expo-linear-gradient';
import { RootStackParamList } from '../../App';
import { Task, getToday, getTasks, updateTaskSortOrders, getFlowBranches, addFlowBranch, updateFlowBranch, deleteFlowBranch } from '../db/database';
import { isDueToday, WEEKDAYS } from '../constants/taskMeta';
import { GRAD_START, GRAD_END } from '../constants/theme';
import TabBar from '../components/TabBar';
import { useTheme, ColorSet } from '../contexts/ThemeContext';

const pad = (n: number) => String(n).padStart(2, '0');
type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'Flow'> };
type SimpleItems = { taskIds: number[]; notes: string[] };
type SubBranch = { question: string; yes: SimpleItems; no: SimpleItems; yesReturns: boolean };
type BranchPathData = { taskIds: number[]; notes: string[]; sub?: SubBranch };
type BranchNode = { id: number | null; insertAfterIdx: number; question: string; yes: BranchPathData; no: BranchPathData };

function ArrowDown({ color, h = 18 }: { color: string; h?: number }) {
  return (
    <View style={{ alignItems: 'center', marginVertical: 2 }} pointerEvents="none">
      <View style={{ width: 2, height: h, backgroundColor: color }} />
      <View style={{ width: 0, height: 0, borderLeftWidth: 5, borderRightWidth: 5, borderTopWidth: 8, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: color }} />
    </View>
  );
}

const emptyPath = (): BranchPathData => ({ taskIds: [], notes: [] });
const emptyItems = (): SimpleItems => ({ taskIds: [], notes: [] });
const emptySubBranch = (): SubBranch => ({ question: '', yesReturns: true, yes: emptyItems(), no: emptyItems() });

const parseSimpleItems = (raw: unknown): SimpleItems => ({
  taskIds: Array.isArray((raw as any)?.taskIds) ? (raw as any).taskIds.filter((v: unknown): v is number => typeof v === 'number') : [],
  notes: Array.isArray((raw as any)?.notes) ? (raw as any).notes.filter((v: unknown): v is string => typeof v === 'string' && v.trim().length > 0) : [],
});

const parseBranchPath = (raw: string | null): BranchPathData => {
  if (!raw) return emptyPath();
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return { taskIds: parsed.filter(v => typeof v === 'number'), notes: [] };
    const base: BranchPathData = {
      taskIds: Array.isArray(parsed?.taskIds) ? parsed.taskIds.filter((v: unknown): v is number => typeof v === 'number') : [],
      notes: Array.isArray(parsed?.notes) ? parsed.notes.filter((v: unknown): v is string => typeof v === 'string' && v.trim().length > 0) : [],
    };
    if (parsed?.sub) {
      base.sub = {
        question: typeof parsed.sub.question === 'string' ? parsed.sub.question : '',
        yesReturns: parsed.sub.yesReturns !== false,
        yes: parseSimpleItems(parsed.sub.yes),
        no: parseSimpleItems(parsed.sub.no),
      };
    }
    return base;
  } catch {
    return { taskIds: [], notes: raw.trim() ? [raw.trim()] : [] };
  }
};

const stringifyBranchPath = (path: BranchPathData) => JSON.stringify({
  taskIds: path.taskIds,
  notes: path.notes.map(n => n.trim()).filter(Boolean),
  ...(path.sub ? { sub: {
    question: path.sub.question,
    yesReturns: path.sub.yesReturns,
    yes: { taskIds: path.sub.yes.taskIds, notes: path.sub.yes.notes.map(n => n.trim()).filter(Boolean) },
    no: { taskIds: path.sub.no.taskIds, notes: path.sub.no.notes.map(n => n.trim()).filter(Boolean) },
  }} : {}),
});

const makeStyles = (C: ColorSet) => StyleSheet.create({
  root: { flex: 1, backgroundColor: C.body },

  header: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 16 },
  navRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  navBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  navArrow: { color: '#ffffff', fontSize: 24, fontWeight: '800', marginTop: -2 },
  navCenter: { flex: 1, alignItems: 'center' },
  navDateText: { color: '#ffffff', fontSize: 15, fontWeight: '800' },
  navTodayHint: { color: 'rgba(255,255,255,0.75)', fontSize: 10, fontWeight: '700', marginTop: 1 },
  navRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  editBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.18)' },
  editBtnText: { color: '#ffffff', fontSize: 13, fontWeight: '800' },
  saveBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.9)' },
  saveBtnText: { color: '#7c3aed', fontSize: 13, fontWeight: '900' },

  flowScroll: { flex: 1 },
  flowViewport: { flex: 1, overflow: 'hidden' },

  // ── view mode (compact) ──
  viewContent: { alignItems: 'center', paddingTop: 20, paddingBottom: 24, paddingHorizontal: 40 },
  viewContentZoomed: { paddingHorizontal: 14 },
  flowZoomWrap: { width: '100%', alignItems: 'center' },
  viewTerminator: { backgroundColor: C.termBg, borderWidth: 1.5, borderColor: C.termBorder, borderRadius: 18, paddingHorizontal: 22, paddingVertical: 7 },
  viewTerminatorText: { color: C.termText, fontSize: 12, fontWeight: '800', letterSpacing: 1 },
  viewSlotWrap: { width: '100%' },
  viewSlot: { width: '100%', minHeight: 44, borderWidth: 1.5, borderRadius: 10, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderColor: C.termBorder, backgroundColor: C.termBg },
  viewSlotEmpty: { borderColor: C.border, borderStyle: 'dashed', backgroundColor: C.card },
  viewSlotNum: { width: 20, height: 20, borderRadius: 10, backgroundColor: C.primarySoft, alignItems: 'center', justifyContent: 'center', marginRight: 8, flexShrink: 0 },
  viewSlotNumText: { color: C.primary, fontSize: 10, fontWeight: '800' },
  viewSlotText: { flex: 1, color: C.ink, fontSize: 12, fontWeight: '700', lineHeight: 16 },
  viewSlotEmptyText: { flex: 1, color: C.muted, fontSize: 12 },

  // ── edit mode (full size) ──
  editContent: { alignItems: 'center', paddingTop: 24, paddingBottom: 24, paddingHorizontal: 24 },
  editContentZoomed: { paddingHorizontal: 12 },
  terminator: { backgroundColor: C.termBg, borderWidth: 1.5, borderColor: C.termBorder, borderRadius: 22, paddingHorizontal: 30, paddingVertical: 10 },
  terminatorText: { color: C.termText, fontSize: 14, fontWeight: '800', letterSpacing: 1 },

  slotWrap: { width: '100%', overflow: 'visible' },
  slotBase: { width: '100%', minHeight: 60, borderWidth: 2, borderRadius: 12, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12 },
  slotEmpty: { borderColor: C.border, borderStyle: 'dashed', backgroundColor: C.card },
  slotTarget: { borderColor: '#7c3aed', borderStyle: 'solid', backgroundColor: '#ede9fe' },
  slotFilled: { borderColor: C.termBorder, borderStyle: 'solid', backgroundColor: C.termBg },
  slotFilledTarget: { borderColor: '#7c3aed', borderStyle: 'solid', backgroundColor: C.termBg },
  slotDragging: { opacity: 0.55, borderColor: '#7c3aed', borderStyle: 'dashed' },
  slotNum: { width: 26, height: 26, borderRadius: 13, backgroundColor: C.primarySoft, alignItems: 'center', justifyContent: 'center', marginRight: 10, flexShrink: 0 },
  slotNumText: { color: C.primary, fontSize: 12, fontWeight: '800' },
  slotEmptyText: { flex: 1, color: 'rgba(100,116,139,0.48)', fontSize: 13, fontWeight: '500' },
  slotCardArea: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  slotCardText: { flex: 1, color: C.ink, fontSize: 13, fontWeight: '700', lineHeight: 17 },
  slotRemoveBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#fef2f2', borderWidth: 1, borderColor: '#fca5a5', alignItems: 'center', justifyContent: 'center', marginLeft: 6 },
  slotRemoveText: { color: '#dc2626', fontSize: 16, fontWeight: '700', lineHeight: 20 },
  dragHandle: { paddingHorizontal: 8, paddingVertical: 10, marginLeft: -4, marginRight: 4 },
  dragHandleText: { color: C.muted, fontSize: 16 },

  emptyFlow: { paddingTop: 60, alignItems: 'center', gap: 10 },
  emptyTitle: { color: C.ink, fontSize: 16, fontWeight: '700' },
  emptyBody: { color: C.muted, fontSize: 13, textAlign: 'center', paddingHorizontal: 24 },
  addFirstBtn: { marginTop: 8, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12, backgroundColor: '#7c3aed' },
  addFirstBtnText: { color: '#ffffff', fontSize: 14, fontWeight: '800' },

  tray: { borderTopWidth: 1, borderTopColor: C.grid, backgroundColor: C.card, paddingVertical: 10 },
  trayHint: { color: '#7c3aed', fontSize: 11, fontWeight: '700', paddingHorizontal: 16, marginBottom: 6 },
  trayLabel: { color: C.muted, fontSize: 11, fontWeight: '700', paddingHorizontal: 16, marginBottom: 6 },
  trayScroll: { paddingHorizontal: 12, paddingVertical: 2 },
  card: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, backgroundColor: C.body, borderWidth: 1.5, borderColor: C.border, marginHorizontal: 4, maxWidth: 150 },
  cardSelected: { borderColor: '#7c3aed', backgroundColor: '#ede9fe' },
  cardText: { color: C.ink, fontSize: 13, fontWeight: '700', textAlign: 'center' },
  cardTextSelected: { color: '#4c1d95' },
  addBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, backgroundColor: '#7c3aed', marginHorizontal: 4 },
  addBtnText: { color: '#ffffff', fontSize: 13, fontWeight: '800' },

  pickerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  pickerSheet: { backgroundColor: C.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '75%' },
  pickerHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: C.grid },
  pickerTitle: { flex: 1, color: C.ink, fontSize: 16, fontWeight: '800' },
  pickerDone: { color: '#7c3aed', fontSize: 15, fontWeight: '800' },
  pickerRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: C.grid, gap: 14 },
  pickerRowAdded: { backgroundColor: '#ede9fe' },
  pickerRowText: { flex: 1, color: C.ink, fontSize: 15, fontWeight: '600' },
  pickerRowTextAdded: { color: '#4c1d95', fontWeight: '700' },
  pickerCheck: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  pickerCheckOn: { backgroundColor: '#7c3aed', borderColor: '#7c3aed' },
  pickerCheckText: { color: '#ffffff', fontSize: 14, fontWeight: '900' },
  pickerEmpty: { padding: 40, alignItems: 'center' },
  pickerEmptyText: { color: C.muted, fontSize: 14 },

  editCard: { marginTop: 20, width: '100%', paddingVertical: 16, borderRadius: 14, borderWidth: 1.5, borderColor: C.primary, backgroundColor: C.primarySoft, alignItems: 'center', justifyContent: 'center' },
  editCardText: { color: C.primary, fontSize: 14, fontWeight: '800', letterSpacing: 0.5 },
  datePickerSheet: { backgroundColor: C.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 24 },

  // ── branch button in header ──
  branchBtn: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.18)' },
  branchBtnText: { color: '#ffffff', fontSize: 11, fontWeight: '800' },
  branchBtnActive: { backgroundColor: 'rgba(255,237,213,0.9)' },
  branchBtnActiveText: { color: '#c2410c', fontSize: 11, fontWeight: '900' },

  // ── branch insertion slot ──
  insertSlot: { width: '100%', paddingVertical: 9, borderWidth: 1.5, borderColor: '#fb923c', borderStyle: 'dashed', borderRadius: 10, alignItems: 'center', backgroundColor: '#fff7ed' },
  insertSlotText: { color: 'rgba(194,65,12,0.5)', fontSize: 12, fontWeight: '600' },
  gapWrap: { width: '100%', overflow: 'visible' },

  // ── branch node (edit) ──
  branchNode: { width: '100%', alignItems: 'center', paddingVertical: 2, overflow: 'visible' },
  branchFlow: { width: '100%', minHeight: 200, alignItems: 'center', position: 'relative', overflow: 'visible' },
  branchMainColumn: { width: 262, alignItems: 'center', zIndex: 2 },
  branchDiamondShell: { width: 262, height: 108, alignItems: 'center', position: 'relative' },
  branchDiamond: { width: 260, height: 80, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  branchDiamondTop: { position: 'absolute', top: 1, width: 0, height: 0, borderLeftWidth: 129, borderRightWidth: 129, borderBottomWidth: 39, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: '#fffbeb' },
  branchDiamondBottom: { position: 'absolute', bottom: 1, width: 0, height: 0, borderLeftWidth: 129, borderRightWidth: 129, borderTopWidth: 39, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: '#fffbeb' },
  branchDiamondEdgeTL: { position: 'absolute', left: -3, top: 19, width: 136, height: 2, backgroundColor: C.line, transform: [{ rotate: '-17.1deg' }], zIndex: 2 },
  branchDiamondEdgeTR: { position: 'absolute', left: 127, top: 19, width: 136, height: 2, backgroundColor: C.line, transform: [{ rotate: '17.1deg' }], zIndex: 2 },
  branchDiamondEdgeBR: { position: 'absolute', left: 127, top: 59, width: 136, height: 2, backgroundColor: C.line, transform: [{ rotate: '-17.1deg' }], zIndex: 2 },
  branchDiamondEdgeBL: { position: 'absolute', left: -3, top: 59, width: 136, height: 2, backgroundColor: C.line, transform: [{ rotate: '17.1deg' }], zIndex: 2 },
  branchDiamondSeamCover: { position: 'absolute', top: 39, left: 12, right: 12, height: 3, backgroundColor: '#fffbeb', zIndex: 1 },
  branchDiamondInner: { width: 180, alignItems: 'center', justifyContent: 'center', zIndex: 2 },
  branchNodeHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 6 },
  branchNodeQ: { color: '#78350f', fontSize: 12, fontWeight: '800', textAlign: 'center' },
  branchNodeBtns: { position: 'absolute', bottom: 0, flexDirection: 'row', alignItems: 'center', gap: 6 },
  branchEditBtn: { minWidth: 46, height: 24, paddingHorizontal: 10, borderRadius: 12, backgroundColor: '#fef3c7', borderWidth: 1, borderColor: '#d97706', alignItems: 'center', justifyContent: 'center' },
  branchEditBtnText: { color: '#92400e', fontSize: 11, fontWeight: '700' },
  branchDelBtn: { minWidth: 28, height: 24, paddingHorizontal: 8, borderRadius: 12, backgroundColor: '#fef2f2', borderWidth: 1, borderColor: '#fca5a5', alignItems: 'center', justifyContent: 'center' },
  branchDelBtnText: { color: '#dc2626', fontSize: 13, fontWeight: '700', lineHeight: 16 },
  branchYesWrap: { width: 58, height: 140, alignItems: 'center', justifyContent: 'flex-start', position: 'relative' },
  branchYesLine: { width: 2, height: 140, backgroundColor: C.line, marginTop: 0 },
  branchYesLabel: { position: 'absolute', right: 34, top: 12, color: C.line, fontSize: 11, fontWeight: '900', backgroundColor: C.body, paddingHorizontal: 4 },
  branchYesItems: { width: 152, alignItems: 'center', gap: 5, display: 'none' },
  branchNoRoute: { position: 'absolute', top: 40, left: '50%', right: -86, height: 150, zIndex: 1 },
  branchNoRail: { position: 'absolute', top: 0, left: 0, right: 54, height: 150, borderTopWidth: 2, borderRightWidth: 2, borderBottomWidth: 2, borderColor: C.line },
  branchNoRailReturnless: { borderBottomWidth: 0 },
  branchNoMergeLine: { display: 'none' },
  branchNoLabel: { position: 'absolute', top: -20, left: 165, color: C.line, fontSize: 11, fontWeight: '900', backgroundColor: C.body, paddingHorizontal: 4 },
  branchNoItems: { position: 'absolute', top: 30, right: -30, width: 168, alignItems: 'stretch', gap: 6 },
  branchPathTask: { width: 168, minHeight: 44, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, borderWidth: 1.5, borderColor: C.line, backgroundColor: '#fff' },
  branchPathNote: { width: 168, minHeight: 44, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, borderWidth: 1.5, borderColor: C.line, backgroundColor: '#fff' },
  branchPathTaskText: { color: C.ink, fontSize: 12, fontWeight: '700', textAlign: 'center', lineHeight: 16 },
  branchPathNoteText: { color: C.ink, fontSize: 12, fontWeight: '700', textAlign: 'center', lineHeight: 16 },
  branchPathEmpty: { color: '#d97706', fontSize: 11, fontStyle: 'italic' },

  // ── branch node (view) ──
  viewBranch: { width: '100%', alignItems: 'center', paddingVertical: 2, overflow: 'visible' },
  viewBranchFlow: { width: '100%', minHeight: 184, alignItems: 'center', position: 'relative', overflow: 'visible' },
  viewBranchMainColumn: { width: 204, alignItems: 'center', zIndex: 2 },
  viewBranchDiamond: { width: 200, height: 60, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  viewBranchDiamondTop: { position: 'absolute', top: 1, width: 0, height: 0, borderLeftWidth: 99, borderRightWidth: 99, borderBottomWidth: 29, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: '#fffbeb' },
  viewBranchDiamondBottom: { position: 'absolute', bottom: 1, width: 0, height: 0, borderLeftWidth: 99, borderRightWidth: 99, borderTopWidth: 29, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: '#fffbeb' },
  viewBranchDiamondEdgeTL: { position: 'absolute', left: -2, top: 14, width: 104, height: 1.5, backgroundColor: C.line, transform: [{ rotate: '-16.7deg' }], zIndex: 2 },
  viewBranchDiamondEdgeTR: { position: 'absolute', left: 98, top: 14, width: 104, height: 1.5, backgroundColor: C.line, transform: [{ rotate: '16.7deg' }], zIndex: 2 },
  viewBranchDiamondEdgeBR: { position: 'absolute', left: 98, top: 44, width: 104, height: 1.5, backgroundColor: C.line, transform: [{ rotate: '-16.7deg' }], zIndex: 2 },
  viewBranchDiamondEdgeBL: { position: 'absolute', left: -2, top: 44, width: 104, height: 1.5, backgroundColor: C.line, transform: [{ rotate: '16.7deg' }], zIndex: 2 },
  viewBranchDiamondSeamCover: { position: 'absolute', top: 29, left: 8, right: 8, height: 3, backgroundColor: '#fffbeb', zIndex: 1 },
  viewBranchDiamondInner: { width: 148, alignItems: 'center', justifyContent: 'center', zIndex: 2 },
  viewBranchQ: { color: '#78350f', fontSize: 11, fontWeight: '800', textAlign: 'center' },
  viewBranchYesWrap: { width: 50, height: 120, alignItems: 'center', justifyContent: 'flex-start', position: 'relative' },
  viewBranchYesLine: { width: 1.5, height: 120, backgroundColor: C.line, marginTop: 0 },
  viewBranchLabel: { position: 'absolute', right: 30, top: 10, color: C.line, fontSize: 10, fontWeight: '900', backgroundColor: C.body, paddingHorizontal: 4 },
  viewBranchYesItems: { width: 128, alignItems: 'center', gap: 4, display: 'none' },
  viewBranchNoRoute: { position: 'absolute', top: 30, left: '50%', right: -70, height: 122, zIndex: 1 },
  viewBranchNoRail: { position: 'absolute', top: 0, left: 0, right: 51, height: 122, borderTopWidth: 2, borderRightWidth: 2, borderBottomWidth: 2, borderColor: C.line },
  viewBranchNoRailReturnless: { borderBottomWidth: 0 },
  viewBranchNoMergeLine: { display: 'none' },
  viewBranchNoLabel: { position: 'absolute', top: -18, left: 123, color: C.line, fontSize: 10, fontWeight: '900', backgroundColor: C.body, paddingHorizontal: 4 },
  viewBranchNoItems: { position: 'absolute', top: 24, right: -24, width: 150, alignItems: 'stretch', gap: 5 },
  viewBranchTaskBox: { width: 150, minHeight: 38, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 7, borderWidth: 1.5, borderColor: C.line, backgroundColor: '#fff' },
  viewBranchNoteBox: { width: 150, minHeight: 38, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 7, borderWidth: 1.5, borderColor: C.line, backgroundColor: '#fff' },
  viewBranchTask: { color: C.ink, fontSize: 11, fontWeight: '700', textAlign: 'center', lineHeight: 15 },
  viewBranchNote: { color: C.ink, fontSize: 11, fontWeight: '700', textAlign: 'center', lineHeight: 15 },

  // ── sub-branch (nested in no-path) ──
  subBranchWrap: { marginTop: 8, width: '100%', alignItems: 'center' },
  subDiamondShell: { width: 176, height: 60, alignItems: 'center', justifyContent: 'flex-start', position: 'relative' },
  subDiamond: { width: 130, height: 40, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  subDiamondTop: { position: 'absolute', top: 1, width: 0, height: 0, borderLeftWidth: 64, borderRightWidth: 64, borderBottomWidth: 19, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: '#fffbeb' },
  subDiamondBottom: { position: 'absolute', bottom: 1, width: 0, height: 0, borderLeftWidth: 64, borderRightWidth: 64, borderTopWidth: 19, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: '#fffbeb' },
  subDiamondEdgeTL: { position: 'absolute', left: -2, top: 9, width: 68, height: 2, backgroundColor: C.line, transform: [{ rotate: '-16.7deg' }], zIndex: 2 },
  subDiamondEdgeTR: { position: 'absolute', left: 62, top: 9, width: 68, height: 2, backgroundColor: C.line, transform: [{ rotate: '16.7deg' }], zIndex: 2 },
  subDiamondEdgeBR: { position: 'absolute', left: 62, top: 29, width: 68, height: 2, backgroundColor: C.line, transform: [{ rotate: '-16.7deg' }], zIndex: 2 },
  subDiamondEdgeBL: { position: 'absolute', left: -2, top: 29, width: 68, height: 2, backgroundColor: C.line, transform: [{ rotate: '16.7deg' }], zIndex: 2 },
  subDiamondSC: { position: 'absolute', top: 19, left: 6, right: 6, height: 3, backgroundColor: '#fffbeb', zIndex: 1 },
  subDiamondInner: { width: 96, alignItems: 'center', justifyContent: 'center', zIndex: 2 },
  subDiamondQ: { color: '#78350f', fontSize: 9, fontWeight: '800', textAlign: 'center' },
  subYesReturnLine: { position: 'absolute', left: -126, top: 20, width: 126, height: 2, backgroundColor: C.line, zIndex: 1 },
  subYesReturnLabel: { position: 'absolute', left: -62, top: 4, color: C.line, fontSize: 9, fontWeight: '900', backgroundColor: C.body, paddingHorizontal: 5, zIndex: 3 },
  subDiamondBtns: { position: 'absolute', bottom: 0, flexDirection: 'row', alignItems: 'center', gap: 6 },
  subEditBtn: { minWidth: 42, height: 22, paddingHorizontal: 9, borderRadius: 11, backgroundColor: '#fef3c7', borderWidth: 1, borderColor: '#d97706', alignItems: 'center', justifyContent: 'center' },
  subEditBtnText: { color: '#92400e', fontSize: 10, fontWeight: '700' },
  subDelBtn: { minWidth: 28, height: 22, paddingHorizontal: 7, borderRadius: 11, backgroundColor: '#fef2f2', borderWidth: 1, borderColor: '#fca5a5', alignItems: 'center', justifyContent: 'center' },
  subDelBtnText: { color: '#dc2626', fontSize: 12, fontWeight: '700', lineHeight: 14 },
  subPaths: { flexDirection: 'row', marginTop: 4, width: 130, position: 'relative' },
  subPathsNoReturn: { width: 68, alignSelf: 'flex-end', justifyContent: 'flex-end' },
  subYesCol: { flex: 1, alignItems: 'center', paddingHorizontal: 3 },
  subNoCol: { flex: 1, alignItems: 'center', paddingHorizontal: 3 },
  subPathDiv: { width: 1, backgroundColor: C.line, alignSelf: 'stretch', marginVertical: 2 },
  subPathYesLbl: { color: C.line, fontSize: 9, fontWeight: '900', marginBottom: 3 },
  subPathNoLbl: { color: C.line, fontSize: 9, fontWeight: '900', marginBottom: 3 },
  subItemBox: { backgroundColor: '#f0fdf4', borderWidth: 1, borderColor: '#22c55e', borderRadius: 5, paddingHorizontal: 4, paddingVertical: 3, marginBottom: 3, width: '100%', alignItems: 'center' },
  subItemText: { color: '#166534', fontSize: 9, fontWeight: '700', textAlign: 'center' },
  subItemEmpty: { color: C.muted, fontSize: 9, fontStyle: 'italic', textAlign: 'center' },
  subAddBtn: { marginTop: 10, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#fb923c', alignItems: 'center', backgroundColor: '#fff7ed' },
  subAddBtnText: { color: '#c2410c', fontSize: 11, fontWeight: '700' },
  subRemoveBtn: { marginTop: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: '#fef2f2', borderWidth: 1, borderColor: '#fca5a5', alignItems: 'center', alignSelf: 'flex-end' },
  subRemoveBtnText: { color: '#dc2626', fontSize: 11, fontWeight: '700' },

  // ── no-route insert slots ──
  noInsertSlot: { paddingVertical: 7, borderWidth: 1.5, borderColor: '#fb923c', borderStyle: 'dashed', borderRadius: 8, alignItems: 'center', backgroundColor: '#fff7ed' },
  noInsertSlotText: { color: '#c2410c', fontSize: 11, fontWeight: '700' },

  // ── branch editor modal ──
  branchEditorSheet: { backgroundColor: C.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '85%' },
  branchEditorSection: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 6 },
  branchEditorLabel: { color: C.muted, fontSize: 11, fontWeight: '800', letterSpacing: 0.5, marginBottom: 6 },
  branchEditorInput: { borderWidth: 1.5, borderColor: C.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, color: C.ink, backgroundColor: C.body },
  branchNoteAddRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  branchNoteInput: { flex: 1, borderWidth: 1.5, borderColor: C.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, color: C.ink, backgroundColor: C.body },
  branchNoteAddBtn: { paddingHorizontal: 13, paddingVertical: 10, borderRadius: 10, backgroundColor: '#d97706' },
  branchNoteAddText: { color: '#ffffff', fontSize: 12, fontWeight: '800' },
  branchNoteList: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  branchNoteChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: '#fb923c', backgroundColor: '#fff7ed' },
  branchNoteChipText: { color: '#9a3412', fontSize: 12, fontWeight: '700', maxWidth: 180 },
  branchNoteChipX: { color: '#dc2626', fontSize: 13, fontWeight: '900' },
  branchTaskRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.grid, gap: 8 },
  branchTaskText: { flex: 1, color: C.ink, fontSize: 14, fontWeight: '600' },
  branchCheckY: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: '#16a34a', alignItems: 'center', justifyContent: 'center' },
  branchCheckYOn: { backgroundColor: '#16a34a' },
  branchCheckN: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: '#dc2626', alignItems: 'center', justifyContent: 'center' },
  branchCheckNOn: { backgroundColor: '#dc2626' },
  branchCheckText: { color: '#ffffff', fontSize: 13, fontWeight: '900' },
  branchCheckLabels: { flexDirection: 'row', gap: 4, alignItems: 'center' },
  branchCheckLabelY: { color: '#15803d', fontSize: 10, fontWeight: '700', width: 28, textAlign: 'center' },
  branchCheckLabelN: { color: '#b91c1c', fontSize: 10, fontWeight: '700', width: 28, textAlign: 'center' },
  branchSaveBtn: { margin: 16, paddingVertical: 14, borderRadius: 12, backgroundColor: '#d97706', alignItems: 'center' },
  branchSaveBtnText: { color: '#ffffff', fontSize: 15, fontWeight: '800' },
});

export default function FlowScreen({ navigation }: Props) {
  const db = useSQLiteContext();
  const insets = useSafeAreaInsets();
  const { width: viewportWidth } = useWindowDimensions();
  const { C, grad } = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  const today = getToday();

  const [selectedDate, setSelectedDate] = useState(today);
  const [dueTasks, setDueTasks] = useState<Task[]>([]);
  const [addedIds, setAddedIds] = useState<number[]>([]);
  const [slots, setSlots] = useState<(number | null)[]>([]);
  const [selectedCardId, setSelectedCardId] = useState<number | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [branches, setBranches] = useState<BranchNode[]>([]);
  const [insertBranchMode, setInsertBranchMode] = useState(false);
  const [branchEditorOpen, setBranchEditorOpen] = useState(false);
  const [branchDraft, setBranchDraft] = useState<BranchNode | null>(null);
  const [branchNoteDraft, setBranchNoteDraft] = useState({ yes: '', no: '' });
  const [subNoteDraft, setSubNoteDraft] = useState({ yes: '', no: '' });
  const [noRouteBranchEditorOpen, setNoRouteBranchEditorOpen] = useState(false);
  const [noRouteBranchParent, setNoRouteBranchParent] = useState<BranchNode | null>(null);
  const [noRouteSubDraft, setNoRouteSubDraft] = useState<SubBranch | null>(null);
  const [noRouteSubNoteDraft, setNoRouteSubNoteDraft] = useState({ yes: '', no: '' });
  const [manualFlowScale, setManualFlowScale] = useState<number | null>(null);
  const [isPinching, setIsPinching] = useState(false);

  // ── drag-to-reorder state ──
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);
  const draggingIdxRef = useRef<number | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const hoverIdxRef = useRef<number | null>(null);
  const dragY = useRef(new Animated.Value(0)).current;
  const dragScale = useRef(new Animated.Value(1)).current;
  const shiftAnims = useRef<Animated.Value[]>([]);
  const slotHRef = useRef(80);
  const slotsRef = useRef(slots);
  const panRespMap = useRef<Map<number, ReturnType<typeof PanResponder.create>>>(new Map());
  const pinchStartDistanceRef = useRef<number | null>(null);
  const pinchStartScaleRef = useRef(1);
  const flowPan = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const flowPanOffsetRef = useRef({ x: 0, y: 0 });

  slotsRef.current = slots;

  while (shiftAnims.current.length < slots.length) shiftAnims.current.push(new Animated.Value(0));
  if (shiftAnims.current.length > slots.length) shiftAnims.current = shiftAnims.current.slice(0, slots.length);

  useEffect(() => { panRespMap.current.clear(); }, [slots.length]);

  const isToday = selectedDate === today;
  const selDateObj = useMemo(() => new Date(`${selectedDate}T00:00:00`), [selectedDate]);
  const dateLabel = `${selDateObj.getFullYear()}/${pad(selDateObj.getMonth() + 1)}/${pad(selDateObj.getDate())} (${WEEKDAYS[selDateObj.getDay()]})`;

  const shiftSelected = (days: number) => {
    const d = new Date(`${selectedDate}T00:00:00`);
    d.setDate(d.getDate() + days);
    setSelectedDate(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
  };

  const load = useCallback(async () => {
    const ts = await getTasks(db);
    const due = ts.filter(t => isDueToday(t, new Date(`${selectedDate}T00:00:00`)));
    const sorted = [...due].sort((a, b) =>
      a.sort_order !== b.sort_order ? a.sort_order - b.sort_order : a.id - b.id
    );
    setDueTasks(due);
    const ids = sorted.map(t => t.id);
    setAddedIds(ids);
    setSlots([...ids]);
    setSelectedCardId(null);
    setIsEditing(false);
    setInsertBranchMode(false);
    panRespMap.current.clear();
    const branchRows = await getFlowBranches(db);
    setBranches(branchRows.map(b => ({
      id: b.id,
      insertAfterIdx: b.after_task_id ?? -1,
      question: b.question,
      yes: parseBranchPath(b.yes_text),
      no: parseBranchPath(b.no_text),
    })));
  }, [db, selectedDate]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const taskById = useMemo(() => new Map(dueTasks.map(t => [t.id, t])), [dueTasks]);
  const tray = useMemo(() => addedIds.filter(id => !slots.includes(id)), [addedIds, slots]);
  const hasSelection = selectedCardId !== null;
  const hasSideBranch = useMemo(
    () => branches.some(b => b.no.notes.length > 0 || b.no.taskIds.length > 0),
    [branches]
  );
  const autoFlowScale = hasSideBranch ? 0.82 : 1;
  const flowScale = manualFlowScale ?? autoFlowScale;
  const flowLaneWidth = Math.max(
    280,
    Math.min(viewportWidth - (isEditing ? 48 : 80), isEditing ? 420 : 360)
  );
  const flowCanvasWidth = flowLaneWidth + (hasSideBranch ? (isEditing ? 280 : 240) : 0);
  const flowContentStyle = [
    isEditing ? s.editContent : s.viewContent,
    hasSideBranch && (isEditing ? s.editContentZoomed : s.viewContentZoomed),
  ];
  useEffect(() => {
    setManualFlowScale(null);
    flowPan.setValue({ x: 0, y: 0 });
    flowPanOffsetRef.current = { x: 0, y: 0 };
  }, [selectedDate, flowPan]);
  const getPinchDistance = (e: GestureResponderEvent) => {
    const touches = e.nativeEvent.touches;
    if (touches.length < 2) return null;
    const [a, b] = touches;
    return Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
  };

  const startPinch = (e: GestureResponderEvent) => {
    const distance = getPinchDistance(e);
    if (!distance) return;
    pinchStartDistanceRef.current = distance;
    pinchStartScaleRef.current = flowScale;
    setIsPinching(true);
  };

  const movePinch = (e: GestureResponderEvent) => {
    const startDistance = pinchStartDistanceRef.current;
    const distance = getPinchDistance(e);
    if (!startDistance || !distance) return;
    const nextScale = Math.max(0.58, Math.min(1.35, pinchStartScaleRef.current * (distance / startDistance)));
    setManualFlowScale(nextScale);
  };

  const endPinch = () => {
    pinchStartDistanceRef.current = null;
    setIsPinching(false);
  };

  const flowPanResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => (
      draggingIdxRef.current === null &&
      !isPinching &&
      (Math.abs(gesture.dx) > 4 || Math.abs(gesture.dy) > 4)
    ),
    onPanResponderGrant: () => {
      flowPan.stopAnimation((value: any) => {
        flowPanOffsetRef.current = { x: value.x, y: value.y };
      });
    },
    onPanResponderMove: (_, gesture) => {
      flowPan.setValue({
        x: flowPanOffsetRef.current.x + gesture.dx,
        y: flowPanOffsetRef.current.y + gesture.dy,
      });
    },
    onPanResponderRelease: (_, gesture) => {
      flowPanOffsetRef.current = {
        x: flowPanOffsetRef.current.x + gesture.dx,
        y: flowPanOffsetRef.current.y + gesture.dy,
      };
    },
    onPanResponderTerminate: (_, gesture) => {
      flowPanOffsetRef.current = {
        x: flowPanOffsetRef.current.x + gesture.dx,
        y: flowPanOffsetRef.current.y + gesture.dy,
      };
    },
  }), [flowPan, isPinching]);

  const getSlotPan = useCallback((slotIdx: number) => {
    if (panRespMap.current.has(slotIdx)) return panRespMap.current.get(slotIdx)!;

    const pan = PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, { dy }) => Math.abs(dy) > 5,
      onPanResponderGrant: () => {
        draggingIdxRef.current = slotIdx;
        setDraggingIdx(slotIdx);
        hoverIdxRef.current = slotIdx;
        setHoverIdx(slotIdx);
        dragY.setValue(0);
        dragScale.setValue(1.04);
        shiftAnims.current.forEach(a => a.setValue(0));
      },
      onPanResponderMove: (_, { dy }) => {
        dragY.setValue(dy);
        const n = slotsRef.current.length;
        const slotH = slotHRef.current;
        const newHover = Math.max(0, Math.min(n - 1, slotIdx + Math.round(dy / slotH)));
        if (newHover !== hoverIdxRef.current) {
          hoverIdxRef.current = newHover;
          setHoverIdx(newHover);
          shiftAnims.current.forEach((anim, i) => {
            if (i === slotIdx) return;
            let shift = 0;
            if (newHover > slotIdx && i > slotIdx && i <= newHover) shift = -slotH;
            else if (newHover < slotIdx && i < slotIdx && i >= newHover) shift = slotH;
            Animated.spring(anim, { toValue: shift, useNativeDriver: true, tension: 300, friction: 25 }).start();
          });
        }
      },
      onPanResponderRelease: (_, { dy }) => {
        const from = slotIdx;
        const n = slotsRef.current.length;
        const slotH = slotHRef.current;
        const to = Math.max(0, Math.min(n - 1, from + Math.round(dy / slotH)));
        const snapDy = (to - from) * slotH;

        Animated.parallel([
          Animated.spring(dragY, { toValue: snapDy, useNativeDriver: true, tension: 220, friction: 14 }),
          Animated.spring(dragScale, { toValue: 1, useNativeDriver: true, tension: 220, friction: 14 }),
          ...shiftAnims.current.map(a =>
            Animated.spring(a, { toValue: 0, useNativeDriver: true, tension: 220, friction: 14 })
          ),
        ]).start(() => {
          dragY.setValue(0);
          dragScale.setValue(1);
          shiftAnims.current.forEach(a => a.setValue(0));
          draggingIdxRef.current = null;
          hoverIdxRef.current = null;
          setDraggingIdx(null);
          setHoverIdx(null);
          if (from !== to) {
            panRespMap.current.clear();
            setSlots(prev => {
              const arr = [...prev];
              const [item] = arr.splice(from, 1);
              arr.splice(to, 0, item);
              return arr;
            });
          }
        });
      },
      onPanResponderTerminate: () => {
        dragY.setValue(0);
        dragScale.setValue(1);
        shiftAnims.current.forEach(a => a.setValue(0));
        draggingIdxRef.current = null;
        hoverIdxRef.current = null;
        setDraggingIdx(null);
        setHoverIdx(null);
      },
    });

    panRespMap.current.set(slotIdx, pan);
    return pan;
  }, []);

  const togglePicker = (id: number) => {
    if (addedIds.includes(id)) {
      setAddedIds(prev => prev.filter(x => x !== id));
      setSlots(prev => {
        const idx = prev.indexOf(id);
        if (idx >= 0) return [...prev.slice(0, idx), ...prev.slice(idx + 1)];
        for (let i = prev.length - 1; i >= 0; i--) {
          if (prev[i] === null) return [...prev.slice(0, i), ...prev.slice(i + 1)];
        }
        return prev.slice(0, -1);
      });
      if (selectedCardId === id) setSelectedCardId(null);
    } else {
      setAddedIds(prev => [...prev, id]);
      setSlots(prev => [...prev, null]);
    }
  };

  const tapCard = (id: number) => {
    setSelectedCardId(prev => prev === id ? null : id);
  };

  const tapSlot = (idx: number) => {
    if (draggingIdxRef.current !== null) return;
    if (selectedCardId === null) return;
    setSlots(prev => prev.map((sv, i) => {
      if (i === idx) return selectedCardId;
      if (sv === selectedCardId) return null;
      return sv;
    }));
    setSelectedCardId(null);
  };

  const removeFromSlot = (idx: number) => {
    if (draggingIdxRef.current !== null) return;
    setSlots(prev => prev.map((sv, i) => i === idx ? null : sv));
  };

  const saveOrder = async () => {
    setSaving(true);
    try {
      const placedIds = slots.filter((id): id is number => id !== null);
      const trayIds = addedIds.filter(id => !slots.includes(id));
      await updateTaskSortOrders(db, [...placedIds, ...trayIds]);
      setIsEditing(false);
      setInsertBranchMode(false);
      setSelectedCardId(null);
    } finally {
      setSaving(false);
    }
  };

  const openBranchEditor = (afterIdx: number) => {
    setBranchDraft({ id: null, insertAfterIdx: afterIdx, question: '', yes: emptyPath(), no: emptyPath() });
    setBranchNoteDraft({ yes: '', no: '' });
    setBranchEditorOpen(true);
  };
  const editBranch = (b: BranchNode) => {
    setBranchDraft({ id: b.id, insertAfterIdx: b.insertAfterIdx, question: b.question, yes: { ...b.yes }, no: { ...b.no } });
    setBranchNoteDraft({ yes: '', no: '' });
    setSubNoteDraft({ yes: '', no: '' });
    setBranchEditorOpen(true);
  };
  const openNoRouteBranchEditor = (b: BranchNode) => {
    setNoRouteBranchParent(b);
    setNoRouteSubDraft(b.no.sub ? { ...b.no.sub, yes: { ...b.no.sub.yes }, no: { ...b.no.sub.no } } : emptySubBranch());
    setNoRouteSubNoteDraft({ yes: '', no: '' });
    setNoRouteBranchEditorOpen(true);
  };
  const closeNoRouteBranchEditor = () => {
    setNoRouteBranchEditorOpen(false);
    setNoRouteBranchParent(null);
    setNoRouteSubDraft(null);
    setNoRouteSubNoteDraft({ yes: '', no: '' });
  };
  const saveNoRouteBranchDraft = async () => {
    if (!noRouteBranchParent || !noRouteSubDraft || noRouteBranchParent.id === null) return;
    const updated: BranchNode = {
      ...noRouteBranchParent,
      no: { ...noRouteBranchParent.no, sub: noRouteSubDraft },
    };
    const data = {
      after_task_id: updated.insertAfterIdx,
      question: updated.question || '確認',
      yes_label: 'はい', yes_text: stringifyBranchPath(updated.yes),
      no_label: 'いいえ', no_text: stringifyBranchPath(updated.no),
      branch_side: 'left' as const,
    };
    await updateFlowBranch(db, noRouteBranchParent.id, data);
    setBranches(prev => prev.map(b => b.id === noRouteBranchParent.id ? updated : b));
    closeNoRouteBranchEditor();
  };
  const deleteNoRouteSubBranch = async (parent: BranchNode) => {
    if (parent.id === null) return;
    const updated: BranchNode = {
      ...parent,
      no: { ...parent.no, sub: undefined },
    };
    const data = {
      after_task_id: updated.insertAfterIdx,
      question: updated.question || '確認',
      yes_label: 'はい', yes_text: stringifyBranchPath(updated.yes),
      no_label: 'いいえ', no_text: stringifyBranchPath(updated.no),
      branch_side: 'left' as const,
    };
    await updateFlowBranch(db, parent.id, data);
    setBranches(prev => prev.map(b => b.id === parent.id ? updated : b));
    if (noRouteBranchParent?.id === parent.id) closeNoRouteBranchEditor();
  };
  const deleteBranch = async (id: number) => {
    await deleteFlowBranch(db, id);
    setBranches(prev => prev.filter(b => b.id !== id));
  };
  const saveBranchDraft = async () => {
    if (!branchDraft) return;
    const hasTaskBelow = slots.slice(branchDraft.insertAfterIdx + 1).some(id => id !== null);
    const hasNoRoute = branchDraft.no.notes.length > 0 || branchDraft.no.taskIds.length > 0 || !!branchDraft.no.sub;
    if (!hasTaskBelow) {
      Alert.alert('下にタスクが必要です', '分岐は、下に進むタスクがある場所に置いてください。');
      return;
    }
    if (!hasNoRoute) {
      Alert.alert('右に出るものが必要です', 'いいえの横に出す小カードかタスクを追加してください。');
      return;
    }
    const data = {
      after_task_id: branchDraft.insertAfterIdx,
      question: branchDraft.question || '確認',
      yes_label: 'はい', yes_text: stringifyBranchPath(branchDraft.yes),
      no_label: 'いいえ', no_text: stringifyBranchPath(branchDraft.no),
      branch_side: 'left' as const,
    };
    const isNew = branchDraft.id === null;
    if (!isNew) {
      await updateFlowBranch(db, branchDraft.id!, data);
      setBranches(prev => prev.map(b => b.id === branchDraft!.id ? { ...branchDraft! } : b));
    } else {
      const newId = await addFlowBranch(db, data);
      setBranches(prev => [...prev, { ...branchDraft!, id: newId }]);
    }
    setBranchEditorOpen(false);
    setBranchDraft(null);
    setBranchNoteDraft({ yes: '', no: '' });
    setSubNoteDraft({ yes: '', no: '' });
    if (isNew) setInsertBranchMode(false);
  };
  const toggleBranchY = (id: number) => setBranchDraft(p => p ? ({
    ...p, yes: { ...p.yes, taskIds: p.yes.taskIds.includes(id) ? p.yes.taskIds.filter(x => x !== id) : [...p.yes.taskIds, id] },
  }) : p);
  const toggleBranchN = (id: number) => setBranchDraft(p => p ? ({
    ...p, no: { ...p.no, taskIds: p.no.taskIds.includes(id) ? p.no.taskIds.filter(x => x !== id) : [...p.no.taskIds, id] },
  }) : p);
  const addBranchNote = (path: 'yes' | 'no') => {
    const note = branchNoteDraft[path].trim();
    if (!note) return;
    setBranchDraft(p => p ? ({ ...p, [path]: { ...p[path], notes: [...p[path].notes, note] } }) : p);
    setBranchNoteDraft(prev => ({ ...prev, [path]: '' }));
  };
  const removeBranchNote = (path: 'yes' | 'no', idx: number) => {
    setBranchDraft(p => p ? ({ ...p, [path]: { ...p[path], notes: p[path].notes.filter((_, i) => i !== idx) } }) : p);
  };

  const addSubBranch = () => {
    setBranchDraft(p => p ? { ...p, no: { ...p.no, sub: { question: '', yesReturns: true, yes: emptyItems(), no: emptyItems() } } } : p);
    setSubNoteDraft({ yes: '', no: '' });
  };
  const removeSubBranch = () => {
    setBranchDraft(p => p ? { ...p, no: { ...p.no, sub: undefined } } : p);
  };
  const setSubQ = (q: string) => {
    setBranchDraft(p => p?.no.sub ? { ...p, no: { ...p.no, sub: { ...p.no.sub, question: q } } } : p);
  };
  const toggleSubTask = (path: 'yes' | 'no', id: number) => {
    setBranchDraft(p => {
      if (!p?.no.sub) return p;
      const cur = p.no.sub[path].taskIds;
      const next = cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id];
      return { ...p, no: { ...p.no, sub: { ...p.no.sub, [path]: { ...p.no.sub[path], taskIds: next } } } };
    });
  };
  const addSubNote = (path: 'yes' | 'no') => {
    const note = subNoteDraft[path].trim();
    if (!note) return;
    setBranchDraft(p => {
      if (!p?.no.sub) return p;
      return { ...p, no: { ...p.no, sub: { ...p.no.sub, [path]: { ...p.no.sub[path], notes: [...p.no.sub[path].notes, note] } } } };
    });
    setSubNoteDraft(prev => ({ ...prev, [path]: '' }));
  };
  const removeSubNote = (path: 'yes' | 'no', idx: number) => {
    setBranchDraft(p => {
      if (!p?.no.sub) return p;
      return { ...p, no: { ...p.no, sub: { ...p.no.sub, [path]: { ...p.no.sub[path], notes: p.no.sub[path].notes.filter((_, i) => i !== idx) } } } };
    });
  };
  const setNoRouteSubQ = (q: string) => {
    setNoRouteSubDraft(p => p ? { ...p, question: q } : p);
  };
  const toggleNoRouteSubTask = (path: 'yes' | 'no', id: number) => {
    setNoRouteSubDraft(p => {
      if (!p) return p;
      const cur = p[path].taskIds;
      const next = cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id];
      return { ...p, [path]: { ...p[path], taskIds: next } };
    });
  };
  const addNoRouteSubNote = (path: 'yes' | 'no') => {
    const note = noRouteSubNoteDraft[path].trim();
    if (!note) return;
    setNoRouteSubDraft(p => p ? { ...p, [path]: { ...p[path], notes: [...p[path].notes, note] } } : p);
    setNoRouteSubNoteDraft(prev => ({ ...prev, [path]: '' }));
  };
  const removeNoRouteSubNote = (path: 'yes' | 'no', idx: number) => {
    setNoRouteSubDraft(p => p ? { ...p, [path]: { ...p[path], notes: p[path].notes.filter((_, i) => i !== idx) } } : p);
  };

  // ── branch rendering helpers ──
  const renderPathItems = (path: { taskIds: number[]; notes: string[] }, compact = false) => {
    const hasAny = path.notes.length > 0 || path.taskIds.length > 0;
    if (!hasAny) return <Text style={compact ? s.viewBranchTask : s.branchPathEmpty}>なし</Text>;
    return (
      <>
        {path.notes.map((note, idx) => (
          <View key={`n${idx}`} style={compact ? s.viewBranchNoteBox : s.branchPathNote}>
            <Text style={compact ? s.viewBranchNote : s.branchPathNoteText} numberOfLines={2}>{note}</Text>
          </View>
        ))}
        {path.taskIds.map(id => {
          const t = taskById.get(id);
          return t ? (
            <View key={`t${id}`} style={compact ? s.viewBranchTaskBox : s.branchPathTask}>
              <Text style={compact ? s.viewBranchTask : s.branchPathTaskText} numberOfLines={2}>{t.icon ? `${t.icon} ` : ''}{t.title}</Text>
            </View>
          ) : null;
        })}
      </>
    );
  };

  const getBranchLayout = (b: BranchNode, compact = false, insertMode = false) => {
    const sub = b.no.sub;
    const subExtra = sub ? (compact ? 80 : 100) : 0;
    const rawItemCount = b.no.notes.length + b.no.taskIds.length;
    const itemCount = Math.max(1, rawItemCount);
    const routeTop = compact ? 30 : 40;
    const itemHeight = compact ? 43 : 50;
    const itemGap = compact ? 5 : 6;
    const baseRouteHeight = compact ? 122 : 150;
    const slotCount = (insertMode && !compact) ? (rawItemCount + 1 + (sub ? 1 : 0)) : 0;
    const slotExtra = slotCount * 44;
    const routeHeight = Math.max(baseRouteHeight, 30 + itemCount * itemHeight + (itemCount - 1) * itemGap + subExtra + slotExtra);
    const flowHeight = routeTop + routeHeight + (compact ? 32 : 30);
    const yesHeight = compact ? Math.max(120, routeHeight) : Math.max(140, routeHeight);
    return { routeHeight, flowHeight, yesHeight };
  };

  const renderSubItems = (items: SimpleItems) => {
    const has = items.notes.length > 0 || items.taskIds.length > 0;
    if (!has) return <Text style={s.subItemEmpty}>なし</Text>;
    return (
      <>
        {items.notes.map((n, i) => <View key={`sn${i}`} style={s.subItemBox}><Text style={s.subItemText} numberOfLines={2}>{n}</Text></View>)}
        {items.taskIds.map(id => { const t = taskById.get(id); return t ? <View key={`st${id}`} style={s.subItemBox}><Text style={s.subItemText} numberOfLines={2}>{t.icon ? `${t.icon} ` : ''}{t.title}</Text></View> : null; })}
      </>
    );
  };

  const renderSubDiamond = (sub: SubBranch, parent?: BranchNode) => (
    <View style={s.subBranchWrap}>
      <ArrowDown color={C.line} h={8} />
      <View style={s.subDiamondShell}>
        <View style={s.subDiamond}>
          {sub.yesReturns ? (
            <>
              <View style={s.subYesReturnLine} />
              <Text style={s.subYesReturnLabel}>はい</Text>
            </>
          ) : null}
          <View style={s.subDiamondTop} />
          <View style={s.subDiamondBottom} />
          <View style={s.subDiamondEdgeTL} />
          <View style={s.subDiamondEdgeTR} />
          <View style={s.subDiamondEdgeBR} />
          <View style={s.subDiamondEdgeBL} />
          <View style={s.subDiamondSC} />
          <View style={s.subDiamondInner}>
            <Text style={s.subDiamondQ}>{sub.question || '確認'}</Text>
          </View>
        </View>
        {parent ? (
          <View style={s.subDiamondBtns}>
            <TouchableOpacity style={s.subEditBtn} onPress={() => openNoRouteBranchEditor(parent)}>
              <Text style={s.subEditBtnText}>編集</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.subDelBtn} onPress={() => deleteNoRouteSubBranch(parent)}>
              <Text style={s.subDelBtnText}>×</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
      {sub.yesReturns ? (
        <View style={[s.subPaths, s.subPathsNoReturn]}>
          <View style={s.subNoCol}>
            <Text style={s.subPathNoLbl}>いいえ</Text>
            {renderSubItems(sub.no)}
          </View>
        </View>
      ) : (
        <View style={s.subPaths}>
          <View style={s.subYesCol}>
            <Text style={s.subPathYesLbl}>はい</Text>
            {renderSubItems(sub.yes)}
          </View>
          <View style={s.subPathDiv} />
          <View style={s.subNoCol}>
            <Text style={s.subPathNoLbl}>いいえ</Text>
            {renderSubItems(sub.no)}
          </View>
        </View>
      )}
    </View>
  );

  const renderNoRouteItems = (b: BranchNode) => {
    const slot = (k: string) => (
      <TouchableOpacity key={`sl${k}`} style={s.noInsertSlot} onPress={() => openNoRouteBranchEditor(b)} activeOpacity={0.75}>
        <Text style={s.noInsertSlotText}>＋ 分岐をここに追加</Text>
      </TouchableOpacity>
    );

    const noteNodes = b.no.notes.map((note, i): [string, React.ReactNode] => [`n${i}`, (
      <View key={`n${i}`} style={s.branchPathNote}>
        <Text style={s.branchPathNoteText} numberOfLines={2}>{note}</Text>
      </View>
    )]);
    const taskNodes = b.no.taskIds.map((id, i): [string, React.ReactNode] => {
      const t = taskById.get(id);
      return [`t${id}`, t ? (
        <View key={`t${id}`} style={s.branchPathTask}>
          <Text style={s.branchPathTaskText} numberOfLines={2}>{t.icon ? `${t.icon} ` : ''}{t.title}</Text>
        </View>
      ) : null];
    });
    const allEntries = [...noteNodes, ...taskNodes];

    if (!insertBranchMode) {
      const hasAny = allEntries.length > 0;
      return (
        <>
          {hasAny ? allEntries.map(([, node]) => node) : <Text style={s.branchPathEmpty}>なし</Text>}
          {b.no.sub && renderSubDiamond(b.no.sub, b)}
        </>
      );
    }

    const out: React.ReactNode[] = [slot('pre')];
    allEntries.forEach(([key, node]) => {
      if (node) out.push(node);
      out.push(slot(`post-${key}`));
    });
    if (b.no.sub) {
      out.push(<React.Fragment key="sub">{renderSubDiamond(b.no.sub, b)}</React.Fragment>);
      out.push(slot('post-sub'));
    }
    return <>{out}</>;
  };

  const renderBranchViewNode = (b: BranchNode) => {
    const layout = getBranchLayout(b, true);
    return (
    <View key={`bv${b.id}`} style={s.viewBranch}>
      <View style={[s.viewBranchFlow, { minHeight: layout.flowHeight }]}>
        <View style={s.viewBranchMainColumn}>
          <View style={s.viewBranchDiamond}>
            <View style={s.viewBranchDiamondTop} />
            <View style={s.viewBranchDiamondBottom} />
            <View style={s.viewBranchDiamondEdgeTL} />
            <View style={s.viewBranchDiamondEdgeTR} />
            <View style={s.viewBranchDiamondEdgeBR} />
            <View style={s.viewBranchDiamondEdgeBL} />
            <View style={s.viewBranchDiamondSeamCover} />
            <View style={s.viewBranchDiamondInner}>
              <Text style={s.viewBranchQ}>{b.question || '確認'}</Text>
            </View>
          </View>
          <View style={[s.viewBranchYesWrap, { height: layout.yesHeight }]}>
            <View style={[s.viewBranchYesLine, { height: layout.yesHeight }]} />
            <Text style={s.viewBranchLabel}>はい</Text>
          </View>
        </View>
        <View style={[s.viewBranchNoRoute, { height: layout.routeHeight }]}>
          <View
            style={[
              s.viewBranchNoRail,
              { height: layout.routeHeight },
              b.no.sub?.yesReturns ? s.viewBranchNoRailReturnless : null,
            ]}
            pointerEvents="none"
          />
          <Text style={s.viewBranchNoLabel}>いいえ</Text>
          <View style={s.viewBranchNoItems}>
            {renderPathItems(b.no, true)}
            {b.no.sub && renderSubDiamond(b.no.sub)}
          </View>
        </View>
        <View style={s.viewBranchNoMergeLine} pointerEvents="none" />
      </View>
    </View>
    );
  };

  const renderBranchEditNode = (b: BranchNode) => {
    const layout = getBranchLayout(b, false, insertBranchMode);
    return (
    <View key={`be${b.id}`} style={s.branchNode}>
      <View style={[s.branchFlow, { minHeight: layout.flowHeight }]}>
        <View style={s.branchMainColumn}>
          <View style={s.branchDiamondShell}>
            <View style={s.branchDiamond}>
              <View style={s.branchDiamondTop} />
              <View style={s.branchDiamondBottom} />
              <View style={s.branchDiamondEdgeTL} />
              <View style={s.branchDiamondEdgeTR} />
              <View style={s.branchDiamondEdgeBR} />
              <View style={s.branchDiamondEdgeBL} />
              <View style={s.branchDiamondSeamCover} />
              <View style={s.branchDiamondInner}>
                <Text style={s.branchNodeQ}>{b.question || '確認'}</Text>
              </View>
            </View>
            <View style={s.branchNodeBtns}>
              <TouchableOpacity style={s.branchEditBtn} onPress={() => editBranch(b)}>
                <Text style={s.branchEditBtnText}>編集</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.branchDelBtn} onPress={() => b.id !== null && deleteBranch(b.id)}>
                <Text style={s.branchDelBtnText}>×</Text>
              </TouchableOpacity>
            </View>
          </View>
          <View style={[s.branchYesWrap, { height: layout.yesHeight }]}>
            <View style={[s.branchYesLine, { height: layout.yesHeight }]} />
            <Text style={s.branchYesLabel}>はい</Text>
          </View>
        </View>
        <View style={[s.branchNoRoute, { height: layout.routeHeight }]}>
          <View
            style={[
              s.branchNoRail,
              { height: layout.routeHeight },
              b.no.sub?.yesReturns ? s.branchNoRailReturnless : null,
            ]}
            pointerEvents="none"
          />
          <Text style={s.branchNoLabel}>いいえ</Text>
          <View style={s.branchNoItems}>
            {renderNoRouteItems(b)}
          </View>
        </View>
        <View style={s.branchNoMergeLine} pointerEvents="none" />
      </View>
    </View>
    );
  };

  const renderGap = (afterIdx: number) => {
    const here = branches.filter(b => b.insertAfterIdx === afterIdx);
    if (here.length === 0 && !insertBranchMode) return null;
    return (
      <View style={s.gapWrap}>
        {here.map(b => (
          <React.Fragment key={`g${b.id}`}>
            <ArrowDown color={C.line} h={12} />
            {renderBranchEditNode(b)}
          </React.Fragment>
        ))}
        {insertBranchMode && (
          <>
            <ArrowDown color="#fb923c" h={12} />
            <TouchableOpacity style={s.insertSlot} onPress={() => openBranchEditor(afterIdx)}>
              <Text style={s.insertSlotText}>＋ 分岐をここに追加</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    );
  };

  const renderViewGap = (afterIdx: number) => {
    const here = branches.filter(b => b.insertAfterIdx === afterIdx);
    if (here.length === 0) return null;
    return (
      <View style={s.gapWrap}>
        {here.map(b => (
          <React.Fragment key={`gv${b.id}`}>
            <ArrowDown color={C.line} h={12} />
            {renderBranchViewNode(b)}
          </React.Fragment>
        ))}
      </View>
    );
  };

  // ── view mode flow ──
  const renderViewFlow = () => (
    <>
      <View style={s.viewTerminator}>
        <Text style={s.viewTerminatorText}>開始</Text>
      </View>
      {renderViewGap(-1)}
      {slots.map((taskId, idx) => {
        const task = taskId !== null ? taskById.get(taskId) : undefined;
        return (
          <React.Fragment key={idx}>
            <View style={s.viewSlotWrap}>
              <ArrowDown color={C.line} h={14} />
              {task ? (
                <View style={s.viewSlot}>
                  <View style={s.viewSlotNum}>
                    <Text style={s.viewSlotNumText}>{idx + 1}</Text>
                  </View>
                  <Text style={s.viewSlotText} numberOfLines={2} ellipsizeMode="tail">
                    {task.icon ? `${task.icon} ` : ''}{task.title}
                  </Text>
                </View>
              ) : (
                <View style={[s.viewSlot, s.viewSlotEmpty]}>
                  <View style={s.viewSlotNum}>
                    <Text style={s.viewSlotNumText}>{idx + 1}</Text>
                  </View>
                  <Text style={s.viewSlotEmptyText}>空き</Text>
                </View>
              )}
            </View>
            {renderViewGap(idx)}
          </React.Fragment>
        );
      })}
      <ArrowDown color={C.line} h={14} />
      <View style={s.viewTerminator}>
        <Text style={s.viewTerminatorText}>終了</Text>
      </View>
      <TouchableOpacity style={s.editCard} onPress={() => setIsEditing(true)} activeOpacity={0.8}>
        <Text style={s.editCardText}>編集</Text>
      </TouchableOpacity>
    </>
  );

  // ── edit mode flow ──
  const renderEditFlow = () => (
    <>
      <View style={s.terminator}>
        <Text style={s.terminatorText}>開始</Text>
      </View>
      {renderGap(-1)}
      {slots.map((taskId, idx) => {
        const task = taskId !== null ? taskById.get(taskId) : undefined;
        const isThisDragging = draggingIdx === idx;
        const shiftAnim = shiftAnims.current[idx] ?? new Animated.Value(0);
        const pan = task ? getSlotPan(idx) : null;

        return (
          <React.Fragment key={idx}>
            <Animated.View
              style={[
                s.slotWrap,
                isThisDragging
                  ? { transform: [{ translateY: dragY }, { scale: dragScale }], zIndex: 10, elevation: 8 }
                  : { transform: [{ translateY: shiftAnim }] },
              ]}
              onLayout={(e) => { slotHRef.current = e.nativeEvent.layout.height; }}
            >
              <ArrowDown color={C.line} />
              {task ? (
                <View style={[
                  s.slotBase,
                  hasSelection ? s.slotFilledTarget : s.slotFilled,
                  isThisDragging && s.slotDragging,
                ]}>
                  <View {...pan!.panHandlers} style={s.dragHandle} hitSlop={{ top: 12, bottom: 12, left: 4, right: 4 }}>
                    <Text style={s.dragHandleText}>☰</Text>
                  </View>
                  <TouchableOpacity style={s.slotCardArea} onPress={() => tapSlot(idx)} activeOpacity={0.7}>
                    <View style={s.slotNum}>
                      <Text style={s.slotNumText}>{idx + 1}</Text>
                    </View>
                    <Text style={s.slotCardText} numberOfLines={2} ellipsizeMode="tail">
                      {task.icon ? `${task.icon} ` : ''}{task.title}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.slotRemoveBtn} onPress={() => removeFromSlot(idx)}>
                    <Text style={s.slotRemoveText}>×</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  style={[s.slotBase, hasSelection ? s.slotTarget : s.slotEmpty]}
                  onPress={() => tapSlot(idx)}
                  activeOpacity={0.75}
                >
                  <View style={s.slotNum}>
                    <Text style={s.slotNumText}>{idx + 1}</Text>
                  </View>
                  <Text style={s.slotEmptyText}>
                    {hasSelection ? 'ここに入れる' : 'カードを入れる'}
                  </Text>
                </TouchableOpacity>
              )}
            </Animated.View>
            {renderGap(idx)}
          </React.Fragment>
        );
      })}
      <ArrowDown color={C.line} />
      <View style={s.terminator}>
        <Text style={s.terminatorText}>終了</Text>
      </View>
    </>
  );

  return (
    <View style={[s.root, { paddingBottom: insets.bottom }]}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      <LinearGradient colors={grad.header} start={GRAD_START} end={GRAD_END} style={[s.header, { paddingTop: insets.top + 12 }]}>
        <View style={s.navRow}>
          <TouchableOpacity style={s.navBtn} onPress={() => shiftSelected(-1)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={s.navArrow}>‹</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.navCenter} onPress={() => setShowDatePicker(true)} activeOpacity={0.7}>
            <Text style={s.navDateText}>{dateLabel}</Text>
            <Text style={s.navTodayHint}>タップで日付変更</Text>
          </TouchableOpacity>
          <View style={s.navRight}>
            {isEditing ? (
              <>
                <TouchableOpacity
                  style={[s.branchBtn, insertBranchMode && s.branchBtnActive]}
                  onPress={() => setInsertBranchMode(p => !p)}
                >
                  <Text style={[s.branchBtnText, insertBranchMode && s.branchBtnActiveText]}>分岐</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.saveBtn} onPress={saveOrder} disabled={saving}>
                  <Text style={s.saveBtnText}>{saving ? '…' : '保存'}</Text>
                </TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity style={s.editBtn} onPress={() => setIsEditing(true)}>
                <Text style={s.editBtnText}>編集</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={s.navBtn} onPress={() => shiftSelected(1)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={s.navArrow}>›</Text>
            </TouchableOpacity>
          </View>
        </View>
      </LinearGradient>

      <View style={s.flowViewport} {...flowPanResponder.panHandlers}>
        <Animated.View
          style={[
            s.flowScroll,
            {
              transform: [
                { translateX: flowPan.x },
                { translateY: flowPan.y },
              ],
            },
          ]}
        >
          <View
            style={[
              s.flowZoomWrap,
              { width: flowCanvasWidth, transform: [{ scale: flowScale }] },
            ]}
            onStartShouldSetResponderCapture={(e) => e.nativeEvent.touches.length >= 2}
            onMoveShouldSetResponderCapture={(e) => e.nativeEvent.touches.length >= 2}
            onResponderGrant={startPinch}
            onResponderMove={movePinch}
            onResponderRelease={endPinch}
            onResponderTerminate={endPinch}
          >
            <View style={[flowContentStyle, { width: flowLaneWidth }]}>
              {dueTasks.length === 0 ? (
                <View style={s.emptyFlow}>
                  <Text style={s.emptyTitle}>この日のフローはありません</Text>
                  <Text style={s.emptyBody}>頻度がこの日に当たるタスクがワークフローになります</Text>
                </View>
              ) : addedIds.length === 0 ? (
                <View style={s.emptyFlow}>
                  <Text style={s.emptyTitle}>フローにタスクを追加しましょう</Text>
                  <Text style={s.emptyBody}>「編集」からタスクを追加できます</Text>
                  {isEditing ? (
                    <TouchableOpacity style={s.addFirstBtn} onPress={() => setPickerOpen(true)}>
                      <Text style={s.addFirstBtnText}>＋ タスクを追加</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity style={[s.editCard, { marginTop: 16, paddingHorizontal: 40 }]} onPress={() => setIsEditing(true)} activeOpacity={0.8}>
                      <Text style={s.editCardText}>編集</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ) : isEditing ? renderEditFlow() : renderViewFlow()}
            </View>
          </View>
        </Animated.View>
      </View>

      {/* tray — edit mode only */}
      {isEditing && dueTasks.length > 0 && (
        <View style={s.tray}>
          {hasSelection ? (
            <Text style={s.trayHint}>カードを選択中 — 枠をタップして入れる</Text>
          ) : tray.length > 0 ? (
            <Text style={s.trayLabel}>未配置のカード ({tray.length})</Text>
          ) : null}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.trayScroll}>
            {tray.map(id => {
              const task = taskById.get(id);
              if (!task) return null;
              const sel = selectedCardId === id;
              return (
                <TouchableOpacity key={id} style={[s.card, sel && s.cardSelected]} onPress={() => tapCard(id)} activeOpacity={0.75}>
                  <Text style={[s.cardText, sel && s.cardTextSelected]} numberOfLines={2}>
                    {task.icon ? `${task.icon} ` : ''}{task.title}
                  </Text>
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity style={s.addBtn} onPress={() => setPickerOpen(true)}>
              <Text style={s.addBtnText}>＋ タスクを追加</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      )}

      <Modal visible={pickerOpen} transparent animationType="slide" onRequestClose={() => setPickerOpen(false)}>
        <TouchableOpacity style={s.pickerOverlay} activeOpacity={1} onPress={() => setPickerOpen(false)}>
          <TouchableOpacity activeOpacity={1} style={s.pickerSheet} onPress={() => {}}>
            <View style={s.pickerHeader}>
              <Text style={s.pickerTitle}>タスクを追加</Text>
              <TouchableOpacity onPress={() => setPickerOpen(false)}>
                <Text style={s.pickerDone}>完了</Text>
              </TouchableOpacity>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" bounces={false}>
              {dueTasks.length === 0 ? (
                <View style={s.pickerEmpty}>
                  <Text style={s.pickerEmptyText}>この日のタスクがありません</Text>
                </View>
              ) : (
                dueTasks.map(t => {
                  const added = addedIds.includes(t.id);
                  return (
                    <TouchableOpacity
                      key={t.id}
                      style={[s.pickerRow, added && s.pickerRowAdded]}
                      onPress={() => togglePicker(t.id)}
                      activeOpacity={0.7}
                    >
                      <Text style={[s.pickerRowText, added && s.pickerRowTextAdded]} numberOfLines={2}>
                        {t.icon ? `${t.icon} ` : ''}{t.title}
                      </Text>
                      <View style={[s.pickerCheck, added && s.pickerCheckOn]}>
                        {added && <Text style={s.pickerCheckText}>✓</Text>}
                      </View>
                    </TouchableOpacity>
                  );
                })
              )}
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Branch editor modal */}
      <Modal visible={branchEditorOpen} transparent animationType="slide" onRequestClose={() => { setBranchEditorOpen(false); setBranchDraft(null); }}>
        <TouchableOpacity style={s.pickerOverlay} activeOpacity={1} onPress={() => { setBranchEditorOpen(false); setBranchDraft(null); }}>
          <TouchableOpacity activeOpacity={1} style={s.branchEditorSheet} onPress={() => {}}>
            <View style={s.pickerHeader}>
              <Text style={s.pickerTitle}>分岐を設定</Text>
              <TouchableOpacity onPress={saveBranchDraft}>
                <Text style={s.pickerDone}>完了</Text>
              </TouchableOpacity>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" bounces={false}>
              <View style={s.branchEditorSection}>
                <Text style={s.branchEditorLabel}>分岐の内容</Text>
                <TextInput
                  style={s.branchEditorInput}
                  value={branchDraft?.question ?? ''}
                  onChangeText={t => setBranchDraft(p => p ? { ...p, question: t } : p)}
                  placeholder="例: 終わった？"
                  placeholderTextColor={C.muted}
                />
              </View>
              <View style={s.branchEditorSection}>
                <Text style={s.branchEditorLabel}>いいえで右に出す小カード</Text>
                <View style={s.branchNoteList}>
                  {(branchDraft?.no.notes ?? []).map((note, idx) => (
                    <TouchableOpacity key={`${note}${idx}`} style={s.branchNoteChip} onPress={() => removeBranchNote('no', idx)} activeOpacity={0.75}>
                      <Text style={s.branchNoteChipText} numberOfLines={1}>{note}</Text>
                      <Text style={s.branchNoteChipX}>×</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <View style={s.branchNoteAddRow}>
                  <TextInput
                    style={s.branchNoteInput}
                    value={branchNoteDraft.no}
                    onChangeText={t => setBranchNoteDraft(p => ({ ...p, no: t }))}
                    placeholder="横に出す内容"
                    placeholderTextColor={C.muted}
                    returnKeyType="done"
                    onSubmitEditing={() => addBranchNote('no')}
                  />
                  <TouchableOpacity style={s.branchNoteAddBtn} onPress={() => addBranchNote('no')}>
                    <Text style={s.branchNoteAddText}>追加</Text>
                  </TouchableOpacity>
                </View>
              </View>
              <View style={s.branchEditorSection}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text style={[s.branchEditorLabel, { flex: 1 }]}>いいえで右に出すタスク</Text>
                  <View style={s.branchCheckLabels}>
                    <Text style={s.branchCheckLabelN}>いいえ</Text>
                  </View>
                </View>
              </View>
              {dueTasks.map(t => {
                const inN = branchDraft?.no.taskIds.includes(t.id) ?? false;
                return (
                  <View key={t.id} style={s.branchTaskRow}>
                    <Text style={s.branchTaskText} numberOfLines={2}>{t.icon ? `${t.icon} ` : ''}{t.title}</Text>
                    <TouchableOpacity style={[s.branchCheckN, inN && s.branchCheckNOn]} onPress={() => toggleBranchN(t.id)}>
                      {inN && <Text style={s.branchCheckText}>✓</Text>}
                    </TouchableOpacity>
                  </View>
                );
              })}

              {/* Sub-branch section */}
              <View style={[s.branchEditorSection, { borderTopWidth: 1, borderTopColor: '#fed7aa', marginTop: 8, paddingTop: 16 }]}>
                <Text style={s.branchEditorLabel}>いいえルートにサブ分岐を追加</Text>
                {branchDraft?.no.sub ? (
                  <>
                    <TextInput
                      style={s.branchEditorInput}
                      value={branchDraft.no.sub.question}
                      onChangeText={setSubQ}
                      placeholder="サブ分岐の内容（例: やり直す？）"
                      placeholderTextColor="#9ca3af"
                    />
                    <Text style={[s.branchEditorLabel, { marginTop: 12, color: '#15803d' }]}>はいで左に戻る（メインフローへ）</Text>
                    <View style={s.branchNoteList}>
                      {(branchDraft.no.sub.yes.notes ?? []).map((note, idx) => (
                        <TouchableOpacity key={`sy${note}${idx}`} style={s.branchNoteChip} onPress={() => removeSubNote('yes', idx)} activeOpacity={0.75}>
                          <Text style={s.branchNoteChipText} numberOfLines={1}>{note}</Text>
                          <Text style={s.branchNoteChipX}>×</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    <View style={s.branchNoteAddRow}>
                      <TextInput style={s.branchNoteInput} value={subNoteDraft.yes} onChangeText={t => setSubNoteDraft(p => ({ ...p, yes: t }))} placeholder="はいルートの内容" placeholderTextColor="#9ca3af" returnKeyType="done" onSubmitEditing={() => addSubNote('yes')} />
                      <TouchableOpacity style={s.branchNoteAddBtn} onPress={() => addSubNote('yes')}><Text style={s.branchNoteAddText}>追加</Text></TouchableOpacity>
                    </View>
                    <Text style={[s.branchEditorLabel, { marginTop: 12, color: '#b91c1c' }]}>いいえで続けるカード</Text>
                    <View style={s.branchNoteList}>
                      {(branchDraft.no.sub.no.notes ?? []).map((note, idx) => (
                        <TouchableOpacity key={`sn${note}${idx}`} style={s.branchNoteChip} onPress={() => removeSubNote('no', idx)} activeOpacity={0.75}>
                          <Text style={s.branchNoteChipText} numberOfLines={1}>{note}</Text>
                          <Text style={s.branchNoteChipX}>×</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    <View style={s.branchNoteAddRow}>
                      <TextInput style={s.branchNoteInput} value={subNoteDraft.no} onChangeText={t => setSubNoteDraft(p => ({ ...p, no: t }))} placeholder="いいえルートの内容" placeholderTextColor="#9ca3af" returnKeyType="done" onSubmitEditing={() => addSubNote('no')} />
                      <TouchableOpacity style={s.branchNoteAddBtn} onPress={() => addSubNote('no')}><Text style={s.branchNoteAddText}>追加</Text></TouchableOpacity>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
                      <Text style={[s.branchEditorLabel, { flex: 1 }]}>タスク（いいえルート）</Text>
                      <View style={s.branchCheckLabels}><Text style={s.branchCheckLabelN}>いいえ</Text></View>
                    </View>
                    {dueTasks.map(t => {
                      const inSN = branchDraft?.no.sub?.no.taskIds.includes(t.id) ?? false;
                      return (
                        <View key={`st${t.id}`} style={s.branchTaskRow}>
                          <Text style={s.branchTaskText} numberOfLines={2}>{t.icon ? `${t.icon} ` : ''}{t.title}</Text>
                          <TouchableOpacity style={[s.branchCheckN, inSN && s.branchCheckNOn]} onPress={() => toggleSubTask('no', t.id)}>
                            {inSN && <Text style={s.branchCheckText}>✓</Text>}
                          </TouchableOpacity>
                        </View>
                      );
                    })}
                    <TouchableOpacity style={s.subRemoveBtn} onPress={removeSubBranch}>
                      <Text style={s.subRemoveBtnText}>サブ分岐を削除</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <TouchableOpacity style={s.subAddBtn} onPress={addSubBranch}>
                    <Text style={s.subAddBtnText}>＋ サブ分岐を追加（はいで左に戻る）</Text>
                  </TouchableOpacity>
                )}
              </View>

              <TouchableOpacity style={s.branchSaveBtn} onPress={saveBranchDraft}>
                <Text style={s.branchSaveBtnText}>保存</Text>
              </TouchableOpacity>
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* No-route branch editor modal */}
      <Modal visible={noRouteBranchEditorOpen} transparent animationType="slide" onRequestClose={closeNoRouteBranchEditor}>
        <TouchableOpacity style={s.pickerOverlay} activeOpacity={1} onPress={closeNoRouteBranchEditor}>
          <TouchableOpacity activeOpacity={1} style={s.branchEditorSheet} onPress={() => {}}>
            <View style={s.pickerHeader}>
              <Text style={s.pickerTitle}>{noRouteBranchParent?.no.sub ? '右側分岐を編集' : '右側分岐を追加'}</Text>
              <TouchableOpacity onPress={saveNoRouteBranchDraft}>
                <Text style={s.pickerDone}>完了</Text>
              </TouchableOpacity>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" bounces={false}>
              <View style={s.branchEditorSection}>
                <Text style={s.branchEditorLabel}>分岐の内容</Text>
                <TextInput
                  style={s.branchEditorInput}
                  value={noRouteSubDraft?.question ?? ''}
                  onChangeText={setNoRouteSubQ}
                  placeholder="例: やり直す？"
                  placeholderTextColor={C.muted}
                />
              </View>

              <View style={s.branchEditorSection}>
                <Text style={[s.branchEditorLabel, { color: '#15803d' }]}>はいで左に戻る（メインフローへ）</Text>
                <View style={s.branchNoteList}>
                  {(noRouteSubDraft?.yes.notes ?? []).map((note, idx) => (
                    <TouchableOpacity key={`nry${note}${idx}`} style={s.branchNoteChip} onPress={() => removeNoRouteSubNote('yes', idx)} activeOpacity={0.75}>
                      <Text style={s.branchNoteChipText} numberOfLines={1}>{note}</Text>
                      <Text style={s.branchNoteChipX}>×</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <View style={s.branchNoteAddRow}>
                  <TextInput
                    style={s.branchNoteInput}
                    value={noRouteSubNoteDraft.yes}
                    onChangeText={t => setNoRouteSubNoteDraft(p => ({ ...p, yes: t }))}
                    placeholder="はいルートの内容"
                    placeholderTextColor={C.muted}
                    returnKeyType="done"
                    onSubmitEditing={() => addNoRouteSubNote('yes')}
                  />
                  <TouchableOpacity style={s.branchNoteAddBtn} onPress={() => addNoRouteSubNote('yes')}>
                    <Text style={s.branchNoteAddText}>追加</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={s.branchEditorSection}>
                <Text style={[s.branchEditorLabel, { color: '#b91c1c' }]}>いいえで続けるカード</Text>
                <View style={s.branchNoteList}>
                  {(noRouteSubDraft?.no.notes ?? []).map((note, idx) => (
                    <TouchableOpacity key={`nrn${note}${idx}`} style={s.branchNoteChip} onPress={() => removeNoRouteSubNote('no', idx)} activeOpacity={0.75}>
                      <Text style={s.branchNoteChipText} numberOfLines={1}>{note}</Text>
                      <Text style={s.branchNoteChipX}>×</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <View style={s.branchNoteAddRow}>
                  <TextInput
                    style={s.branchNoteInput}
                    value={noRouteSubNoteDraft.no}
                    onChangeText={t => setNoRouteSubNoteDraft(p => ({ ...p, no: t }))}
                    placeholder="いいえルートの内容"
                    placeholderTextColor={C.muted}
                    returnKeyType="done"
                    onSubmitEditing={() => addNoRouteSubNote('no')}
                  />
                  <TouchableOpacity style={s.branchNoteAddBtn} onPress={() => addNoRouteSubNote('no')}>
                    <Text style={s.branchNoteAddText}>追加</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={[s.branchEditorSection, { paddingBottom: 0 }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={[s.branchEditorLabel, { flex: 1 }]}>タスク（いいえルート）</Text>
                  <View style={s.branchCheckLabels}><Text style={s.branchCheckLabelN}>いいえ</Text></View>
                </View>
              </View>
              {dueTasks.map(t => {
                const inNoRouteSub = noRouteSubDraft?.no.taskIds.includes(t.id) ?? false;
                return (
                  <View key={`nrt${t.id}`} style={s.branchTaskRow}>
                    <Text style={s.branchTaskText} numberOfLines={2}>{t.icon ? `${t.icon} ` : ''}{t.title}</Text>
                    <TouchableOpacity style={[s.branchCheckN, inNoRouteSub && s.branchCheckNOn]} onPress={() => toggleNoRouteSubTask('no', t.id)}>
                      {inNoRouteSub && <Text style={s.branchCheckText}>✓</Text>}
                    </TouchableOpacity>
                  </View>
                );
              })}

              <TouchableOpacity style={s.branchSaveBtn} onPress={saveNoRouteBranchDraft}>
                <Text style={s.branchSaveBtnText}>保存</Text>
              </TouchableOpacity>
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {Platform.OS === 'android' && showDatePicker && (
        <DateTimePicker
          value={selDateObj}
          mode="date"
          display="default"
          onChange={(_, date) => {
            setShowDatePicker(false);
            if (date) setSelectedDate(`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`);
          }}
        />
      )}

      <Modal visible={Platform.OS === 'ios' && showDatePicker} transparent animationType="slide" onRequestClose={() => setShowDatePicker(false)}>
        <TouchableOpacity style={s.pickerOverlay} activeOpacity={1} onPress={() => setShowDatePicker(false)}>
          <TouchableOpacity activeOpacity={1} style={s.datePickerSheet} onPress={() => {}}>
            <View style={s.pickerHeader}>
              <Text style={s.pickerTitle}>日付を選択</Text>
              <TouchableOpacity onPress={() => setShowDatePicker(false)}>
                <Text style={s.pickerDone}>完了</Text>
              </TouchableOpacity>
            </View>
            <DateTimePicker
              value={selDateObj}
              mode="date"
              display="spinner"
              onChange={(_, date) => {
                if (date) setSelectedDate(`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`);
              }}
              style={{ height: 200 }}
            />
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <TabBar current="Flow" navigation={navigation} />
    </View>
  );
}
