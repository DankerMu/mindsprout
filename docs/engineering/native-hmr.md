# Native HMR maintenance

The temporary native registration repair targets **Next 16.4.5 on macOS arm64 and Linux x64 GNU**. Ownership, alternatives, rollback and upstream replacement belong to [decision 0021](../../decisions/implemented/bug-fix/0021-native-hmr-registration-maintenance.md). Machine-readable pins are in [next-swc.json](../../patches/native/next-swc.json); do not maintain a second list of digests here.

Building a candidate does not install it. Immutable published assets, exact-version package-manager overrides, a pnpm-generated lockfile, and clean frozen-install qualification on both platforms are required before this integration can merge. The native build workflow has read-only repository permissions and cannot publish releases.

## Prerequisites

- The repository's Node and pnpm versions, a frozen dependency installation, Git, npm and tar.
- The already installed `nightly-2026-08-20` Rust compiler and Cargo on `PATH`. The script selects that rustup toolchain when using rustup shims, but also accepts the exact standalone compiler. It checks the compiler commit and host target, does not install a toolchain, and rejects cross compilation.
- macOS: Xcode command-line tools, CMake and the pinned toolchain's `rust-lld` available on `PATH`. Linux: a GNU x64 host, C/C++ compiler, CMake, pkg-config and OpenSSL development headers. CI installs the pinned Rust toolchain explicitly.
- Enough disk for release and native-test Cargo outputs. `CARGO_BUILD_JOBS` may bound parallel compilation; `CARGO_TARGET_DIR` may reuse an owned Cargo cache. Do not inject `RUSTFLAGS`, compiler wrappers or `VERGEN_*` values. The script preserves upstream Cargo configuration and release features and clears CI's dirty-tree exception for the build.
- Chromium installed with `pnpm exec playwright install chromium` (Linux CI adds `--with-deps`). Browser commands require port 3000 to be unused and a writable checkout. Never run them concurrently with a dev server or source edits.

## Build and qualify a candidate

Use fresh output directories whose parents already exist. All generated native packages, logs and working directories stay outside tracked source.

```bash
mkdir -p .run
pnpm native:build .run/native-package
pnpm native:verify .run/native-package/manifest.json
pnpm native:package:test .run/native-package/manifest.json
pnpm native:test .run/native-package/manifest.json
pnpm native:browser:test
NEXT_TEST_NATIVE_DIR="$PWD/.run/native-package/package" pnpm native:browser restored-lifecycle .run/native-restored
NEXT_TEST_NATIVE_DIR="$PWD/.run/native-package/package" pnpm native:browser source-change .run/native-source
```

`native:build` fetches the exact upstream commit into an owned temporary directory, applies the hash-checked patch, creates a deterministic clean commit, and compiles with the upstream `build-native-release` Cargo flags: `--release`, `image-extended,tracing/release_max_level_trace`. The upstream build script supplies N-API linking; the resulting shared library is packaged under the official `.node` filename without generating JavaScript. Cargo runs with `--locked`; lockfile drift or dirty source fails the command. The clean source commit is independent of host platform and is the native cache namespace, not a fabricated upstream hash.

Source acquisition uses a depth-one, blob-filtered fetch and cone-mode sparse checkout of `.cargo`, `crates`, `turbopack`, `packages/next-swc`, `packages/next/src`, and `scripts`, plus root files. This is the native build/test closure; `.cargo` must remain included because it supplies required compiler configuration. Sparse materialization does not change the pinned Git tree or patched commit identity.

Success emits the manifest path and actual addon target/cache version. `manifest.json` binds source, patch, recipe, toolchain, lockfile and package bytes. `workspace.json` identifies the owned temporary checkout and Cargo output directory; retain it until `native:test` completes. After qualification, remove that specific owned workspace, not a shared Cargo cache. Failed builds retain logs and the workspace for diagnosis.

`native:verify` checks package members, hashes and integrity, loads the native addon and exercises Next's loader. `native:package:test` uses that real package at the CLI boundary and requires mismatched source, patch, lockfile, toolchain, target, binary, tarball, integrity and path inputs to fail. These negative checks are not a substitute for the package manager's wrong-integrity installation check.

`native:test` runs the full native API unit suite, backend operation tests, missing-context rejection, macro trybuild contracts and operation-declaration parser test from the same clean source. Test logs are retained beside the manifest. No test-only patch or binary replaces the package payload.

## Browser behavior contracts

Both modes use one maintained [entrypoint](../../scripts/native-hmr.mjs), real Chromium/CDP, public map creation and persisted reopening. They preserve the five-second editor-readiness deadline and reject browser warnings, errors, pageerrors and crashes. JSON, raw CDP events, screenshots, HTML, server logs and source-restoration hashes remain in the output directory. A failure exits nonzero and still attempts owned-process shutdown and restoration; it never parks a failing CI browser indefinitely.

- **`restored-lifecycle`** retains the qualified provider's compiled environment-value trigger. It exercises unchanged A→A first, A→B, a second editor round trip, and a retained library document. Before each restart it pauses only its verified Chromium process group, executes exactly one health route request on the restarted server, then resumes the browser. Each 15-second observation requires route-handler-first connection/subscription ordering, the expected compiled client literal, exactly one normal reconnect document/reload, zero resource restart messages and editor readiness within five seconds. SPA preparation must not request a document.
- **`source-change`** edits an actual rendered MapEditor literal from A to B within one dev-server lifecycle. During setup, a retained editor document load establishes and proves its route-specific chunk-list subscription. Only then does a separate library tab make its first SPA editor navigation concurrently with the source edit. The retained page must receive an actual partial MapEditor update and visibly render B without replacing its document; the target must reach editor readiness and B without a document request or reload. No manual recovery occurs after the stimulus.

