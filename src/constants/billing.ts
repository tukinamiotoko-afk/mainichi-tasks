// RevenueCat configuration.
//
// TODO: replace the iOS key once an iOS app is registered in RevenueCat.
import { Platform } from 'react-native';

export const REVENUECAT_API_KEY = Platform.select({
  android: 'goog_aGJyaRxpuftPZThFYvJOVgUlPjo',
  ios: 'REVENUECAT_IOS_API_KEY_PLACEHOLDER',
  default: 'goog_aGJyaRxpuftPZThFYvJOVgUlPjo',
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
