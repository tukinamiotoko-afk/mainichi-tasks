// AdMob configuration.
//
// TODO: replace every value below with the real AdMob app/ad-unit IDs once
// an AdMob account + app registration exist. ADMOB_APP_ID must also be
// mirrored into the "react-native-google-mobile-ads" plugin config in
// app.json (androidAppId/iosAppId) — a native rebuild is required after
// changing it there.
import { Platform } from 'react-native';

export const ADMOB_APP_ID = Platform.select({
  android: 'ca-app-pub-3940256099942544~3347511713',
  ios: 'ca-app-pub-3940256099942544~1458002511',
  default: 'ca-app-pub-3940256099942544~3347511713',
})!;

export const INTERSTITIAL_AD_UNIT_ID = Platform.select({
  android: 'ca-app-pub-3940256099942544/1033173712',
  ios: 'ca-app-pub-3940256099942544/4411468910',
  default: 'ca-app-pub-3940256099942544/1033173712',
})!;

export const REWARDED_AD_UNIT_ID = Platform.select({
  android: 'ca-app-pub-3940256099942544/5224354917',
  ios: 'ca-app-pub-3940256099942544/1712485313',
  default: 'ca-app-pub-3940256099942544/5224354917',
})!;

// Show an interstitial after this many tracked actions (task add / complete).
export const INTERSTITIAL_EVERY_N_ACTIONS = 3;
