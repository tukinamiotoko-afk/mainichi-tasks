import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, StatusBar, Alert, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { LinearGradient } from 'expo-linear-gradient';
import { RootStackParamList } from '../../App';
import { GRAD_START, GRAD_END } from '../constants/theme';
import { MONTHLY_PRICE_LABEL, YEARLY_PRICE_LABEL } from '../constants/billing';
import { useTheme, ColorSet } from '../contexts/ThemeContext';
import { usePurchases } from '../contexts/PurchasesContext';

type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'Upgrade'> };

const PERKS = [
  'テーマカラーが全色使える',
  'フローチャートを何個でも作れる',
  '自動計測（通知タップで計測開始）',
  '複数回タスク',
  'タイマーの回数制限なし',
  '広告が表示されない',
];

const makeStyles = (C: ColorSet) => StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: C.body },
  headerCard: { paddingHorizontal: 20, paddingBottom: 20 },
  headerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  closeText: { fontSize: 22, color: '#ffffff', paddingHorizontal: 4 },
  headerTitle: { color: '#ffffff', fontSize: 20, fontWeight: '800' },
  content: { padding: 20, gap: 16 },
  perkCard: { backgroundColor: C.card, borderRadius: 14, padding: 16, gap: 10 },
  perkRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  perkCheck: { color: C.primary, fontSize: 15, fontWeight: '800' },
  perkText: { color: C.onDark, fontSize: 14, flex: 1 },
  planRow: { flexDirection: 'row', gap: 12 },
  planCard: { flex: 1, backgroundColor: C.card, borderRadius: 14, padding: 16, alignItems: 'center', gap: 8, borderWidth: 1.5, borderColor: C.border },
  planLabel: { color: C.muted, fontSize: 12, fontWeight: '700' },
  planPrice: { color: C.onDark, fontSize: 18, fontWeight: '800' },
  buyBtn: { marginTop: 6, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 18, backgroundColor: C.primary },
  buyBtnDisabled: { backgroundColor: C.border },
  buyBtnText: { color: C.onPrimary, fontSize: 13, fontWeight: '800' },
  restoreBtn: { alignItems: 'center', paddingVertical: 12 },
  restoreText: { color: C.muted, fontSize: 13, fontWeight: '700' },
  premiumBox: { backgroundColor: C.card, borderRadius: 14, padding: 20, alignItems: 'center', gap: 8 },
  premiumTitle: { color: C.onDark, fontSize: 16, fontWeight: '800' },
});

export default function UpgradeScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { C, grad } = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  const { isPremium, loading, offering, purchasePackage, restorePurchases } = usePurchases();
  const [busy, setBusy] = useState(false);

  const monthlyPkg = offering?.availablePackages.find((p) => p.packageType === 'MONTHLY') ?? null;
  const yearlyPkg = offering?.availablePackages.find((p) => p.packageType === 'ANNUAL') ?? null;

  const buy = async (pkg: typeof monthlyPkg) => {
    if (!pkg || busy) return;
    setBusy(true);
    const ok = await purchasePackage(pkg);
    setBusy(false);
    if (ok) {
      Alert.alert('ありがとうございます！', 'プレミアムが有効になりました。');
      navigation.goBack();
    } else {
      Alert.alert('購入できませんでした', 'しばらくしてからもう一度お試しください。');
    }
  };

  const restore = async () => {
    if (busy) return;
    setBusy(true);
    const ok = await restorePurchases();
    setBusy(false);
    Alert.alert(ok ? '復元しました' : '復元できる購入がありませんでした');
  };

  return (
    <View style={s.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
      <LinearGradient colors={grad.header} start={GRAD_START} end={GRAD_END} style={[s.headerCard, { paddingTop: insets.top + 12 }]}>
        <View style={s.headerTop}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={s.closeText}>✕</Text>
          </TouchableOpacity>
          <Text style={s.headerTitle}>プレミアム</Text>
          <View style={{ width: 22 }} />
        </View>
      </LinearGradient>

      <ScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 24 }]}>
        {isPremium ? (
          <View style={s.premiumBox}>
            <Text style={s.premiumTitle}>すでにプレミアムです</Text>
            <Text style={{ color: C.muted, fontSize: 13 }}>いつもありがとうございます！</Text>
          </View>
        ) : (
          <>
            <View style={s.perkCard}>
              {PERKS.map((perk) => (
                <View key={perk} style={s.perkRow}>
                  <Text style={s.perkCheck}>✓</Text>
                  <Text style={s.perkText}>{perk}</Text>
                </View>
              ))}
            </View>

            {loading ? (
              <ActivityIndicator color={C.primary} />
            ) : (
              <View style={s.planRow}>
                <View style={s.planCard}>
                  <Text style={s.planLabel}>月額プラン</Text>
                  <Text style={s.planPrice}>{MONTHLY_PRICE_LABEL}</Text>
                  <TouchableOpacity
                    style={[s.buyBtn, (!monthlyPkg || busy) && s.buyBtnDisabled]}
                    onPress={() => buy(monthlyPkg)}
                    disabled={!monthlyPkg || busy}
                  >
                    <Text style={s.buyBtnText}>{monthlyPkg ? '購入する' : '準備中'}</Text>
                  </TouchableOpacity>
                </View>
                <View style={s.planCard}>
                  <Text style={s.planLabel}>年額プラン</Text>
                  <Text style={s.planPrice}>{YEARLY_PRICE_LABEL}</Text>
                  <TouchableOpacity
                    style={[s.buyBtn, (!yearlyPkg || busy) && s.buyBtnDisabled]}
                    onPress={() => buy(yearlyPkg)}
                    disabled={!yearlyPkg || busy}
                  >
                    <Text style={s.buyBtnText}>{yearlyPkg ? '購入する' : '準備中'}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            <TouchableOpacity style={s.restoreBtn} onPress={restore} disabled={busy}>
              <Text style={s.restoreText}>購入を復元</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </View>
  );
}
