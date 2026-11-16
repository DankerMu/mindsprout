import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { config, proxy } from './proxy';

describe('sign-in proxy', () => {
  it('redirects a missing session cookie to same-origin login with the complete path and query', () => {
    const request = new NextRequest(
      'https://mindsprout.example:8443/maps/abc?view=tree&next=https%3A%2F%2Fevil.example&next=%2Fother',
    );
    const response = proxy(request);

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'https://mindsprout.example:8443/login?next=%2Fmaps%2Fabc%3Fview%3Dtree%26next%3Dhttps%253A%252F%252Fevil.example%26next%3D%252Fother',
    );
    expect(request.nextUrl.href).toBe(
      'https://mindsprout.example:8443/maps/abc?view=tree&next=https%3A%2F%2Fevil.example&next=%2Fother',
    );
  });

  it.each(['', 'stale-session', 'forged-session'])(
    'passes through when the session cookie exists with value "%s"',
    (value) => {
      const response = proxy(
        new NextRequest('https://mindsprout.example/maps/abc', {
          headers: { cookie: `mindsprout_session=${value}` },
        }),
      );

      expect(response.status).toBe(200);
      expect(response.headers.get('x-middleware-next')).toBe('1');
      expect(response.headers.get('location')).toBeNull();
    },
  );

  it('does not mistake another cookie for the session cookie', () => {
    const response = proxy(
      new NextRequest('https://mindsprout.example/', {
        headers: { cookie: 'other=mindsprout_session' },
      }),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://mindsprout.example/login?next=%2F');
  });
});

describe('sign-in proxy matcher', () => {
  it.each([
    '/login',
    '/login?next=%2Fmaps%2Fabc',
    '/register',
    '/register?next=%2F',
    '/api/',
    '/api/healthz',
    '/api/auth/session',
    '/api/maps/abc',
    '/_next/static',
    '/_next/static/chunks/app.js',
    '/_next/static-extra',
    '/_next/image',
    '/_next/image?url=%2Ficon.svg&w=64&q=75',
    '/_next/image-extra',
    '/icon.svg',
    '/icon.svg?v=1',
  ])('leaves public surface %s outside the proxy', (url) => {
    expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url })).toBe(false);
  });

  it.each([
    '/',
    '/maps/abc',
    '/maps/abc?view=tree',
    '/admin',
    '/login/child',
    '/register/child',
    '/login-extra',
    '/register-extra',
    '/apiary',
    '/api',
    '/icon.svg/child',
    '/icon.svg-extra',
    '/iconXsvg',
    '/_next/other',
  ])('protects page %s', (url) => {
    expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url })).toBe(true);
  });
});
