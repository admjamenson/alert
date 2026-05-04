# Alert Global Release System

This is an operational release gate. It does not replace store rollout controls,
Render rollback buttons, crash reporting, or incident command. It gives the
backend and app a single policy surface for canary, feature flags, kill switch,
SLO checks, cost containment, and rollback decisions.

## Canary Stages

Rollout stages are fixed:

- 1%
- 5%
- 10%
- 25%
- 50%
- 100%

Set `ALERT_CANARY_PERCENT` to one of those values. Any other value is treated as
an invalid stage and blocks advancement.

Advance only when `release:gate` reports `canary_can_advance`.

```powershell
npm.cmd --prefix backend run release:gate
```

## Remote Control

Primary remote override, when Firebase Admin is available:

- collection: `ops`
- document: `release_control`

Supported fields:

```json
{
  "version": "2026.04.20-canary",
  "previousVersion": "2026.04.19-stable",
  "canary": {
    "enabled": true,
    "percent": 1,
    "allowedRegions": ["US", "BR"],
    "allowedSegments": ["staff"]
  },
  "killSwitch": {
    "active": false
  },
  "rollback": {
    "force": false
  },
  "disabledFeatures": [],
  "featurePercents": {
    "sosEnhancements": 1,
    "maps": 1,
    "weather": 1,
    "alerts": 1,
    "aiChat": 0,
    "externalIntegrations": 0
  },
  "metrics": {
    "appCrashFreeRate": 0.999,
    "sosSuccessRate": 1,
    "sosP95Ms": 420,
    "criticalApiErrorRate": 0,
    "criticalApiP95Ms": 180,
    "providerErrorRate": 0,
    "entitlementErrorRate": 0,
    "freeCostPerUserUsd": 0.02,
    "premiumCostPerUserUsd": 1.2
  },
  "notes": "Initial staff canary"
}
```

If Firestore is unavailable, env vars remain the fallback control plane.

## Kill Switch

Set either remote `killSwitch.active=true` or
`ALERT_GLOBAL_KILL_SWITCH=true`.

When active, non-critical features are disabled and only these are preserved:

- `sos`
- `essentialLocation`
- `minimalCommunication`

The mobile app receives the policy through `/api/me/entitlements` and the
backend exposes full state through `/v1/release/status`.

## SLO Gate

Minimum SLO inputs:

- `appCrashFreeRate`
- `sosSuccessRate`
- `sosP95Ms`
- `criticalApiErrorRate`
- `criticalApiP95Ms`
- `providerErrorRate`
- `entitlementErrorRate`

Missing SLO metrics hold canary advancement. Violated SLOs recommend rollback.

## Auto-Rollback Contract

`npm run release:gate` exits with:

- `0`: canary can advance
- `1`: hold rollout, missing metrics or manual halt
- `2`: rollback required

Wire exit code `2` to the deployment platform rollback action or previous
artifact promotion. Without that CI/Render integration, rollback is a decision
signal, not a completed platform rollback.

## Cost Guard

The release policy consumes:

- `freeCostPerUserUsd`
- `premiumCostPerUserUsd`

It compares them to:

- freemium cap: `ALERT_FREE_COST_PER_USER_MAX_USD` or 20% of
  `ALERT_FREEMIUM_NET_AD_ARPU_USD`
- premium cap: `ALERT_PREMIUM_COST_PER_USER_MAX_USD` or 30% of
  `ALERT_PREMIUM_NET_SUBSCRIPTION_ARPU_USD`

If cost exceeds the cap, the policy recommends rollback and containment:
`cache_harder`, `reduce_frequency`, and `degrade_noncritical_features`.

## Incident Response

Rollback or kill-switch activation generates an incident payload with:

- id
- severity
- description
- impact
- likely cause
- actions taken
- current status

Severity mapping:

- `SEV 1`: SOS, crash, or user-safety risk
- `SEV 2`: critical API or entitlement failure
- `SEV 3`: provider or cost degradation
- `SEV 4`: minor release hold
