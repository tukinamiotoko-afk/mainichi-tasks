import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, StatusBar, Switch, Alert, InteractionManager, TextInput, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSQLiteContext } from 'expo-sqlite';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { LinearGradient } from 'expo-linear-gradient';
import { RootStackParamList } from '../../App';
import { getSetting, setSetting } from '../db/database';
import { GRAD_START, GRAD_END } from '../constants/theme';
import { FREE_ACCENT_KEYS } from '../constants/billing';
import { EMAILJS_ENDPOINT, EMAILJS_PUBLIC_KEY, EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID } from '../constants/emailjs';
import TabBar from '../components/TabBar';
import { useTheme, ColorSet, ACCENT_LIST, AccentKey } from '../contexts/ThemeContext';
import { usePurchases } from '../contexts/PurchasesContext';

type ScheduleSize = 'small' | 'normal' | 'large';
type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'Notifications'> };

const makeStyles = (C: ColorSet) => StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: C.body },
  headerCard: { backgroundColor: C.primary, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 20 },
  headerTitle: { color: '#ffffff', fontSize: 20, fontWeight: '700' },
  list: { flex: 1 },
  listContent: { padding: 16 },

  card: {
    backgroundColor: C.card,
    borderRadius: 14,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.07,
    shadowRadius: 4,
    elevation: 2,
  },
  sectionLabel: {
    color: C.muted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: C.grid, marginLeft: 16 },
  sectionDivider: { height: 1, backgroundColor: C.grid },

  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  itemBlock: { paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
  itemLabel: { color: C.ink, fontSize: 15, fontWeight: '600' },
  itemSub: { color: C.muted, fontSize: 12, marginTop: 2 },
  itemFlex: { flex: 1 },

  accentRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  accentChip: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: 'transparent' },
  accentChipActive: { borderColor: C.ink },
  accentCheck: { color: '#ffffff', fontSize: 16, fontWeight: '900' },
  accentName: { color: C.muted, fontSize: 12, marginTop: 2 },
  accentLock: { position: 'absolute', top: -2, right: -2, fontSize: 12 },
  premiumRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  premiumBadge: { color: C.primary, fontSize: 12, fontWeight: '800' },

  segRow: { flexDirection: 'row', gap: 8 },
  segChip: { flex: 1, borderWidth: 1.5, borderColor: C.border, borderRadius: 20, paddingVertical: 10, alignItems: 'center' },
  segChipActive: { backgroundColor: C.primary, borderColor: C.primary },
  segChipText: { color: C.muted, fontSize: 13, fontWeight: '700' },
  segChipTextActive: { color: '#ffffff' },
  itemArrow: { color: C.muted, fontSize: 20 },
  contactInput: {
    minHeight: 120,
    borderWidth: 1.5,
    borderColor: C.border,
    borderRadius: 14,
    backgroundColor: C.body,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: C.ink,
    fontSize: 14,
    textAlignVertical: 'top',
  },
  contactBtn: {
    borderRadius: 14,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 13,
  },
  contactBtnDisabled: {
    opacity: 0.55,
  },
  contactBtnText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  contactMeta: {
    color: C.muted,
    fontSize: 12,
    lineHeight: 18,
  },
  debugBox: {
    borderWidth: 1,
    borderColor: C.grid,
    borderRadius: 12,
    backgroundColor: C.body,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 6,
  },
  debugTitle: {
    color: C.ink,
    fontSize: 13,
    fontWeight: '700',
  },
  debugText: {
    color: C.muted,
    fontSize: 12,
    lineHeight: 18,
  },
});

