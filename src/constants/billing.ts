// RevenueCat configuration.
//
// TODO: replace with real values once a RevenueCat project + Play Console
// subscription products exist. Until then, purchases will fail gracefully
// (see PurchasesContext) and every premium feature stays locked.
import { Platform } from 'react-native';

export const REVENUECAT_API_KEY = Platform.select({
  android: 'REVENUECAT_ANDROID_API_KEY_PLACEHOLDER',
  ios: 'REVENUECAT_IOS_API_KEY_PLACEHOLDER',
  default: 'REVENUECAT_ANDROID_API_KEY_PLACEHOLDER',
})!;

// The RevenueCat entitlement identifier that gates every premium feature.
export const PREMIUM_ENTITLEMENT_ID = 'premium';

// Product identifiers as configured in Play Console / App Store Connect.
export const MONTHLY_PRODUCT_ID = 'mainichitasks_premium_monthly';
export const YEARLY_PRODUCT_ID = 'mainichitasks_premium_yearly';

export const MONTHLY_PRICE_LABEL = '月額 ¥200';
export const YEARLY_PRICE_LABEL = '年額 ¥2,000';

// Free-tier limits — everything above these requires PREMIUM_ENTITLEMENT_ID.
export const FREE_FLOW_CHART_LIMIT = 1;
export const FREE_TIMER_STARTS_PER_DAY = 2;
export const FREE_ACCENT_KEYS = ['blue'] as const;
