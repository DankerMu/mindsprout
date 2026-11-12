---
'mindsprout': patch
---

Repair native development resource registration after cache restoration on macOS arm64 and Linux x64 GNU, preventing repeated editor reloads while preserving normal HMR and the existing readiness deadline. The same-version native packages carry explicit source and build provenance; the separate upstream SPA-only HMR subscription limitation remains.
