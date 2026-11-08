import { test } from '@playwright/test';

// Disposable negative probe; never merge. Deadline: 2026-11-09.
// https://github.com/DankerMu/mindsprout/issues/125
test('issue 125 runtime skip gate probe', () => {
  test.skip(true, 'Issue 125 disposable runtime skip probe; deadline 2026-11-09');
});