export default function NotificationScreen({ navigation }: Props) {
  const db = useSQLiteContext();
  const insets = useSafeAreaInsets();
  const { C, dark, setDark, accent, setAccent, grad } = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  const { isPremium } = usePurchases();

  const [tagRight, setTagRight] = useState(false);
  const [scheduleSize, setScheduleSize] = useState<ScheduleSize>('normal');
  const [contactMessage, setContactMessage] = useState('');
  const [contactSending, setContactSending] = useState(false);
  const [contactResult, setContactResult] = useState<{ ok: boolean; status: number | null; body: string } | null>(null);
  const load = useCallback(async () => {
    const [layout, size] = await Promise.all([
      getSetting(db, 'card_layout'),
      getSetting(db, 'schedule_size'),
    ]);
    setTagRight(layout === 'tag_right');
    if (size === 'small' || size === 'large' || size === 'normal') setScheduleSize(size);
  }, [db]);

  useFocusEffect(useCallback(() => {
    const task = InteractionManager.runAfterInteractions(() => {
      load();
    });
    return () => task.cancel();
  }, [load]));

  const toggleTagRight = async (val: boolean) => {
    setTagRight(val);
    await setSetting(db, 'card_layout', val ? 'tag_right' : 'tag_left');
  };

  const changeScheduleSize = async (val: ScheduleSize) => {
    setScheduleSize(val);
    await setSetting(db, 'schedule_size', val);
  };

  const handleContactSubmit = async () => {
    const trimmed = contactMessage.trim();
    if (!trimmed || contactSending) return;
    setContactSending(true);
    setContactResult(null);
    try {
      const response = await fetch(EMAILJS_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          service_id: EMAILJS_SERVICE_ID,
          template_id: EMAILJS_TEMPLATE_ID,
          user_id: EMAILJS_PUBLIC_KEY,
          template_params: {
            name: 'アプリユーザー',
            message: trimmed,
          },
        }),
      });
      const text = await response.text();
      const ok = response.status >= 200 && response.status < 300;
      setContactResult({
        ok,
        status: response.status,
        body: text || '(empty response)',
      });
      if (ok) setContactMessage('');
    } catch (error) {
      setContactResult({
        ok: false,
        status: null,
        body: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setContactSending(false);
    }
  };

  return (
    <View style={s.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      <LinearGradient colors={grad.header} start={GRAD_START} end={GRAD_END} style={[s.headerCard, { paddingTop: insets.top + 12 }]}>
        <Text style={s.headerTitle}>設定</Text>
      </LinearGradient>

      <ScrollView style={s.list} contentContainerStyle={s.listContent}>
        <View style={s.card}>

          {/* ─── プレミアム ─── */}
          <Text style={s.sectionLabel}>プレミアム</Text>
          <View style={s.divider} />
          <TouchableOpacity style={s.premiumRow} onPress={() => navigation.navigate('Upgrade')} activeOpacity={0.7}>
            <View style={s.itemFlex}>
              <Text style={s.itemLabel}>{isPremium ? 'プレミアム加入中' : 'プレミアムにアップグレード'}</Text>
              <Text style={s.itemSub}>{isPremium ? 'ご利用ありがとうございます' : '広告なし・全機能が使えます'}</Text>
            </View>
            {!isPremium && <Text style={s.premiumBadge}>詳細 ›</Text>}
          </TouchableOpacity>

          {/* ─── 外観 ─── */}
          <View style={s.sectionDivider} />
          <Text style={s.sectionLabel}>外観</Text>
          <View style={s.divider} />

          <View style={s.itemRow}>
            <View style={s.itemFlex}>
              <Text style={s.itemLabel}>ダークモード</Text>
              <Text style={s.itemSub}>{dark ? 'ON（暗い画面）' : 'OFF（明るい画面）'}</Text>
            </View>
            <Switch
              value={dark}
              onValueChange={setDark}
              trackColor={{ false: C.border, true: C.primary }}
              thumbColor="#ffffff"
            />
          </View>
          <View style={s.divider} />

          <View style={s.itemBlock}>
            <Text style={s.itemLabel}>テーマカラー</Text>
            <View style={s.accentRow}>
              {ACCENT_LIST.map(({ key, label, swatch }) => {
                const locked = !isPremium && !(FREE_ACCENT_KEYS as readonly string[]).includes(key);
                return (
                  <TouchableOpacity
                    key={key}
                    style={[s.accentChip, { backgroundColor: swatch }, accent === key && s.accentChipActive]}
                    onPress={() => (locked ? navigation.navigate('Upgrade') : setAccent(key as AccentKey))}
                    activeOpacity={0.8}
                  >
                    {accent === key && <Text style={s.accentCheck}>✓</Text>}
                    {locked && <Text style={s.accentLock}>🔒</Text>}
                  </TouchableOpacity>
                );
              })}
            </View>
            <Text style={s.accentName}>{ACCENT_LIST.find((a) => a.key === accent)?.label ?? ''}</Text>
          </View>

          {/* ─── 表示 ─── */}
          <View style={s.sectionDivider} />
          <Text style={s.sectionLabel}>表示</Text>
          <View style={s.divider} />

          <View style={s.itemRow}>
            <View style={s.itemFlex}>
              <Text style={s.itemLabel}>左利き用にする</Text>
              <Text style={s.itemSub}>{tagRight ? 'タグ：右　チェック：左　追加：左' : 'タグ：左　チェック：右　追加：右'}</Text>
            </View>
            <Switch
              value={tagRight}
              onValueChange={toggleTagRight}
              trackColor={{ false: C.border, true: C.primary }}
              thumbColor="#ffffff"
            />
          </View>
          {/* ─── タイムスケジュール ─── */}
          <View style={s.sectionDivider} />
          <Text style={s.sectionLabel}>タイムスケジュール</Text>
          <View style={s.divider} />

          <View style={s.itemBlock}>
            <Text style={s.itemLabel}>行の高さ</Text>
            <View style={s.segRow}>
              {([['small', '小'], ['normal', '標準'], ['large', '大']] as [ScheduleSize, string][]).map(([v, label]) => (
                <TouchableOpacity
                  key={v}
                  style={[s.segChip, scheduleSize === v && s.segChipActive]}
                  onPress={() => changeScheduleSize(v)}
                >
                  <Text style={[s.segChipText, scheduleSize === v && s.segChipTextActive]}>{label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* ─── サポート ─── */}
          <View style={s.sectionDivider} />
          <Text style={s.sectionLabel}>サポート</Text>
          <View style={s.divider} />

          <View style={s.itemBlock}>
            <Text style={s.itemLabel}>お問い合わせ</Text>
            <Text style={s.itemSub}>ご意見・不具合報告をアプリ内から送信できます</Text>
            <TextInput
              style={s.contactInput}
              value={contactMessage}
              onChangeText={setContactMessage}
              editable={!contactSending}
              multiline
              placeholder="内容を入力してください"
              placeholderTextColor={C.muted}
            />
            <TouchableOpacity
              style={[s.contactBtn, (contactSending || !contactMessage.trim()) && s.contactBtnDisabled]}
              onPress={handleContactSubmit}
              disabled={contactSending || !contactMessage.trim()}
              activeOpacity={0.85}
            >
              {contactSending ? <ActivityIndicator color="#ffffff" /> : <Text style={s.contactBtnText}>送信する</Text>}
            </TouchableOpacity>
            <Text style={s.contactMeta}>送信結果は下にそのまま表示されます。</Text>
            {contactResult && (
              <View style={s.debugBox}>
                <Text style={s.debugTitle}>{contactResult.ok ? '送信成功' : '送信失敗'}</Text>
                <Text style={s.debugText}>status: {contactResult.status ?? 'network error'}</Text>
                <Text style={s.debugText}>{contactResult.body}</Text>
              </View>
            )}
          </View>

        </View>
      </ScrollView>

      <TabBar current="Notifications" navigation={navigation} />
    </View>
  );
}
