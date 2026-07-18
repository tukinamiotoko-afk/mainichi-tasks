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
    const ad = InterstitialAd.createForAdRequest(INTERSTITIAL_AD_UNIT_ID);
    interstitialLoadedRef.current = false;
    const unsubLoaded = ad.addAdEventListener(AdEventType.LOADED, () => { interstitialLoadedRef.current = true; });
    const unsubClosed = ad.addAdEventListener(AdEventType.CLOSED, () => {
      unsubLoaded();
      unsubClosed();
      unsubError();
      loadInterstitial();
    });
    const unsubError = ad.addAdEventListener(AdEventType.ERROR, () => {
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
    mobileAds().initialize().then(() => loadInterstitial()).catch(() => {});
  }, [loadInterstitial]);

  const recordAction = useCallback(() => {
    if (!supported || isPremium) return;
    actionCountRef.current += 1;
    if (actionCountRef.current < INTERSTITIAL_EVERY_N_ACTIONS) return;
    actionCountRef.current = 0;
    const ad = interstitialRef.current;
    if (ad && interstitialLoadedRef.current) {
      try { ad.show(); } catch {}
    }
  }, [isPremium]);

  const showRewardedAd = useCallback((): Promise<boolean> => {
    if (!supported) return Promise.resolve(false);
    return new Promise((resolve) => {
      const ad = RewardedAd.createForAdRequest(REWARDED_AD_UNIT_ID);
      let earned = false;
      let settled = false;
      const finish = (result: boolean) => {
        if (settled) return;
        settled = true;
        unsubLoaded(); unsubEarned(); unsubClosed(); unsubError();
        resolve(result);
      };
      const unsubLoaded = ad.addAdEventListener(AdEventType.LOADED, () => { try { ad.show(); } catch { finish(false); } });
      const unsubEarned = ad.addAdEventListener(RewardedAdEventType.EARNED_REWARD, () => { earned = true; });
      const unsubClosed = ad.addAdEventListener(AdEventType.CLOSED, () => finish(earned));
      const unsubError = ad.addAdEventListener(AdEventType.ERROR, () => finish(false));
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
