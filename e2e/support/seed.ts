import type { Page } from '@playwright/test';

// Requests share the signed-in page's cookies without navigating or emitting page console noise.
export interface RawRecord {
  key: string;
  value: unknown;
}

export function envelopeOf(map: { id: string }, schemaVersion = 1): RawRecord {
  return { key: map.id, value: { schemaVersion, map } };
}

export async function seedRecords(page: Page, records: readonly RawRecord[]): Promise<void> {
  for (const { key, value } of records) {
    const response = await page.request.put(`/api/maps/${encodeURIComponent(key)}`, {
      data: value,
    });
    if (response.status() !== 204) {
      throw new Error(`seed: status ${String(response.status())} for key ${key}`);
    }
  }
}

export async function readRecord(page: Page, key: string): Promise<unknown> {
  const response = await page.request.get(`/api/maps/${encodeURIComponent(key)}`);
  if (response.status() === 404) return undefined;
  if (response.status() !== 200) {
    throw new Error(`read: status ${String(response.status())} for key ${key}`);
  }
  return response.json();
}
