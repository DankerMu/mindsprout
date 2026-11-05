import { registerOTel } from '@vercel/otel';

// OpenTelemetry init (Next.js instrumentation hook). Trace context propagates via W3C headers;
// the exporter endpoint comes from OTEL_EXPORTER_OTLP_ENDPOINT. Metrics are deferred to M2.
export function register() {
  registerOTel({ serviceName: 'mindsprout' });
}
