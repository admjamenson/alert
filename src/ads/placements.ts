export type AdFormat = 'banner' | 'interstitial' | 'rewarded' | 'native';

export type AdPlacementId =
  | 'home_footer_banner'
  | 'monitoring_feed_inline_banner'
  | 'chat_thread_rewarded'
  | 'history_inline_banner'
  | 'settings_inline_banner';

export type PlacementMeta = {
  id: AdPlacementId;
  format: AdFormat;
  defaultScreenId: string;
  safetyCritical: boolean;
};

export const AD_PLACEMENTS: Record<AdPlacementId, PlacementMeta> = {
  home_footer_banner: {
    id: 'home_footer_banner',
    format: 'banner',
    defaultScreenId: 'Home',
    safetyCritical: false,
  },
  monitoring_feed_inline_banner: {
    id: 'monitoring_feed_inline_banner',
    format: 'banner',
    defaultScreenId: 'MonitoringFeed',
    safetyCritical: true,
  },
  chat_thread_rewarded: {
    id: 'chat_thread_rewarded',
    format: 'rewarded',
    defaultScreenId: 'ChatThread',
    safetyCritical: false,
  },
  history_inline_banner: {
    id: 'history_inline_banner',
    format: 'banner',
    defaultScreenId: 'History',
    safetyCritical: false,
  },
  settings_inline_banner: {
    id: 'settings_inline_banner',
    format: 'banner',
    defaultScreenId: 'Settings',
    safetyCritical: false,
  },
};

export const AD_PLACEMENT_IDS = Object.keys(AD_PLACEMENTS) as AdPlacementId[];
