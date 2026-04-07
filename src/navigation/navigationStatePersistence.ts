import type {
  InitialState,
  NavigationState,
  PartialState,
  Route,
} from '@react-navigation/native';
import type { RootStackParamList } from './types';

export const NAV_STATE_STORAGE_KEY = 'ALERT_NAV_STATE_V1';
export const NAV_STATE_SCHEMA_VERSION = 1;
export const NAV_PENDING_AUTH_ROUTE_KEY = 'ALERT_NAV_PENDING_AUTH_ROUTE_V1';

export const KNOWN_ROUTE_NAMES: ReadonlySet<keyof RootStackParamList> = new Set<
  keyof RootStackParamList
>([
  'Welcome',
  'Login',
  'Signup',
  'PhoneAuth',
  'VerifyCode',
  'ProfileSetup',
  'Profile',
  'SetupContacts',
  'Home',
  'SafetyMap',
  'ChatMonitor',
  'ChatThread',
  'PrivateReply',
  'Conversations',
  'EpidemicMap',
  'Notifications',
  'Monitoring',
  'RealtimeInsights',
  'MonitoringFeed',
  'Guardians',
  'RouteSettings',
  'WidgetCatalog',
  'CheckIn',
  'OfficialSources',
  'History',
  'Checkout',
  'Settings',
  'Support',
  'AdPrivacy',
  'LanguageSelector',
  'WebView',
  'ThemeSettings',
  'AlertDetails',
]);

export const SENSITIVE_ROUTE_NAMES: ReadonlySet<keyof RootStackParamList> = new Set<
  keyof RootStackParamList
>([
  'VerifyCode',
  'PhoneAuth',
  'Signup',
  'SetupContacts',
]);

export const AUTH_REQUIRED_ROUTE_NAMES: ReadonlySet<keyof RootStackParamList> = new Set<
  keyof RootStackParamList
>([
  'ChatThread',
  'PrivateReply',
  'Conversations',
  'Guardians',
  'Profile',
  'CheckIn',
]);

export const AUTH_FLOW_ROUTE_NAMES: ReadonlySet<keyof RootStackParamList> = new Set<
  keyof RootStackParamList
>([
  'Welcome',
  'Login',
  'Signup',
  'PhoneAuth',
  'VerifyCode',
  'ProfileSetup',
  'SetupContacts',
]);

export type PendingAuthRoute = {
  name: keyof RootStackParamList;
  params?: unknown;
};

type PersistedNavPayloadV1 = {
  version: number;
  savedAt: string;
  state: NavigationState | PartialState<NavigationState>;
};

type MutableRoute = Route<string> & { state?: MutableState };
type MutableState = {
  index?: number;
  routes: MutableRoute[];
  [key: string]: any;
};

export type SanitizedNavStateResult = {
  state: InitialState | undefined;
  hadSensitiveRoute: boolean;
  hadInvalidRoute: boolean;
  blockedAuthRoute?: PendingAuthRoute;
};

const isRouteNameKnown = (name: string): name is keyof RootStackParamList =>
  KNOWN_ROUTE_NAMES.has(name as keyof RootStackParamList);

const isLikelyNavigationState = (
  value: unknown,
): value is PartialState<NavigationState> => {
  const candidate = value as any;
  if (!candidate || typeof candidate !== 'object') return false;
  if (!Array.isArray(candidate.routes)) return false;
  return candidate.routes.every(
    (route: any) => route && typeof route === 'object' && typeof route.name === 'string',
  );
};

export const getActiveRouteName = (
  state?: NavigationState | PartialState<NavigationState>,
): keyof RootStackParamList | undefined => {
  if (!state || !Array.isArray((state as any).routes) || (state as any).routes.length === 0) {
    return undefined;
  }

  const index =
    typeof (state as any).index === 'number'
      ? Math.min(Math.max((state as any).index, 0), (state as any).routes.length - 1)
      : (state as any).routes.length - 1;

  const route = (state as any).routes[index] as any;
  if (!route || typeof route.name !== 'string') return undefined;

  if (route.state) {
    return getActiveRouteName(route.state as NavigationState | PartialState<NavigationState>);
  }

  return isRouteNameKnown(route.name) ? route.name : undefined;
};

export const buildFallbackNavigationState = (
  routeName: keyof RootStackParamList = 'Home',
): InitialState => ({
  routes: [{ name: routeName as string }],
});

