import { expect, it, vi } from 'vitest';
import { POST } from './route';

it.each([
  ['login', '', 303, '/login?native=1'],
  [
    'register',
    '?next=%2Fmaps%2Fabc%3Fx%3D1%26view%3Dtree',
    303,
    '/register?native=1&next=%2Fmaps%2Fabc%3Fx%3D1%26view%3Dtree',
  ],
  ['login', '?next=%2F%2Fevil.example', 303, '/login?native=1&next=%2F'],
  ['register', '?next=https%3A%2F%2Fevil.example', 303, '/register?native=1&next=%2F'],
  ['other', '?next=%2Fmaps%2Fabc', 404, null],
] as const)(
  'POST %s%s returns %i without reading credentials',
  async (mode, query, status, location) => {
    const request = new Request(`https://untrusted.example/native-auth/${mode}${query}`, {
      method: 'POST',
      body: new URLSearchParams({ username: 'private-user', password: 'private-password' }),
    });
    const readers = (['json', 'text', 'formData', 'arrayBuffer'] as const).map((reader) =>
      vi.spyOn(request, reader),
    );

    const response = await POST(request, { params: Promise.resolve({ mode }) });

    expect(response.status).toBe(status);
    expect(response.headers.get('location')).toBe(location);
    expect(response.headers.has('set-cookie')).toBe(false);
    expect(request.bodyUsed).toBe(false);
    for (const reader of readers) expect(reader).not.toHaveBeenCalled();
  },
);
