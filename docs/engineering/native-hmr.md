# Native HMR maintenance

The temporary native registration repair targets **Next 16.4.5 on macOS arm64 and Linux x64 GNU**. Ownership, alternatives, rollback and upstream replacement belong to [decision 0021](../../decisions/implemented/bug-fix/0021-native-hmr-registration-maintenance.md). Machine-readable pins are in [next-swc.json](../../patches/native/next-swc.json); do not maintain a second list of digests here.

Supported frozen installations use the exact-version native overrides in [package.json](../../package.json), integrity recorded by [pnpm-lock.yaml](../../pnpm-lock.yaml), and byte-for-byte qualified manifests in [published/](../../patches/native/published/). The override map is the canonical publication URL inventory. Normal `postinstall` verifies the installed repair and fails if it is absent or mismatched; no Rust toolchain is needed to consume the published packages. Building another candidate does not install it. The native build workflow has read-only repository permissions and cannot publish releases.

## Native build prerequisites

- The repository's Node and pnpm versions, a frozen dependency installation, Git, npm and tar.
- The already installed `nightly-2026-08-20` Rust compiler and Cargo on `PATH`. The script selects that rustup toolchain when using rustup shims, but also accepts the exact standalone compiler. It resolves the compiler's sysroot executable, checks that executable's commit and host, and binds Cargo's `RUSTC` to it for both builds and native tests. It does not install a toolchain or cross-compile.
- macOS: Xcode command-line tools, CMake and the pinned toolchain's `rust-lld` available on `PATH`. Linux: a GNU x64 host, C/C++ compiler, CMake, pkg-config and OpenSSL development headers. CI installs the pinned Rust toolchain explicitly.
- Enough disk for release and native-test Cargo outputs. `CARGO_BUILD_JOBS` may bound parallel compilation; `CARGO_TARGET_DIR` may reuse an owned Cargo cache. Compiler selectors, wrappers, injected rustflags, target linkers/runners and `VERGEN_*` values are rejected before output creation or fetch. External Cargo home/ancestor configuration files are rejected because they can override compiler selection. `CARGO_HOME` must be an absolute, configuration-free path; relative values are rejected even without configuration files. When unset, the default home is used. The accepted home is normalized once and supplied identically to configuration inspection and subprocesses, independent of their working directories. Only the pinned checkout's upstream Cargo configuration supplies build flags. The script clears CI's dirty-tree exception and canonicalizes `TMPDIR` for build and test subprocesses, including macOS `/var` → `/private/var`, without excluding upstream tests.
- Chromium installed with `pnpm exec playwright install chromium` (Linux CI adds `--with-deps`). Browser commands require port 3000 to be unused and a writable checkout. Never run them concurrently with a dev server or source edits.
- Browser probes also require a reachable local Postgres 16 database and both `MIGRATION_DATABASE_URL` (owner) and `DATABASE_URL` (non-owner application role). Export both for the probe's child server, then run `pnpm db:setup` after frozen installation and before either browser mode. Use an owned test database, never a shared developer database or production target; setup migrates and bootstraps the app role without a destructive reset.

## Build and qualify a candidate

Use fresh output directories whose parents already exist. All generated native packages, logs and working directories stay outside tracked source.

When changing the recipe or patch, the previous publication must fail ordinary installed verification. Bootstrap **candidate qualification only** with `pnpm install --frozen-lockfile --ignore-scripts`; this neither qualifies the installed tree nor bypasses the required installed CI matrix. Build and verify the new package, then supply its manifest to both candidate browser modes below. Each mode verifies the exact tarball and requires Next to load only the manifest-bound candidate binary. After genuine two-platform rebuilding and publication, update both unchanged receipts, exact overrides and the generated lockfile atomically; ordinary installation must pass again.

