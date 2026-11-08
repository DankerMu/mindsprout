import { test, expect } from '@playwright/test';

// Disposable negative probe; never merge. Deadline: 2026-11-09.
// https://github.com/DankerMu/mindsprout/issues/125
test('issue 125 ordinary assertion failure probe', () => {
  expect(1, 'Issue 125: ordinary assertion failures must fail the E2E job').toBe(2);
});
