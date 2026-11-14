import { expect, expectTypeOf, it } from 'vitest';
import { UnsupportedSchemaVersionError as DomainError } from '../../map/domain/errors';
import type {
  MapRepository as DomainRepository,
  MapSummary as DomainSummary,
} from '../../map/domain/map-repository';
import { byRecency as domainByRecency } from '../../map/domain/summary-order';
import type { MindMap as DomainMap } from '../../map/domain/types';
import {
  byRecency,
  type MapRepository,
  type MapSummary,
  type MindMap,
  UnsupportedSchemaVersionError,
} from './map';

it('exposes the map port and its original unsupported-version error through the account ACL', () => {
  expectTypeOf<MapRepository>().toEqualTypeOf<DomainRepository>();
  expectTypeOf<MapSummary>().toEqualTypeOf<DomainSummary>();
  expectTypeOf<MindMap>().toEqualTypeOf<DomainMap>();
  expect(UnsupportedSchemaVersionError).toBe(DomainError);
  expect(new UnsupportedSchemaVersionError(2, 1)).toMatchObject({ found: 2, supported: 1 });
});

it('exposes the original map summary comparator through the account ACL', () => {
  expect(byRecency).toBe(domainByRecency);
});
