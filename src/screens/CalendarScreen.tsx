import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, ScrollView, StatusBar } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSQLiteContext } from 'expo-sqlite';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { LinearGradient } from 'expo-linear-gradient';
import { RootStackParamList } from '../../App';
import { CompletionDetail, getCompletionsForMonth } from '../db/database';
import { GRAD, GRAD_START, GRAD_END } from '../constants/theme';
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
};

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'Calendar'> };

function formatTime(iso: string | null): string {
  if (!iso) return '--:--';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function CalendarScreen({ navigation }: Props) {
  const db = useSQLiteContext();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [completions, setCompletions] = useState<CompletionDetail[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const load = useCallback(async () => {
    const data = await getCompletionsForMonth(db, year, month);
    setCompletions(data);
  }, [db, year, month]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const completionsByDate = completions.reduce<Record<string, CompletionDetail[]>>((acc, c) => {
    if (!acc[c.date]) acc[c.date] = [];
    acc[c.date].push(c);
    return acc;
  }, {});

  const firstDow = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const prevMonth = () => { if (month === 1) { setMonth(12); setYear(y => y - 1); } else setMonth(m => m - 1); };
  const nextMonth = () => { if (month === 12) { setMonth(1); setYear(y => y + 1); } else setMonth(m => m + 1); };

  const selectedCompletions = selectedDate ? (completionsByDate[selectedDate] ?? []) : [];

  return (
    <SafeAreaView style={s.safeArea} edges={['top', 'bottom']}>
      <StatusBar barStyle="light-content" backgroundColor={C.header} />

      <LinearGradient colors={GRAD.header} start={GRAD_START} end={GRAD_END} style={s.headerCard}>
        <View style={s.monthNav}>
          <TouchableOpacity onPress={prevMonth} style={s.navBtn}>
            <Text style={s.navBtnText}>‹</Text>
          </TouchableOpacity>
          <Text style={s.monthLabel}>{year}年{month}月</Text>
          <TouchableOpacity onPress={nextMonth} style={s.navBtn}>
            <Text style={s.navBtnText}>›</Text>
          </TouchableOpacity>
        </View>
      </LinearGradient>

      <ScrollView style={s.body} contentContainerStyle={{ padding: 12 }}>
        <View style={s.calendarCard}>
          <View style={s.weekRow}>
            {WEEKDAYS.map((d, i) => (
              <Text key={d} style={[s.weekLabel, i === 0 && s.sun, i === 6 && s.sat]}>{d}</Text>
            ))}
          </View>
          <View style={s.grid}>
            {cells.map((day, i) => {
              if (!day) return <View key={`e-${i}`} style={s.cell} />;
              const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
              const hasData = !!completionsByDate[dateStr];
              const dow = i % 7;
              const isToday = dateStr === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
              return (
                <TouchableOpacity
                  key={`d-${i}`}
                  style={s.cell}
                  onPress={() => hasData && setSelectedDate(dateStr)}
                  disabled={!hasData}
                >
                  <View style={[s.dayCircle, isToday && s.todayCircle]}>
                    <Text style={[s.dayNum, dow === 0 && s.sun, dow === 6 && s.sat, isToday && s.todayNum, hasData && s.dayNumActive]}>
                      {day}
                    </Text>
                  </View>
                  {hasData && <View style={s.dot} />}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </ScrollView>

      <TabBar current="Calendar" navigation={navigation} />

      <Modal visible={!!selectedDate} transparent animationType="slide" onRequestClose={() => setSelectedDate(null)}>
        <TouchableOpacity style={s.modalBg} activeOpacity={1} onPress={() => setSelectedDate(null)}>
          <View style={s.modalSheet}>
            <View style={s.sheetHandle} />
            <Text style={s.sheetTitle}>{selectedDate?.replace(/-/g, '/')} の記録</Text>
            <View style={s.sheetDivider} />
            {selectedCompletions.map((c, i) => (
              <View key={i} style={s.completionRow}>
                <Text style={s.completionTime}>{formatTime(c.completed_at)}</Text>
                <Text style={s.completionTitle}>{c.icon ? `${c.icon} ` : ''}{c.title}</Text>
              </View>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: C.header },
  headerCard: { backgroundColor: C.header, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 20 },
  monthNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  navBtn: { padding: 8 },
  navBtnText: { color: '#ffffff', fontSize: 28, fontWeight: '300' },
  monthLabel: { color: '#ffffff', fontSize: 18, fontWeight: '700' },

  body: { flex: 1, backgroundColor: C.body },
  calendarCard: { backgroundColor: C.card, borderRadius: 16, padding: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 6, elevation: 3 },

  weekRow: { flexDirection: 'row', marginBottom: 4 },
  weekLabel: { flex: 1, textAlign: 'center', color: C.muted, fontSize: 12, fontWeight: '700', paddingVertical: 6 },

  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: '14.28%', alignItems: 'center', paddingVertical: 4 },
  dayCircle: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  todayCircle: { backgroundColor: C.primary },
  dayNum: { fontSize: 13, fontWeight: '500', color: C.onDark },
  dayNumActive: { fontWeight: '700' },
  todayNum: { color: '#ffffff', fontWeight: '700' },
  sun: { color: '#e53e3e' },
  sat: { color: '#3182ce' },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: C.primary, marginTop: 2 },

  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: C.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingTop: 12, gap: 12, maxHeight: '60%' },
  sheetHandle: { width: 40, height: 4, backgroundColor: C.border, borderRadius: 2, alignSelf: 'center', marginBottom: 8 },
  sheetTitle: { color: C.onDark, fontSize: 16, fontWeight: '700' },
  sheetDivider: { height: 1, backgroundColor: C.border },
  completionRow: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 6 },
  completionTime: { color: C.primary, fontSize: 16, fontWeight: '700', minWidth: 52 },
  completionTitle: { flex: 1, color: C.onDark, fontSize: 14, fontWeight: '500' },
});