```bash
mkdir -p .run
pnpm native:build .run/native-package
pnpm native:verify .run/native-package/manifest.json
pnpm native:package:test .run/native-package/manifest.json
pnpm native:test .run/native-package/manifest.json
pnpm native:browser:test
pnpm db:setup
NEXT_TEST_NATIVE_DIR="$PWD/.run/native-package/package" pnpm native:browser restored-lifecycle .run/native-restored .run/native-package/manifest.json
NEXT_TEST_NATIVE_DIR="$PWD/.run/native-package/package" pnpm native:browser source-change .run/native-source .run/native-package/manifest.json
```

`native:build` fetches the exact upstream commit into an owned temporary directory, applies the hash-checked patch, creates a deterministic clean commit, and compiles with the upstream `build-native-release` Cargo flags: `--release`, `image-extended,tracing/release_max_level_trace`. The upstream build script supplies N-API linking; the resulting shared library is packaged under the official `.node` filename without generating JavaScript. Cargo runs with `--locked`; lockfile drift or dirty source fails the command. The clean source commit is independent of host platform and is the native cache namespace, not a fabricated upstream hash.

Source acquisition uses a depth-one, blob-filtered fetch and cone-mode sparse checkout of `.cargo`, `crates`, `turbopack`, `packages/next-swc`, `packages/next/src`, and `scripts`, plus root files. This is the native build/test closure; `.cargo` must remain included because it supplies required compiler configuration. Sparse materialization does not change the pinned Git tree or patched commit identity.

Success emits the manifest path and actual addon target/cache version. `manifest.json` binds source, patch, recipe, toolchain, lockfile and package bytes. `workspace.json` identifies the owned temporary checkout and Cargo output directory; retain it until `native:test` completes. After qualification, remove that specific owned workspace, not a shared Cargo cache. Failed builds retain logs and the workspace for diagnosis.

`native:verify` checks package members, hashes and integrity, loads the native addon and exercises Next's loader. `native:package:test` uses that real package at the CLI boundary and requires mismatched source, patch, lockfile, toolchain, target, binary, tarball, integrity and path inputs to fail. These negative checks are not a substitute for the package manager's wrong-integrity installation check.

`native:test` runs the full native API unit suite, backend operation tests, missing-context rejection, macro trybuild contracts and operation-declaration parser test from the same clean source. Test logs are retained beside the manifest. No test-only patch or binary replaces the package payload.

## Browser behavior contracts

Both modes use one maintained [entrypoint](../../scripts/native-hmr.mjs), real Chromium/CDP, public map creation and persisted reopening. They preserve the five-second editor-readiness deadline and reject browser warnings, errors, pageerrors and crashes. JSON, raw CDP events, screenshots, HTML, server logs and source-restoration hashes remain in the output directory. A failure exits nonzero and still attempts owned-process shutdown and restoration; it never parks a failing CI browser indefinitely.

Before creating its first page, the probe registers a fresh `native-<UUID>` user through `context.request`, requires registration status201, then requires `/api/auth/session` status200 with that exact username in the same context. The HttpOnly session cookie is shared with subsequent pages and remains in use across restored-lifecycle server restarts; there is no re-registration on restart. These requests use the existing 5000ms default. Sign-in produces no page console events or expected non-2xx responses, so it needs no D13 declaration or noise filter. Diagnostics never include passwords, response bodies, headers or cookies; only the public username leaves the helper.

- **`restored-lifecycle`** retains the qualified provider's compiled environment-value trigger. It exercises unchanged A→A first, A→B, a second editor round trip, and a retained library document. Before each restart it pauses only its verified Chromium process group, executes exactly one health route request on the restarted server, then resumes the browser. Each 15-second observation requires route-handler-first connection/subscription ordering, the expected compiled client literal, exactly one normal reconnect document/reload, zero resource restart messages and editor readiness within five seconds. SPA preparation must not request a document.
- **`source-change`** edits an actual rendered MapEditor literal from A to B within one dev-server lifecycle. During setup, a retained editor document load establishes and proves its route-specific chunk-list subscription. Only then does a separate library tab make its first SPA editor navigation concurrently with the source edit. The retained page must receive an actual partial MapEditor update and visibly render B without replacing its document; the target must reach editor readiness and B without a document request or reload. No manual recovery occurs after the stimulus.

