import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import {
  AdsBootstrap,
  AdRiskState,
  PlacementDecision,
  ensureAdsBootstrap,
  trackPlacementEvaluationFailure,
} from './AdsBootstrap';
import { AdPlacementId } from './placements';
import {
  trackAdClick,
  trackAdFail,
  trackAdImpression,
  trackAdLoad,
  trackAdPaid,
  trackAdRequest,
} from '../analytics/adEvents';

type Props = {
  placementId: AdPlacementId;
  screenId: string;
  riskState?: AdRiskState;
  style?: StyleProp<ViewStyle>;
  collapsedHeight?: number;
};

type BannerAdSdk = {
  BannerAd?: React.ComponentType<Record<string, unknown>>;
  BannerAdSize?: {
    ANCHORED_ADAPTIVE_BANNER?: string;
    ADAPTIVE_BANNER?: string;
    BANNER?: string;
  };
};

const DEFAULT_BANNER_HEIGHT = 52;

const getBannerSize = (sdk: BannerAdSdk | null | undefined) =>
  sdk?.BannerAdSize?.ANCHORED_ADAPTIVE_BANNER ||
  sdk?.BannerAdSize?.ADAPTIVE_BANNER ||
  sdk?.BannerAdSize?.BANNER ||
  'BANNER';

const getEventCode = (error: any) =>
  String(error?.code || error?.message || error || 'unknown')
    .toLowerCase()
    .slice(0, 64);

export const resolveBannerAdComponent = (
  sdk: BannerAdSdk | null | undefined,
  format?: PlacementDecision['format'],
) => {
  const BannerAd = sdk?.BannerAd;
  if (format !== 'banner' || !BannerAd) {
    return null;
  }

  return BannerAd;
};

export const AdSlot: React.FC<Props> = ({
  placementId,
  screenId,
  riskState,
  style,
  collapsedHeight = DEFAULT_BANNER_HEIGHT,
}) => {
  const [decision, setDecision] = useState<PlacementDecision | null>(null);
  const [collapsed, setCollapsed] = useState(true);
  const markedImpressionRef = useRef(false);
  const requestTrackedRef = useRef(false);

  const sdk = useMemo(() => AdsBootstrap.getSdkModule(), []);

  useEffect(() => {
    let mounted = true;
    requestTrackedRef.current = false;
    markedImpressionRef.current = false;
    setCollapsed(true);

    const run = async () => {
      await ensureAdsBootstrap();
      const nextDecision = await AdsBootstrap.evaluatePlacement({
        placementId,
        screenId,
        riskState,
      });
      if (!mounted) return;
      setDecision(nextDecision);
      if (!nextDecision.allowed) {
        trackPlacementEvaluationFailure(nextDecision);
      }
    };

    void run();
    return () => {
      mounted = false;
    };
  }, [placementId, screenId, riskState?.offline, riskState?.riskHigh, riskState?.sosActive]);

  useEffect(() => {
    if (!decision?.allowed || requestTrackedRef.current) return;
    trackAdRequest({
      placementId: decision.placementId,
      screenId: decision.screenId,
      geoTier: decision.geoTier,
      adFormat: decision.format,
    });
    requestTrackedRef.current = true;
  }, [decision]);

  if (!decision?.allowed) {
    return null;
  }

  const BannerAd = resolveBannerAdComponent(sdk, decision.format);
  if (!BannerAd) {
    return null;
  }

  return (
    <View style={[styles.wrap, { minHeight: collapsed ? 0 : collapsedHeight }, style]}>
      <BannerAd
        unitId={decision.adUnitId}
        size={getBannerSize(sdk)}
        onAdLoaded={() => {
          setCollapsed(false);
          trackAdLoad({
            placementId: decision.placementId,
            screenId: decision.screenId,
            geoTier: decision.geoTier,
            adFormat: decision.format,
          });
        }}
        onAdFailedToLoad={(error: any) => {
          setCollapsed(true);
          trackAdFail({
            placementId: decision.placementId,
            screenId: decision.screenId,
            geoTier: decision.geoTier,
            adFormat: decision.format,
            errorCode: getEventCode(error),
          });
        }}
        onAdOpened={() => {
          trackAdClick({
            placementId: decision.placementId,
            screenId: decision.screenId,
            geoTier: decision.geoTier,
            adFormat: decision.format,
          });
        }}
        onAdImpression={async () => {
          trackAdImpression({
            placementId: decision.placementId,
            screenId: decision.screenId,
            geoTier: decision.geoTier,
            adFormat: decision.format,
          });
          if (!markedImpressionRef.current) {
            markedImpressionRef.current = true;
            await AdsBootstrap.markPlacementShown(decision.placementId);
          }
        }}
        onPaid={(paid: any) => {
          trackAdPaid({
            placementId: decision.placementId,
            screenId: decision.screenId,
            geoTier: decision.geoTier,
            adFormat: decision.format,
            valueMicros: Number(paid?.value || paid?.valueMicros || 0),
            currency: String(paid?.currency || 'USD'),
            networkName: typeof paid?.precision === 'string' ? paid.precision : undefined,
          });
        }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    overflow: 'hidden',
  },
});

export default AdSlot;
