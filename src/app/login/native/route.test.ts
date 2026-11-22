import { expect, it, vi } from 'vitest';
import { POST } from './route';

it('returns a native login POST to the login form without reading credentials or cookies', () => {
  const request = new Request('https://mindsprout.example/login/native?next=%2Fmaps%2Fabc', {
    method: 'POST',
    body: new URLSearchParams('username=body-user&password=body-only'),
    headers: { cookie: 'mindsprout_session=fixture-token' },
  });
  const reads = [
    vi.spyOn(request, 'body', 'get'),
    vi.spyOn(request, 'headers', 'get'),
    vi.spyOn(request, 'formData'),
    vi.spyOn(request, 'json'),
    vi.spyOn(request, 'text'),
  ];

  const response = POST(request);

  expect(response.status).toBe(303);
  expect(response.headers.get('location')).toBe(
    'https://mindsprout.example/login?next=%2Fmaps%2Fabc&native=unavailable',
  );
  expect(response.headers.get('set-cookie')).toBeNull();
  expect(request.bodyUsed).toBe(false);
  for (const read of reads) expect(read).not.toHaveBeenCalled();
});