Before the source edit, both documents must establish their complete initial HMR inventories. After document load, the collector reconciles actual script elements with loader-scoped completed script requests and structurally reads emitted entry chunk-list metadata, without evaluating it. Those producer URLs seal an independent path-plus-headers inventory; observing one subscription cannot make another not-yet-observed producer disappear. Every resource must subscribe on the initial socket after connection at its connected version. The retained prerequisite shares its existing five-second document setup budget; the target prerequisite has its existing 5,000 ms budget. `app-ready` alone is insufficient. Setup rejects missing producers, failed scripts, document changes, mismatched versions, reloads and reconnects. Evidence retains the sealed inventory, connection, pending/matched resources and arming time. The subsequent edit-to-navigation choreography and all readiness/noise assertions remain unchanged.

The entrypoint refuses occupied port 3000 and unexpected source seams. It backs up source and the existing development cache, preserves cache contents in its owned working copy, and restores only source bytes whose hash it still owns. Shutdown sends one SIGTERM to the verified owned process group, then waits for both leader closure and every non-zombie member to exit within one total 10,000 ms deadline. It sends no further group signal after the leader exits. Source/cache restoration requires completed shutdown and a closed listener; deadline or ownership failures retain the backups. Inspect `handles.json`, `cleanup.json`, the source backup and raw events rather than overwriting changed source or signaling a PID from stale evidence. `native:browser:test` exercises these lifecycle boundaries with real processes.

In `cache-identity.json`, entries carry a cache-relative `path` and a `type`. For `file` entries, `size` is the content byte length and `sha256` hashes those bytes. For `symlink` entries, the same fields describe the link text bytes; the report does not store the text. A symlink at the cache root produces exactly one `symlink` entry at `.`. Only a missing cache path reports `absent: true`; a dangling or cyclic root link is present.

The fingerprint includes entry types and does not read, stat, or traverse link targets. Changing link text changes the fingerprint; changing only the target's contents does not. Cache backup, working-copy and restoration guards check the path itself without following links. The original root link is restored by rename, not replaced by a copy of its target. Compare fingerprints from the same runner version. See [decision 0029](../../decisions/implemented/bug-fix/0029-terminal-native-cache-symlinks.md).

The collector alone owns SIGINT/SIGTERM in both default and profiled launches; [decision 0030](../../decisions/implemented/testing/0030-native-navigation-diagnostic-profiling.md) explains the Playwright exit-130 conflict requiring this correction. Browser close and browser-process close retain their respective 5000ms budgets, and owned server-group shutdown retains its total 10,000ms budget. A nonzero interrupt exit is not restoration proof: require the actual result/cleanup records, restored source/cache identity, and closed owned runtime.

The first SIGINT/SIGTERM is retained even if it arrives after the functional assertions pass. The collector finishes cleanup before reporting failure and exiting nonzero; the interruption does not replace an earlier functional failure.

To exercise the actual runner's late-interrupt and linked-cache regressions, use a disposable checkout without `.next` or `.next-profiles`, port 3000 free, installed Chromium, and a migrated scratch database. Run `NATIVE_HMR_RUNNER_OUTPUT="$PWD/.run/runner-regression" pnpm native:browser:regression` with a fresh output directory on the checkout's filesystem. Stop the scratch database after the run.

First public map creation also retains bounded diagnostic evidence: RSC and script response/completion timestamps, response timing/status, in-memory data-delivery totals, and browser Performance metrics immediately before its readiness clock and after the outcome. Failure captures timestamp the DOM, screenshot, URL and loader independently. These observations add no HTTP requests, body dumps, warmup, retry or extended readiness deadline; they do not attribute an unexplained slow navigation to runner pressure.

