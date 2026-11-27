// Terminal error codes of a generation (design D5). `timeout` is raised by `generate`, not by a
// provider, so it has no provider error class.
export type ProviderErrorCode = 'timeout' | 'provider-error' | 'invalid-output' | 'refused';

// Messages are internal diagnostics: never put model output, provider bodies, keys or the topic
// in them (ai-provider "Errors never leak provider detail or user input").
abstract class ProviderError extends Error {
  abstract readonly code: ProviderErrorCode;
}

// Model output failed validation (schema, unknown parent, duplicate temporary id). Never repaired.
export class ProviderOutputError extends ProviderError {
  override readonly name = 'ProviderOutputError';
  override readonly code = 'invalid-output';
}

// Transport or HTTP failure talking to the provider.
export class ProviderTransportError extends ProviderError {
  override readonly name = 'ProviderTransportError';
  override readonly code = 'provider-error';
}

// The provider refused to answer. Not retried (design D5).
export class ProviderRefusedError extends ProviderError {
  override readonly name = 'ProviderRefusedError';
  override readonly code = 'refused';
}
