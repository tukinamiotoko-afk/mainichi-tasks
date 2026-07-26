// AdMob configuration.
//
// Android values are real (from the developer's AdMob account). iOS isn't
// published yet, so it still uses Google's official test IDs — replace
// once an iOS app is registered in AdMob.
//
// ADMOB_APP_ID must also be mirrored into the
// "react-native-google-mobile-ads" plugin config in app.json
// (androidAppId/iosAppId) — a native rebuild is required after changing
// it there.
import { Platform } from 'react-native';

const USE_ANDROID_TEST_ADS = Platform.OS === 'android' && typeof __DEV__ !== 'undefined' && __DEV__;

export const ADMOB_APP_ID = Platform.select({
  android: 'ca-app-pub-6253728869800176~4424472496',
  ios: 'ca-app-pub-3940256099942544~1458002511',
  default: 'ca-app-pub-6253728869800176~4424472496',
})!;

export const INTERSTITIAL_AD_UNIT_ID = Platform.select({
  android: USE_ANDROID_TEST_ADS
    ? 'ca-app-pub-3940256099942544/1033173712'
    : 'ca-app-pub-6253728869800176/3925779047',
  ios: 'ca-app-pub-3940256099942544/4411468910',
  default: USE_ANDROID_TEST_ADS
    ? 'ca-app-pub-3940256099942544/1033173712'
    : 'ca-app-pub-6253728869800176/3925779047',
})!;

export const REWARDED_AD_UNIT_ID = Platform.select({
  android: USE_ANDROID_TEST_ADS
    ? 'ca-app-pub-3940256099942544/5224354917'
    : 'ca-app-pub-6253728869800176/5127180074',
  ios: 'ca-app-pub-3940256099942544/1712485313',
  default: USE_ANDROID_TEST_ADS
    ? 'ca-app-pub-3940256099942544/5224354917'
    : 'ca-app-pub-6253728869800176/5127180074',
})!;

// Show an interstitial after this many tracked actions.
export const INTERSTITIAL_EVERY_N_COMPLETES = 5;
export const INTERSTITIAL_EVERY_N_ADDS = 3;