See [public-create evidence](#public-create-evidence) for the fixed first-attempt fields and failure-capture attribution.

The initial root commit failure is labeled `public-map root document commit`; passive Document response/completion metadata is captured even before the RSC observation window, without extra requests or body reads, and all 5000ms deadlines and no-warmup/no-retry rules remain unchanged.

## Opt-in diagnostic profiling

Profiling collects diagnostic evidence for a qualification failure; it neither repairs root/editor latency nor substitutes for qualification. Use the same Chromium, owned Postgres, native identity, and fresh-output prerequisites as the browser modes above:

```text
pnpm native:browser MODE FRESH_OUTPUT_DIRECTORY [CANDIDATE_MANIFEST] [--profile]
```

`MODE` is `restored-lifecycle` or `source-change`. Supply `--profile` once, last, after the candidate manifest when present. Unknown, duplicate, misplaced, or surplus arguments are refused before source/cache/profile mutation. For example:

```bash
pnpm native:browser restored-lifecycle .run/profile-restored --profile
NEXT_TEST_NATIVE_DIR="$PWD/.run/native-package/package" pnpm native:browser source-change .run/profile-source .run/native-package/manifest.json --profile
```

Both default and profiled invocations reject the presence of `NEXT_CPU_PROF`, `NEXT_CPU_PROF_DIR`, `__NEXT_PRIVATE_CPU_PROFILE`, `NEXT_TURBOPACK_TRACING`, and `NEXT_TURBOPACK_TRACING_PATH`, including empty values. Unset them rather than relying on inherited Next profiling. The opt-in supplies Next's documented `--experimental-cpu-prof`; it does not enable opaque or remote tracing. Without `--profile`, the probe neither touches `.next-profiles` nor sends CDP Profiler commands or installs profiling listeners.

Profiling requires `.next-profiles` to be absent, including no existing file, directory, or broken symlink. The collector owns its creation before source/cache mutation, verifies ownership before moves, and isolates stopped server generations before restart. Unexpected entries or ownership changes are preserved, not overwritten. Raw CPU/trace files stay under `<OUTPUT>/profile-private`; diagnostic server logs and other raw run output also remain private.

Private staging and generation destinations must remain directories with the collector's recorded filesystem identity; existing raw-move targets are conflicts, not overwrite permission. A detected conflict stops the raw move and produces fixed partial diagnostics. Safe staging conflicts prevent summary publication. Pending-output cleanup removes only a regular file matching the collector-created file's identity; unrelated replacements and unknown entries are preserved. These checks cover observed conflicts, not arbitrary filesystem replacement after the last check.

Trace collection checks `.next` and `.next/dev` without following links. A linked or non-directory cache component is `unsafe-file`: before startup it prevents producer launch; after shutdown it yields partial evidence without reading or moving the external trace. An absent pre-start trace needs no isolation. Other post-stop inspection or move failures report `trace-isolation-failed` and retain any valid projected spans without claiming successful raw archival.

If `.next` becomes unsafe during a profiled run, cleanup preserves the cache backup instead of restoring through that path, and reports `cleanup-blocked`. Default cache handling is unchanged.

### Profile evidence and interpretation

For profiling artifacts, publish only `<OUTPUT>/safe/summary.json`. CI selects exactly `.run/native-diagnostic/safe/summary.json` in a separate artifact; no raw-file or directory-glob fallback is allowed. The summary contains fixed categories, numeric buckets, allowlisted spans/route classes, validated run/native identity, and observed process identity. An unobserved profile PID is null, not the pnpm launcher's PID. Function names, paths/URLs, tags, credentials, environment values, and raw exceptions are not publication fields.

Keep the clock domains separate:

- Collector brackets carry epoch and elapsed milliseconds.
- Next trace `startTime` is epoch milliseconds; trace timestamp/duration are hrtime microseconds.
- Network timestamps are monotonic seconds; `wallTime` is epoch seconds.
- CPU start/end and sample deltas originate in microseconds on an unspecified monotonic clock; histogram buckets summarize relative seconds.

CPU deltas may be signed, as in [DevTools' timestamp reconstruction](https://github.com/ChromeDevTools/devtools-frontend/blob/main/front_end/models/cpu_profile/CPUProfileDataModel.ts), but every reconstructed position must remain within the declared profile window; raw samples/deltas are preserved and only derived histogram buckets are ordered chronologically.

Do not subtract across those origins or treat sample counts as CPU utilization or exact wall-clock attribution. Trace coverage is always `observed-only`: rotation and unflushed tails can omit work. A top-level document transition marks its browser interval partial with `renderer-local-coverage`, preserving valid available CPU samples and bounded first/last collector transition brackets. Same-document navigation and subframes do not imply that loss.

Physical suspension evidence lives in the summary's `gaps` array, independently of sampled `intervals` and terminal-record reservations. Each record contains `generation`, `trial`, `page`, finite collector-elapsed `fromElapsedMs`/`toElapsedMs`, and fixed reason `browser-suspended`. Attribution is captured after successful SIGSTOP; successful SIGCONT closes it once, including cleanup-only resume or an abandoned profiler. A failed SIGSTOP creates no gap, and late CDP replies cannot restart abandoned collection. Gaps are not copied onto intervals.

The collector retains at most eight gap records under the existing interval-count bound, without evicting sampled intervals; exceeding that bound produces `browser-gap-limit`. Compact output preserves these attributed gaps and terminal causes when detailed samples/spans exceed the safe-output byte cap.

Missing, invalid, unstable, over-limit, disconnected, or interrupted collection produces fixed partial codes independently of the functional result. [Implementation limits](../../scripts/native-hmr-profile-projection.mjs) own the file/run, record/sample, generation/interval, and safe-output caps. These bound ingestion and retained evidence, not Next's raw producer memory/disk or CDP allocation before receipt. No-follow capped file reads and bounded CDP operations do not establish a hard producer-memory limit.

### Public-create evidence

Default qualification writes one `public-create-evidence` event in `events.jsonl`. Its `data` uses the same fixed projection as `publicCreate` in the opt-in profile summary. `attempt` (1), `mode`, `generation`, `trial` and `page` attribute the first-create attempt; `budget.start` and `budget.deadline` retain the original five-second window. `action` records `fulfilled` or `rejected`; `outcome` records `ready`, `action-failed` or `readiness-failed` independently. Each has its own collector timestamp. An attempt that did not start has null budget timestamps and `unavailable` action and outcome. Later navigation or a separate replay cannot replace these fields.

The default event has `status: partial` and explicit `missing-marker-observation` and `missing-route-observation` codes because it does not sample the page. It adds one CDP-close lifecycle hook, but no network/timeline listeners, profiler commands, HTTP requests, `.next-profiles` or `safe/` output. This is additive, with no migration: the legacy empty `public-create-outcome` and raw `public-create-network` stay unchanged. Neither raw capture data nor error text is part of the fixed projection. [Decisions 0035](../../decisions/implemented/testing/0035-preserve-default-public-create-evidence.md) and [0031](../../decisions/implemented/testing/0031-public-create-readiness-evidence.md) govern default and sampled evidence.

The network channel classifies same-origin item PUT/GET, editor RSC and scripts without retaining URLs, map identifiers, headers or bodies. Each redirect response belongs to the preceding hop. Excluded replacements terminate attribution; over-cap replacements retain the preceding redirect response but cannot accept subsequent response/data/completion into that hop. Standalone excluded requests consume no retained request slots. The request bound lives in [projection limits](../../scripts/native-hmr-profile-projection.mjs).

Network timestamp fields ending in `Seconds` use the CDP monotonic domain; collector receipts use the [collector clock](#profile-evidence-and-interpretation). `redirectTimestampSeconds` is the replacement request event's timestamp, not an inferred response-arrival timestamp. A completed GET proves network delivery, not parsing, repository resolution, editor-session construction or rendering. Conversely, network `completion: failed` does not establish a failed application save. CDP completion timestamps need not follow response-event receipt; preserve them without reordering or cross-clock correction.

The marker channel samples presence and Playwright-compatible visibility without reading DOM text. Opacity alone is not invisibility. Browser `timeOriginMs` and `nowMs` remain separate from collector clocks. `firstVisible` brackets the first observed visible sample with its preceding sample; it does not claim an exact visibility transition or visibility within the original deadline. Same-document route observations carry only collector receipts and do not assert a React commit.

Sampling is profile-only and begins before the original clock. Its cadence, sample/route caps and autonomous lifetime are bounded by [projection limits](../../scripts/native-hmr-profile-projection.mjs); expiry is checked before layout reads, even after a stalled callback. Invalid or out-of-order binding payloads produce fixed partial codes without retaining their raw content.

The observer registers attempt finalization before its first awaited Performance snapshot. Interruption or disconnection before the readiness clock leaves the budget, action and outcome unknown. Coded abandonment marks affected channels partial; a healthy profile route listener can legitimately observe no transitions.

CDP detachment marks the network channel partial even if Playwright can still report readiness. It does not end failed-tail capture early. If publication fails, the observer attempts a fixed `public-create-observation-error` notice without changing qualification or its persisted result.

Binding ownership is tracked independently of sampler installation. Setup preserves pre-existing globals; cleanup checks the originating document and captured function/object identities before removing owned page resources. A late acknowledgement may trigger bounded owned cleanup, but cannot revive collection or revise published evidence.

Success finalizes evidence before subsequent navigation, even if the subsequent save assertion or another trial fails. After an action or readiness failure, default qualification finalizes evidence immediately after its existing failure capture and before cleanup. Related late network receipts and the existing `failure-capture.json` carry `failed-tail` (`publicCreate.phase` in the capture); unrelated captures omit the field. A late screenshot or ready marker in captured HTML cannot qualify the attempt.

Profile success requests bounded best-effort sampler disposal. A disposal timeout leaves shutdown unknown, not stopped; residual page work remains bounded by autonomous expiry or page closure. A failed profile may keep sampling during existing capture/teardown, labelling post-outcome receipts `failed-tail`; closure, interruption or publication finalizes it without a grace period. Compact publication preserves attempt identity, budget, outcome, first-observed brackets and channel omissions/status within the safe-output cap.

Invalid provenance, budget, settlement or omission counts cannot produce complete evidence. Unknown omission counts remain null, including in compact output; rejected marker states cannot establish a visibility bracket.

### Failure-scoped CI diagnosis

The [installed-native action](../../.github/actions/native-installed-runtime/action.yml) keeps both qualification commands unprofiled. Only an eligible, non-cancelled Darwin browser-step failure selects one separately labelled diagnostic execution of the failed mode in fresh output.

The [eligibility policy](../../scripts/native-hmr-profile.mjs) requires matching failed-result evidence, verified source/cache cleanup, unchanged current source identity, and a navigation-phase failure. Initial setup failures are excluded. A restart failure needs an earlier browser-resumed event for the same generation and trial; a later cleanup resume cannot authorize replay. Missing, malformed, ambiguous, or cleanup-blocked evidence is reported ineligible without launching another probe. Successful qualifications, Linux, installation failures, and cancellation select no diagnosis.

The original failed qualification, job, and required aggregate remain red whether diagnosis passes, fails, or is ineligible. The default evidence and original raw artifacts remain separate from the replay. A useful safe summary or successful local replay is not evidence of CI capture, successful qualification, or a latency repair.

## Publication and frozen installation

The Linux PR workflow uploads `native-linux-x64-gnu-<workflow SHA>`. A candidate handoff consists of the emitted `.tgz`, `manifest.json`, native-test/build logs, both browser results and cleanup evidence. The tarball filename includes target, unchanged upstream version, patch identity and the complete tarball digest. Preserve that filename when publishing; do not overwrite an asset to change its bytes.

The artifact suffix is GitHub's workflow SHA, which is the synthetic merge commit for a pull-request run, not necessarily its source head. The uploaded `native-evidence/runtime.json` records the actual checkout commit, workflow SHA, PR head SHA, run/attempt, runner image, OS release and glibc version. The lifecycle test log accompanies that identity evidence.

Publish each manifest as `<tarball filename without .tgz>.manifest.json` so the two platform manifests cannot collide. Its contents stay unchanged, and its `tarball.file` resolves beside it. Verification accepts either that published name or the local `manifest.json`.

Package-manager overrides consume only the compact `<target>-<full-tarball-sha256>.tgz` assets in the same release. They contain identical qualified bytes; the original build filenames remain available for manifest-adjacent exact-tarball verification, not as installation fallbacks. Compact names avoid pnpm 10.28 embedding an overlong full URL in a CAFS index filename; [decision 0021](../../decisions/implemented/bug-fix/0021-native-hmr-registration-maintenance.md) records that boundary.

The publisher must compare both platforms' upstream commit, patched source commit/tree, patch, recipe, Cargo.lock and compiler commit; target and binary/package digests intentionally differ. Verify each platform's actual addon load and behavior before publishing public immutable release assets. Record the actual release URLs, SHA-256 and npm SHA-512 integrity from those verified bytes. The package keeps its official name/version and adds explicit `mindsproutNativeRepair` provenance and a README identifying the local repair.

Linux qualification evidence must record the actual runner OS release and glibc version alongside the artifact identity. The build workflow selects Ubuntu 24.04; the GNU target triple and preserved official package constraints do not establish compatibility with older glibc hosts. A broader compatibility claim requires inspection of the binary's ABI and minimum required symbol versions, plus runtime qualification on the claimed baseline.

For a maintenance publication, copy the unchanged qualified manifests into `patches/native/published/`, update exact-version native overrides, and [regenerate the lockfile](dependency-patches.md#regenerate-the-lockfile). Do not hand-write lockfile integrity or alter published manifest bytes. In a clean checkout on each supported platform:

```bash
pnpm install --frozen-lockfile
pnpm native:installed
pnpm native:verify /absolute/path/to/published/manifest.json --installed
pnpm db:setup
pnpm native:browser restored-lifecycle .run/installed-restored
pnpm native:browser source-change .run/installed-source
pnpm build
```

The stronger tarball qualification command requires the published tarball beside its manifest. Installed checks run **without `NEXT_TEST_NATIVE_DIR`**; the verifier rejects that variable and checks the binary resolved from Next's installed dependency tree. Installation failure is a blocker, never permission to patch `node_modules` or enable a fallback.

The required **All checks passed** aggregate includes two independent jobs: `native-installed-runtime` on Ubuntu 24.04 and `native-installed-runtime-darwin` on `macos-26`. Their public check names remain **Installed native HMR (linux-x64-gnu)** and **Installed native HMR (darwin-arm64)**. Linux uses a healthy `postgres:16` service; macOS starts an owned Homebrew `postgresql@16` cluster under `$RUNNER_TEMP/native-postgres` and always attempts to stop it after qualification. Each job owns `app_native`, sets `MIGRATION_DATABASE_URL=postgres://app:app@127.0.0.1:5432/app_native` and `DATABASE_URL=postgres://mindsprout_app:app@127.0.0.1:5432/app_native`, and invokes the same [composite action](../../.github/actions/native-installed-runtime/action.yml). It runs frozen installation, `pnpm db:setup`, installed addon verification, corrupt-artifact installation regression, native unit tests, both browser modes and a production build, with always-upload evidence. Neither job cancels the other; neither may fail or be skipped. [Decision0027](../../decisions/implemented/testing/0027-signed-in-native-hmr-database.md) owns this database/sign-in topology.

The independent [native build workflow](../../.github/workflows/native-hmr.yml) qualifies freshly built candidates. Its `linux-native` job uses the same Linux Postgres16 service, `app_native` URLs and `pnpm db:setup`, immediately after its frozen `--ignore-scripts` candidate bootstrap. It retains candidate build/test steps, the 180-minute budget, `NEXT_TEST_NATIVE_DIR` and candidate artifacts; it does not invoke the installed-only action. Candidate qualification must also pass when changing the shared probe, but cannot substitute for either required installed-package check and is not an aggregate dependency.

A Next upgrade that bypasses the exact-version native override fails closed until equivalent proof qualifies upstream replacement and the fork is removed atomically through Renovate.

### Installed-only guard

`pnpm native:installed` verifies the installed tree without downloading or unpacking another tarball. It requires the unchanged qualified build manifest at `patches/native/published/<target>.json`, checks its source/patch/recipe/metadata pins, hashes the installed native binary, and checks package provenance and Next's actual loader. Missing publication inputs, an omitted optional package, stock or mismatched bytes, diagnostic binding variables, WASM, another loaded native addon, or an unqualified Next version all fail closed. It never repairs `node_modules` or selects a fallback.

pnpm can report a successful frozen installation after omitting an optional package whose integrity check failed. Normal `postinstall` therefore runs the installed-only guard with fixed committed manifests. Script-disabled project installations must explicitly run `pnpm native:installed` afterward, except for the candidate-only bootstrap described above, whose output is not an installed qualification. Lockfile-only generation does not install packages or qualify the installed tree. No absent-manifest success path is permitted.

For qualification before publication, use `pnpm native:installed --manifest <qualified-build-manifest>`. The stronger `native:verify <manifest> --installed` command still qualifies installed metadata against the exact tarball; it is not replaced by the installation guard. `--project <directory>` selects an isolated installed tree for boundary tests; normal lifecycle invocation supplies no overrides.

Run `pnpm native:installed:test <qualified-build-manifest> [stock-package-directory]` for real Next/native loader tests and controlled corrupt fixtures. The suite requires an actual unmodified official native package of the same version; supply its preserved directory after the main checkout installs the repair. It does not mock the native addon or Next loader.

`pnpm native:install:test <fresh-evidence-directory>` downloads the exact current published artifact and checks its SHA-256 and SHA-512 against the committed manifest. A disposable project uses the real Next package and normal postinstall guard. The test generates a lockfile from those valid bytes, proves a successful frozen installation, then corrupts only the fixture tarball, removes only fixture dependencies, and repeats the unchanged frozen installation with a fresh store. The omitted optional native package must make postinstall fail. Download identities, generated lockfile, install logs and final outcomes are retained as evidence; published bytes and the working installation are never modified.

## Known Limitations

- Maintenance targets are macOS arm64 and Linux x64 GNU. Required installed qualification targets `macos-26` arm64 and Ubuntu 24.04 respectively. The published Linux artifact's qualification baseline is Ubuntu 24.04.5 with glibc 2.39; compatibility with older glibc hosts is not established. Windows, macOS x64, Linux arm64 and musl are not represented as repaired.
- A distinct upstream [SPA-only HMR subscription gap](https://github.com/vercel/next.js/issues/98699) can leave an editor reached only through client navigation without its route-specific HMR subscription. Native registration repair does not fix that gap. The source-change regression's intentional retained-document setup proves preservation of legitimate subscribed HMR, not SPA-only subscription repair.
- The source-change contract starts from an established target HMR connection. It does not claim to repair the separate cold-tab initial connection/global-version race; the baseline prerequisite above isolates that race without suppressing its protocol messages or accepting recovery reloads.
- Clean source/cache identity and pinned inputs do not promise bit-for-bit compiler output across operating systems or tool installations. Manifests bind the actual built bytes; rebuilds with different bytes require different immutable assets and renewed qualification.
- Diagnostic profiling does not establish exact compiler/runner attribution or repair root/editor latency; its [coverage and allocation limits](#profile-evidence-and-interpretation) remain explicit.
