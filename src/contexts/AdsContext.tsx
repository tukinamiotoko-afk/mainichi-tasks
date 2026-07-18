import React, { createContext, useCallback, useContext, useEffect, useRef, ReactNode } from 'react';
import { Platform } from 'react-native';
import mobileAds, {
  InterstitialAd, RewardedAd, AdEventType, RewardedAdEventType,
} from 'react-native-google-mobile-ads';
import { INTERSTITIAL_AD_UNIT_ID, REWARDED_AD_UNIT_ID, INTERSTITIAL_EVERY_N_ACTIONS } from '../constants/ads';
import { usePurchases } from './PurchasesContext';

type AdsCtx = {
  // Call after a tracked action (task added / completed). Shows an
  // interstitial every Nth call, skipped entirely for premium users.
  recordAction: () => void;
  // Shows a rewarded ad and resolves true only if the reward was earned.
  showRewardedAd: () => Promise<boolean>;
};

const AdsContext = createContext<AdsCtx>({
  recordAction: () => {},
  showRewardedAd: async () => false,
});

const supported = Platform.OS === 'android' || Platform.OS === 'ios';
const debugAds = (...args: unknown[]) => {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.log('[Ads]', ...args);
  }
};
const REWARDED_TIMEOUT_MS = 15_000;
const callIfFn = (fn: unknown) => {
  if (typeof fn === 'function') fn();
};

export function AdsProvider({ children }: { children: ReactNode }) {
  const { isPremium } = usePurchases();
  const actionCountRef = useRef(0);
  const interstitialRef = useRef<InterstitialAd | null>(null);
  const interstitialLoadedRef = useRef(false);

  // AdMob returns an error (e.g. no fill) fairly often, especially for a
  // freshly-created ad unit — retry after a delay instead of giving up
  // and leaving the interstitial permanently unloaded for the session.
  const RETRY_DELAY_MS = 60_000;

  const loadInterstitial = useCallback(() => {
    if (!supported) return;
    debugAds('load interstitial start', INTERSTITIAL_AD_UNIT_ID);
    const ad = InterstitialAd.createForAdRequest(INTERSTITIAL_AD_UNIT_ID);
    interstitialLoadedRef.current = false;
    const unsubLoaded = ad.addAdEventListener(AdEventType.LOADED, () => {
      interstitialLoadedRef.current = true;
      debugAds('interstitial loaded');
    });
    const unsubClosed = ad.addAdEventListener(AdEventType.CLOSED, () => {
      debugAds('interstitial closed -> reload');
      unsubLoaded();
      unsubClosed();
      unsubError();
      loadInterstitial();
    });
    const unsubError = ad.addAdEventListener(AdEventType.ERROR, (error) => {
      debugAds('interstitial error', error);
      unsubLoaded();
      unsubClosed();
      unsubError();
      setTimeout(loadInterstitial, RETRY_DELAY_MS);
    });
    ad.load();
    interstitialRef.current = ad;
  }, []);

  useEffect(() => {
    if (!supported) return;
    mobileAds().initialize()
      .then((status) => {
        debugAds('mobileAds initialized', status);
        loadInterstitial();
      })
      .catch((error) => {
        debugAds('mobileAds initialize error', error);
      });
  }, [loadInterstitial]);

  const recordAction = useCallback(() => {
    if (!supported || isPremium) return;
    actionCountRef.current += 1;
    debugAds('record action', actionCountRef.current, '/', INTERSTITIAL_EVERY_N_ACTIONS);
    if (actionCountRef.current < INTERSTITIAL_EVERY_N_ACTIONS) return;
    actionCountRef.current = 0;
    const ad = interstitialRef.current;
    if (ad && interstitialLoadedRef.current) {
      try {
        debugAds('show interstitial');
        ad.show();
      } catch (error) {
        debugAds('interstitial show error', error);
      }
    } else {
      debugAds('interstitial not ready at threshold');
    }
  }, [isPremium]);

  const showRewardedAd = useCallback((): Promise<boolean> => {
    if (!supported) return Promise.resolve(false);
    return new Promise((resolve) => {
      debugAds('load rewarded start', REWARDED_AD_UNIT_ID);
      const ad = RewardedAd.createForAdRequest(REWARDED_AD_UNIT_ID);
      let earned = false;
      let settled = false;
      let timeoutId: ReturnType<typeof setTimeout> | null = setTimeout(() => {
        timeoutId = null;
        debugAds('rewarded timeout', REWARDED_TIMEOUT_MS);
        finish(false);
      }, REWARDED_TIMEOUT_MS);
      const finish = (result: boolean) => {
        if (settled) return;
        settled = true;
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        debugAds('rewarded finish', result, 'earned=', earned);
        callIfFn(unsubLoaded); callIfFn(unsubEarned); callIfFn(unsubClosed); callIfFn(unsubError);
        resolve(result);
      };
      const unsubLoaded = ad.addAdEventListener(AdEventType.LOADED, () => {
        debugAds('rewarded loaded');
        try {
          debugAds('show rewarded');
          ad.show();
        } catch (error) {
          debugAds('rewarded show error', error);
          finish(false);
        }
      });
      const unsubEarned = ad.addAdEventListener(RewardedAdEventType.EARNED_REWARD, () => {
        earned = true;
        debugAds('rewarded earned');
      });
      const unsubClosed = ad.addAdEventListener(AdEventType.CLOSED, () => {
        debugAds('rewarded closed');
        finish(earned);
      });
      const unsubError = ad.addAdEventListener(AdEventType.ERROR, (error) => {
        debugAds('rewarded error', error);
        finish(false);
      });
      debugAds('rewarded listeners', typeof unsubLoaded, typeof unsubEarned, typeof unsubClosed, typeof unsubError);
      ad.load();
    });
  }, []);

  return (
    <AdsContext.Provider value={{ recordAction, showRewardedAd }}>
      {children}
    </AdsContext.Provider>
  );
}

export const useAds = () => useContext(AdsContext);
