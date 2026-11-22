import { renderHook } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { expect, it } from 'vitest';
import {
  resumeFromPublicAuth,
  SessionNavigationScope,
  useSessionNavigation,
} from './session-navigation';

it('retires callbacks captured before sign-out or before hydrated authentication succeeds', () => {
  const { result } = renderHook(useSessionNavigation, { wrapper: SessionNavigationScope });
  const nav = result.current;
  nav.resumeAuthenticatedNavigation();
  const outgoing = nav.captureEpoch();
  expect(nav.canRedirectOnExpiry(outgoing)).toBe(true);
  nav.signOutStarted();
  const remounted = nav.captureEpoch();
  expect(nav.canRedirectOnExpiry(outgoing)).toBe(false);
  expect(nav.canRedirectOnExpiry(remounted)).toBe(false);
  resumeFromPublicAuth();
  expect(nav.canRedirectOnExpiry(nav.captureEpoch())).toBe(false);
  nav.publicAuthMounted();
  const publicEpoch = nav.captureEpoch();
  nav.publicAuthMounted();
  expect(nav.captureEpoch()).toBe(publicEpoch);
  expect(nav.canRedirectOnExpiry(publicEpoch)).toBe(false);
  nav.resumeAuthenticatedNavigation();
  expect(nav.canRedirectOnExpiry(publicEpoch)).toBe(false);
  expect(nav.canRedirectOnExpiry(outgoing)).toBe(false);
  expect(nav.canRedirectOnExpiry(nav.captureEpoch())).toBe(true);
});

it('resumes on the observed public-to-protected boundary without restarting an active epoch', () => {
  const { result } = renderHook(useSessionNavigation, { wrapper: SessionNavigationScope });
  const nav = result.current;
  nav.publicAuthMounted();
  const publicEpoch = nav.captureEpoch();
  resumeFromPublicAuth();
  const protectedEpoch = nav.captureEpoch();
  expect(nav.canRedirectOnExpiry(publicEpoch)).toBe(false);
  expect(nav.canRedirectOnExpiry(protectedEpoch)).toBe(true);
  resumeFromPublicAuth();
  expect(nav.canRedirectOnExpiry(protectedEpoch)).toBe(true);
});

it('requires the application navigation context and exposes its stable functions', () => {
  function Probe() {
    useSessionNavigation();
    return <p>ready</p>;
  }
  expect(() => renderToString(<Probe />)).toThrow('useSessionNavigation requires a provider');
  expect(
    renderToString(
      <SessionNavigationScope>
        <Probe />
      </SessionNavigationScope>,
    ),
  ).toContain('ready');
});
