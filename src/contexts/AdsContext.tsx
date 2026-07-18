import React, { createContext, useCallback, useContext, useEffect, useRef, ReactNode } from 'react';
import { Platform } from 'react-native';
import mobileAds, {
  InterstitialAd, RewardedAd, AdEventType, RewardedAdEventType,
} from 'react-native-google-mobile-ads';
import {
  INTERSTITIAL_AD_UNIT_ID,
  REWARDED_AD_UNIT_ID,
  INTERSTITIAL_EVERY_N_ADDS,
  INTERSTITIAL_EVERY_N_COMPLETES,
} from '../constants/ads';
import { usePurchases } from './PurchasesContext';

type AdActionKind = 'add' | 'complete';

type AdsCtx = {
  recordAction: (kind: AdActionKind) => void;
  showRewardedAd: () => Promise<boolean>;
};

const AdsContext = createContext<AdsCtx>({
  recordAction: () => {},
  showRewardedAd: async () => false,
});

const supported = Platform.OS === 'android' || Platform.OS === 'ios';
const RETRY_DELAY_MS = 60_000;
const REWARDED_TIMEOUT_MS = 15_000;

const debugAds = (...args: unknown[]) => {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.log('[Ads]', ...args);
  }
};

const callIfFn = (fn: unknown) => {
  if (typeof fn === 'function') fn();
};

export function AdsProvider({ children }: { children: ReactNode }) {
  const { isPremium } = usePurchases();
  const actionCountsRef = useRef<Record<AdActionKind, number>>({ add: 0, complete: 0 });
  const interstitialRef = useRef<InterstitialAd | null>(null);
  const interstitialLoadedRef = useRef(false);
  const rewardedRef = useRef<RewardedAd | null>(null);
  const rewardedLoadedRef = useRef(false);
  const rewardedEarnedRef = useRef(false);
  const rewardedPendingShowRef = useRef(false);
  const rewardedResolveRef = useRef<((result: boolean) => void) | null>(null);
  const rewardedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rewardedRetryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rewardedUnsubsRef = useRef<unknown[]>([]);

  const clearRewardedTimeout = useCallback(() => {
    if (rewardedTimeoutRef.current) {
      clearTimeout(rewardedTimeoutRef.current);
      rewardedTimeoutRef.current = null;
    }
  }, []);

  const cleanupRewardedListeners = useCallback(() => {
    rewardedUnsubsRef.current.forEach(callIfFn);
    rewardedUnsubsRef.current = [];
  }, []);

  const finishRewarded = useCallback((result: boolean) => {
    clearRewardedTimeout();
    const resolve = rewardedResolveRef.current;
    rewardedResolveRef.current = null;
    rewardedPendingShowRef.current = false;
    debugAds('rewarded finish', result, 'earned=', rewardedEarnedRef.current);
    if (resolve) resolve(result);
  }, [clearRewardedTimeout]);

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

  const loadRewarded = useCallback(() => {
    if (!supported) return;
    if (rewardedRetryTimeoutRef.current) {
      clearTimeout(rewardedRetryTimeoutRef.current);
      rewardedRetryTimeoutRef.current = null;
    }
    cleanupRewardedListeners();
    rewardedLoadedRef.current = false;
    rewardedEarnedRef.current = false;
    debugAds('load rewarded start', REWARDED_AD_UNIT_ID);
    const ad = RewardedAd.createForAdRequest(REWARDED_AD_UNIT_ID);
    rewardedRef.current = ad;

    const unsubLoaded = ad.addAdEventListener(RewardedAdEventType.LOADED, () => {
      rewardedLoadedRef.current = true;
      debugAds('rewarded loaded');
      if (rewardedPendingShowRef.current) {
        try {
          debugAds('show rewarded');
          ad.show();
        } catch (error) {
          debugAds('rewarded show error', error);
          finishRewarded(false);
          loadRewarded();
        }
      }
    });
    const unsubEarned = ad.addAdEventListener(RewardedAdEventType.EARNED_REWARD, () => {
      rewardedEarnedRef.current = true;
      debugAds('rewarded earned');
    });
    const unsubClosed = ad.addAdEventListener(AdEventType.CLOSED, () => {
      debugAds('rewarded closed');
      finishRewarded(rewardedEarnedRef.current);
      loadRewarded();
    });
    const unsubError = ad.addAdEventListener(AdEventType.ERROR, (error) => {
      debugAds('rewarded error', error);
      finishRewarded(false);
      rewardedRetryTimeoutRef.current = setTimeout(() => {
        rewardedRetryTimeoutRef.current = null;
        loadRewarded();
      }, RETRY_DELAY_MS);
    });
    rewardedUnsubsRef.current = [unsubLoaded, unsubEarned, unsubClosed, unsubError];
    debugAds('rewarded listeners', typeof unsubLoaded, typeof unsubEarned, typeof unsubClosed, typeof unsubError);
    ad.load();
  }, [cleanupRewardedListeners, finishRewarded]);

  useEffect(() => {
    if (!supported) return;
    mobileAds().initialize()
      .then((status) => {
        debugAds('mobileAds initialized', status);
        loadInterstitial();
        loadRewarded();
      })
      .catch((error) => {
        debugAds('mobileAds initialize error', error);
      });
    return () => {
      clearRewardedTimeout();
      if (rewardedRetryTimeoutRef.current) {
        clearTimeout(rewardedRetryTimeoutRef.current);
        rewardedRetryTimeoutRef.current = null;
      }
      cleanupRewardedListeners();
    };
  }, [cleanupRewardedListeners, clearRewardedTimeout, loadInterstitial, loadRewarded]);

  const recordAction = useCallback((kind: AdActionKind) => {
    if (!supported || isPremium) return;
    const threshold = kind === 'complete' ? INTERSTITIAL_EVERY_N_COMPLETES : INTERSTITIAL_EVERY_N_ADDS;
    actionCountsRef.current[kind] += 1;
    debugAds('record action', kind, actionCountsRef.current[kind], '/', threshold);
    if (actionCountsRef.current[kind] < threshold) return;
    actionCountsRef.current[kind] = 0;
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
      rewardedResolveRef.current = resolve;
      rewardedPendingShowRef.current = true;
      clearRewardedTimeout();
      rewardedTimeoutRef.current = setTimeout(() => {
        rewardedTimeoutRef.current = null;
        debugAds('rewarded timeout', REWARDED_TIMEOUT_MS);
        finishRewarded(false);
      }, REWARDED_TIMEOUT_MS);

      const ad = rewardedRef.current;
      if (ad && rewardedLoadedRef.current) {
        try {
          debugAds('show rewarded');
          ad.show();
        } catch (error) {
          debugAds('rewarded show error', error);
          finishRewarded(false);
          loadRewarded();
        }
      } else if (!rewardedRef.current) {
        loadRewarded();
      }
    });
  }, [clearRewardedTimeout, finishRewarded, loadRewarded]);

  return (
    <AdsContext.Provider value={{ recordAction, showRewardedAd }}>
      {children}
    </AdsContext.Provider>
  );
}

export const useAds = () => useContext(AdsContext);
