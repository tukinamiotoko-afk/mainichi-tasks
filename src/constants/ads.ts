// AdMob configuration.
//
// Android values are real (from the developer's AdMob account). iOS isn't
// published yet, so it still uses Google's official test IDs — replace
// once an iOS app is registered in AdMob. REWARDED_AD_UNIT_ID (android)
// is still a test ID too — a separate "rewarded" ad unit needs to be
// created in AdMob to get its real ID.
//
// ADMOB_APP_ID must also be mirrored into the
// "react-native-google-mobile-ads" plugin config in app.json
// (androidAppId/iosAppId) — a native rebuild is required after changing
// it there.
import { Platform } from 'react-native';

export const ADMOB_APP_ID = Platform.select({
  android: 'ca-app-pub-6253728869800176~4424472496',
  ios: 'ca-app-pub-3940256099942544~1458002511',
  default: 'ca-app-pub-6253728869800176~4424472496',
})!;

export const INTERSTITIAL_AD_UNIT_ID = Platform.select({
  android: 'ca-app-pub-6253728869800176/3925779047',
  ios: 'ca-app-pub-3940256099942544/4411468910',
  default: 'ca-app-pub-6253728869800176/3925779047',
})!;

// TODO: still a test ID — create a "rewarded" ad unit in AdMob and swap
// this in (interstitial and rewarded ad units are separate in AdMob).
export const REWARDED_AD_UNIT_ID = Platform.select({
  android: 'ca-app-pub-3940256099942544/5224354917',
  ios: 'ca-app-pub-3940256099942544/1712485313',
  default: 'ca-app-pub-3940256099942544/5224354917',
})!;

// Show an interstitial after this many tracked actions (task add / complete).
export const INTERSTITIAL_EVERY_N_ACTIONS = 3;
