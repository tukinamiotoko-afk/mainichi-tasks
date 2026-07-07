import React, { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';
import { Platform } from 'react-native';
import Purchases, { PurchasesOffering, PurchasesPackage } from 'react-native-purchases';
import { REVENUECAT_API_KEY, PREMIUM_ENTITLEMENT_ID } from '../constants/billing';

type PurchasesCtx = {
  isPremium: boolean;
  loading: boolean;
  offering: PurchasesOffering | null;
  purchasePackage: (pkg: PurchasesPackage) => Promise<boolean>;
  restorePurchases: () => Promise<boolean>;
};

const PurchasesContext = createContext<PurchasesCtx>({
  isPremium: false,
  loading: true,
  offering: null,
  purchasePackage: async () => false,
  restorePurchases: async () => false,
});

export function PurchasesProvider({ children }: { children: ReactNode }) {
  const [isPremium, setIsPremium] = useState(false);
  const [loading, setLoading] = useState(true);
  const [offering, setOffering] = useState<PurchasesOffering | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Only Android/iOS are supported by RevenueCat's native SDK.
        if (Platform.OS !== 'android' && Platform.OS !== 'ios') { setLoading(false); return; }
        Purchases.configure({ apiKey: REVENUECAT_API_KEY });
        const info = await Purchases.getCustomerInfo();
        if (!cancelled) setIsPremium(typeof info.entitlements.active[PREMIUM_ENTITLEMENT_ID] !== 'undefined');
        const offerings = await Purchases.getOfferings();
        if (!cancelled) setOffering(offerings.current ?? null);
      } catch {
        // Not yet configured with real IDs, or offline — every premium
        // feature simply stays locked until this succeeds.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    const listener = (info: Awaited<ReturnType<typeof Purchases.getCustomerInfo>>) => {
      setIsPremium(typeof info.entitlements.active[PREMIUM_ENTITLEMENT_ID] !== 'undefined');
    };
    Purchases.addCustomerInfoUpdateListener(listener);
    return () => {
      cancelled = true;
      Purchases.removeCustomerInfoUpdateListener(listener);
    };
  }, []);

  const purchasePackage = useCallback(async (pkg: PurchasesPackage): Promise<boolean> => {
    try {
      const { customerInfo } = await Purchases.purchasePackage(pkg);
      const active = typeof customerInfo.entitlements.active[PREMIUM_ENTITLEMENT_ID] !== 'undefined';
      setIsPremium(active);
      return active;
    } catch {
      return false;
    }
  }, []);

  const restorePurchases = useCallback(async (): Promise<boolean> => {
    try {
      const info = await Purchases.restorePurchases();
      const active = typeof info.entitlements.active[PREMIUM_ENTITLEMENT_ID] !== 'undefined';
      setIsPremium(active);
      return active;
    } catch {
      return false;
    }
  }, []);

  return (
    <PurchasesContext.Provider value={{ isPremium, loading, offering, purchasePackage, restorePurchases }}>
      {children}
    </PurchasesContext.Provider>
  );
}

export const usePurchases = () => useContext(PurchasesContext);
