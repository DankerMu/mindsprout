import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  type ProviderErrorCode,
  ProviderOutputError,
  ProviderRefusedError,
  ProviderTransportError,
} from './errors';

describe('provider errors', () => {
  it.each([
    [ProviderOutputError, 'ProviderOutputError', 'invalid-output'],
    [ProviderTransportError, 'ProviderTransportError', 'provider-error'],
    [ProviderRefusedError, 'ProviderRefusedError', 'refused'],
  ] as const)('%o carries its name, code, message and cause', (ErrorClass, name, code) => {
    const cause = new Error('underlying');
    const error = new ErrorClass('diagnostic', { cause });

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ErrorClass);
    expect(error.name).toBe(name);
    expect(error.code).toBe(code);
    expect(error.message).toBe('diagnostic');
    expect(error.cause).toBe(cause);
  });

  it('keeps the three classes distinct', () => {
    expect(new ProviderOutputError('x')).not.toBeInstanceOf(ProviderTransportError);
    expect(new ProviderTransportError('x')).not.toBeInstanceOf(ProviderRefusedError);
    expect(new ProviderRefusedError('x')).not.toBeInstanceOf(ProviderOutputError);
  });

  it('the error-code union is exactly timeout, provider-error, invalid-output and refused', () => {
    expectTypeOf<ProviderErrorCode>().toEqualTypeOf<
      'timeout' | 'provider-error' | 'invalid-output' | 'refused'
    >();
  });
});