export const migratePersistedNavigationState = (
  rawPayload: unknown,
): PartialState<NavigationState> | null => {
  if (!rawPayload || typeof rawPayload !== 'object') return null;
  const payload = rawPayload as any;

  if (
    typeof payload.version === 'number' &&
    payload.version === NAV_STATE_SCHEMA_VERSION &&
    isLikelyNavigationState(payload.state)
  ) {
    return payload.state;
  }

  if (isLikelyNavigationState(payload.state)) {
    return payload.state;
  }

  if (isLikelyNavigationState(payload)) {
    return payload;
  }

  return null;
};

export const buildPersistedNavigationPayload = (
  state: NavigationState,
): PersistedNavPayloadV1 => ({
  version: NAV_STATE_SCHEMA_VERSION,
  savedAt: new Date().toISOString(),
  state,
});

const isSafePostLoginRoute = (name: keyof RootStackParamList) =>
  !SENSITIVE_ROUTE_NAMES.has(name) && KNOWN_ROUTE_NAMES.has(name);

const sanitizeStateNode = (
  node: MutableState,
  isLoggedIn: boolean,
): {
  state: MutableState | null;
  hadSensitiveRoute: boolean;
  hadInvalidRoute: boolean;
  blockedAuthRoute?: PendingAuthRoute;
} => {
  const routes = Array.isArray(node.routes) ? node.routes : [];
  const activeRoute = routes[Math.min(Math.max(node.index ?? routes.length - 1, 0), routes.length - 1)];
  const activeRouteKey = activeRoute?.key;

  let hadSensitiveRoute = false;
  let hadInvalidRoute = false;
  let blockedAuthRoute: PendingAuthRoute | undefined;

  const nextRoutes: MutableRoute[] = [];

  for (const route of routes) {
    if (!route || typeof route.name !== 'string') {
      hadInvalidRoute = true;
      continue;
    }

    if (!isRouteNameKnown(route.name)) {
      hadInvalidRoute = true;
      continue;
    }

    const routeName = route.name as keyof RootStackParamList;

    if (SENSITIVE_ROUTE_NAMES.has(routeName)) {
      hadSensitiveRoute = true;
      continue;
    }

    if (!isLoggedIn && AUTH_REQUIRED_ROUTE_NAMES.has(routeName)) {
      if (!blockedAuthRoute && isSafePostLoginRoute(routeName)) {
        blockedAuthRoute = { name: routeName, params: route.params };
      }
      continue;
    }

    let childState: MutableState | undefined;
    if (route.state && typeof route.state === 'object') {
      const childResult = sanitizeStateNode(route.state as MutableState, isLoggedIn);
      hadSensitiveRoute = hadSensitiveRoute || childResult.hadSensitiveRoute;
      hadInvalidRoute = hadInvalidRoute || childResult.hadInvalidRoute;
      blockedAuthRoute = blockedAuthRoute || childResult.blockedAuthRoute;
      childState = childResult.state || undefined;
    }

    nextRoutes.push({
      ...route,
      ...(childState ? { state: childState } : { state: undefined }),
    });
  }

  if (nextRoutes.length === 0) {
    return { state: null, hadSensitiveRoute, hadInvalidRoute, blockedAuthRoute };
  }

  const activeIndex = activeRouteKey
    ? nextRoutes.findIndex(route => route.key === activeRouteKey)
    : -1;

  const nextIndex =
    activeIndex >= 0
      ? activeIndex
      : Math.min(Math.max(node.index ?? nextRoutes.length - 1, 0), nextRoutes.length - 1);

  return {
    state: {
      ...node,
      routes: nextRoutes,
      index: nextIndex,
    },
    hadSensitiveRoute,
    hadInvalidRoute,
    blockedAuthRoute,
  };
};

export const sanitizePersistedNavigationState = (
  candidate: PartialState<NavigationState>,
  isLoggedIn: boolean,
): SanitizedNavStateResult => {
  const mutable = candidate as unknown as MutableState;
  const sanitized = sanitizeStateNode(mutable, isLoggedIn);
  return {
    state: sanitized.state
      ? (sanitized.state as unknown as InitialState)
      : undefined,
    hadSensitiveRoute: sanitized.hadSensitiveRoute,
    hadInvalidRoute: sanitized.hadInvalidRoute,
    blockedAuthRoute: sanitized.blockedAuthRoute,
  };
};
