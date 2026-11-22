import { expect, it, vi } from 'vitest';
import { POST } from './route';

it('returns a native registration POST to the registration form with a safe next path', () => {
  const request = new Request(
    'https://mindsprout.example/register/native?next=%2F%0A%2Fevil.example',
    {
      method: 'POST',
      body: new URLSearchParams('username=body-user&password=body-only'),
      headers: { cookie: 'mindsprout_session=fixture-token' },
    },
  );
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
    'https://mindsprout.example/register?next=%2F&native=unavailable',
  );
  expect(response.headers.get('set-cookie')).toBeNull();
  expect(request.bodyUsed).toBe(false);
  for (const read of reads) expect(read).not.toHaveBeenCalled();
});