The entrypoint refuses occupied port 3000 and unexpected source seams. It backs up source and the existing development cache, preserves cache contents in its owned working copy, and restores only source bytes whose hash it still owns. Shutdown sends one SIGTERM to the verified owned process group, then waits for both leader closure and every non-zombie member to exit within one total 10,000 ms deadline. It sends no further group signal after the leader exits. Source/cache restoration requires completed shutdown and a closed listener; deadline or ownership failures retain the backups. Inspect `handles.json`, `cleanup.json`, the source backup and raw events rather than overwriting changed source or signaling a PID from stale evidence. `native:browser:test` exercises these lifecycle boundaries with real processes.

## Publication and frozen installation

The Linux PR workflow uploads `native-linux-x64-gnu-<workflow SHA>`. A candidate handoff consists of the emitted `.tgz`, `manifest.json`, native-test/build logs, both browser results and cleanup evidence. The tarball filename includes target, unchanged upstream version, patch identity and the complete tarball digest. Preserve that filename when publishing; do not overwrite an asset to change its bytes.

The artifact suffix is GitHub's workflow SHA, which is the synthetic merge commit for a pull-request run, not necessarily its source head. The uploaded `native-evidence/runtime.json` records the actual checkout commit, workflow SHA, PR head SHA, run/attempt, runner image, OS release and glibc version. The lifecycle test log accompanies that identity evidence.

Publish each manifest as `<tarball filename without .tgz>.manifest.json` so the two platform manifests cannot collide. Its contents stay unchanged, and its `tarball.file` resolves beside it. Verification accepts either that published name or the local `manifest.json`.

The publisher must compare both platforms' upstream commit, patched source commit/tree, patch, recipe, Cargo.lock and compiler commit; target and binary/package digests intentionally differ. Verify each platform's actual addon load and behavior before publishing public immutable release assets. Record the actual release URLs, SHA-256 and npm SHA-512 integrity from those verified bytes. The package keeps its official name/version and adds explicit `mindsproutNativeRepair` provenance and a README identifying the local repair.

Linux qualification evidence must record the actual runner OS release and glibc version alongside the artifact identity. The build workflow selects Ubuntu 24.04; the GNU target triple and preserved official package constraints do not establish compatibility with older glibc hosts. A broader compatibility claim requires inspection of the binary's ABI and minimum required symbol versions, plus runtime qualification on the claimed baseline.

After publication, generate exact-version native overrides and the lockfile together with pnpm. Do not hand-write lockfile integrity or invent release URLs. In a clean checkout on each supported platform, run a frozen installation, then:

```bash
pnpm native:verify /absolute/path/to/published/manifest.json --installed
pnpm native:browser restored-lifecycle .run/installed-restored
pnpm native:browser source-change .run/installed-source
pnpm build
```

The published tarball must be beside its manifest for verification. These installed checks run **without `NEXT_TEST_NATIVE_DIR`**; the verifier rejects that variable and checks the binary resolved from Next's installed dependency tree. Final CI must use this installed-package path and the same browser modes, not qualify delivery from the build-only seam. A deliberately wrong package integrity must independently fail a disposable frozen installation. Installation failure is a blocker, never permission to patch `node_modules` or enable a fallback.

Installed native loading and both browser contracts must feed the existing required **All checks passed** aggregate, not only the artifact-production workflow. A Next upgrade that bypasses the exact-version native override must fail closed until equivalent proof qualifies upstream replacement and the fork is removed atomically through Renovate.

### Installed-only guard

`pnpm native:installed` verifies the installed tree without downloading or unpacking another tarball. It requires the unchanged qualified build manifest at `patches/native/published/<target>.json`, checks its source/patch/recipe/metadata pins, hashes the installed native binary, and checks package provenance and Next's actual loader. Missing publication inputs, an omitted optional package, stock or mismatched bytes, diagnostic binding variables, WASM, another loaded native addon, or an unqualified Next version all fail closed. It never repairs `node_modules` or selects a fallback.

pnpm can report a successful frozen installation after omitting an optional package whose integrity check failed. The publication cutover must therefore wire the installed-only guard into normal `postinstall`; every workflow that uses `--ignore-scripts` must invoke it explicitly. Do not enable that lifecycle integration before both genuine per-target manifests and artifact overrides are available. No absent-manifest success path is permitted.

For qualification before publication, use `pnpm native:installed --manifest <qualified-build-manifest>`. The stronger `native:verify <manifest> --installed` command still qualifies installed metadata against the exact tarball; it is not replaced by the installation guard. `--project <directory>` selects an isolated installed tree for boundary tests; normal lifecycle invocation supplies no overrides.

Run `pnpm native:installed:test <qualified-build-manifest> [stock-package-directory]` for real Next/native loader tests and controlled corrupt fixtures. The suite requires an actual unmodified official native package of the same version; supply its preserved directory after the main checkout installs the repair. It does not mock the native addon or Next loader.

## Known Limitations

- Maintenance targets are macOS arm64 and Linux x64 GNU on the Ubuntu 24.04 CI environment recorded in the qualification evidence. Compatibility with older glibc hosts is not established by this repair. Windows, macOS x64, Linux arm64 and musl are not represented as repaired.
- A distinct upstream [SPA-only HMR subscription gap](https://github.com/vercel/next.js/issues/98699) can leave an editor reached only through client navigation without its route-specific HMR subscription. Native registration repair does not fix that gap. The source-change regression's intentional retained-document setup proves preservation of legitimate subscribed HMR, not SPA-only subscription repair.
- Clean source/cache identity and pinned inputs do not promise bit-for-bit compiler output across operating systems or tool installations. Manifests bind the actual built bytes; rebuilds with different bytes require different immutable assets and renewed qualification.
