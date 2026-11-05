import { describe, expect, it, vi } from 'vitest';

const { registerOTelMock } = vi.hoisted(() => ({ registerOTelMock: vi.fn() }));
vi.mock('@vercel/otel', () => ({ registerOTel: registerOTelMock }));

import { register } from './instrumentation';

describe('instrumentation.register', () => {
  it('initialises OpenTelemetry under the service name', () => {
    register();

    expect(registerOTelMock).toHaveBeenCalledWith({ serviceName: 'mindsprout' });
  });
});
