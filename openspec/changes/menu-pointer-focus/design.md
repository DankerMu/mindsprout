# Design

1. Change surface: the existing ContextMenu container pointer handler; e2e/context-menu.spec.ts and e2e/context-menu-focus.spec.ts share fixture helpers from e2e/support/context-menu.ts.
2. Governing invariant: a press inside an open menu must not strand focus outside it while leaving the menu open and keyboard controls unreachable.
3. Must preserve: menu ownership/stale-session validation, disabled root restrictions, selection, TreeOp/history grouping, submenu activation/navigation and dismissal focus restoration.
4. Must preserve: enabled mouse clicks execute one action and close the menu; native title-input focus/contextmenu defaults stay untouched.
5. The browser focus default is the confirmed failure boundary; do not add global focus listeners, timers, deferred refocusing, retries or app-state workarounds.
6. Prevent the default in the existing menu pointerdown containment handler, retaining stopPropagation in both pointerdown and mousedown. Native event tracing shows disabled buttons suppress mousedown entirely while pointerdown remains observable and cancellable; mouse-only prevention cannot preserve their focus.
7. Sibling surfaces: enabled menu items, disabled items, parent-menu padding, nested color submenu and title inputs outside the menu portal. Audit these without changing their action contracts.
8. Seams under test: real browser document.activeElement, menu visibility, ArrowDown/Escape routing, exact persisted action result and undo, and native right-click defaultPrevented state on title inputs.
9. Historical counterexample: .workplans/27/review/focus-probe.log records disabled and padding presses changing BUTTON/inMenu:true to BODY/inMenu:false, with Escape leaving one menu open and zero browser noise.
10. New regression qualification: first author a disabled-Delete native mouse regression; parent runs it against unchanged source and preserves the semantic RED before the fix.
11. Use page.mouse coordinates for disabled Delete and the menu's 2px padding. Do not force-click a disabled locator, dispatch synthetic DOM events, call focus after the press or route keys through a locator that focuses itself.
12. After a press assert usable in-menu focus, send page.keyboard ArrowDown to an enabled next item, then page.keyboard Escape; menu closes and canvas regains focus without a map/history change.
13. Add the padding case after the first fix; the historical padding counterexample is already recorded, so do not weaken the fix to manufacture RED for the second case.
14. Enabled-action proof must inspect a single observable map change and one undo restoration, not a mock callback count.
15. Native title-input proof uses an actual right-click and observes focus, unchanged draft, absence of custom menu and an uncancelled contextmenu event; no OS-menu screenshot claim.
16. Production-mode browser verification uses the existing owner-approved #79 exception: build the current source, run pnpm start, wait for health, run unchanged Playwright timeouts/retries, stop the owned server afterward.
17. This does not fix or claim coverage of development HMR/first-navigation issue79; preserve warning/error/pageerror assertions and screenshots.
18. Run both complete menu browser files after the focused regression, covering all existing color submenu, enabled operation, note and dismissal cases plus the four focus/compatibility regressions. Split files preserve the 700-line gate without dropping assertions or duplicating fixtures.
19. Parent owns test execution, frozen fixture and acceptance; implementer edits source/tests/changeset only and never changes the oracle to clear a failure.
20. Scoped verification: existing ContextMenu component tests with per-file coverage, lint/typecheck/boundaries, changed-file formatting, and actual browser surface. CI remains exhaustive.
21. Non-goals: menu redesign, store/menu action changes, general canvas shortcuts, persistence/schema migrations, dependency changes and gate/config modifications.
22. Rollback: revert the isolated event-default correction and its regression/changeset as one change; no stored-data migration or cleanup is needed.
