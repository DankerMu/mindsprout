# OrbStack 2.2.1 static RE: telemetry + licensing

## Target
- `/Applications/OrbStack.app` v2.2.1 (build 20628)
- Bundle ID: `dev.kdrag0n.MacVirt`
- Main: SwiftUI app + Sentry Cocoa; Helper: Go (`vmgr`) + sentry-go + Sparkle

## Findings
1. **Sentry crash telemetry present** with hardcoded DSN to `o120089.ingest.us.sentry.io/4504665519554560` in both OrbStack and OrbStack Helper.
2. **No product analytics SDKs** (Segment/Mixpanel/Amplitude/PostHog) found as real integrations.
3. **License checkin DRM** package `github.com/orbstack/macvirt/vmgr/drm` talks to `https://api-license.orbstack.dev`; derives hardware identifiers via IOKit (`SerialNumber`, `MacAddress`, `PlatformUUID`) + `~/.orbstack/.installid` (`iid`).
4. Checkin payload fields include usage counters: `currentMachines`, `currentContainers`, `currentNetworks`, `currentSystemDf` plus entitlement status/tier.
5. **Pro gate**: UI `_presentRequiresLicense` + "Debug Shell requires Pro"; pricing free personal / Pro commercial $8/user/mo.
6. Sparkle `SUEnableSystemProfiling=1` for update checks to `api-updates.orbstack.dev`.
7. Feedback endpoint `api-misc.orbstack.dev/api/v1/app/feedbacks` (user-initiated).

## Method
Static strings/symbol extraction + official privacy/pricing cross-check. No packet capture this run.

## Next if needed
- MITM `api-license` checkin body
- Frida hook `DoCheckin` / Sentry transport
