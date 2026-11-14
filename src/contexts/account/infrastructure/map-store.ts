import type { Sql } from 'postgres';
import {
  type MapRepository,
  type MapSummary,
  type MindMap,
  UnsupportedSchemaVersionError,
} from '../acl/map';

type MapRow = { map: MindMap } & Record<'schema_version', number>;

export class PostgresMapStore {
  constructor(private readonly sql: Sql) {}

  forUser(userId: string): MapRepository {
    return {
      list: () =>
        this.sql.begin(async (tx) => {
          await tx`select set_config('app.user_id', ${userId}, true)`;
          const rows = await tx<MapSummary[]>`
          select id, title, updated_at as "updatedAt" from maps
          where title is not null and updated_at is not null
          order by updated_at desc, id collate "C" asc
        `;
          return Array.from(rows);
        }),
      get: (id) =>
        this.sql.begin(async (tx) => {
          await tx`select set_config('app.user_id', ${userId}, true)`;
          const [row] = await tx<MapRow[]>`select map, schema_version from maps where id = ${id}`;
          if (!row) return undefined;
          if (row.schema_version > 1)
            throw new UnsupportedSchemaVersionError(row.schema_version, 1);
          return row.map;
        }),
      put: (map) =>
        this.sql.begin(async (tx) => {
          await tx`select set_config('app.user_id', ${userId}, true)`;
          await tx`
          insert into maps (owner_id, id, schema_version, map)
          values (${userId}, ${map.id}, 1, ${tx.json(map)})
          on conflict (owner_id, id) do update
          set schema_version = excluded.schema_version, map = excluded.map
        `;
        }),
      delete: (id) =>
        this.sql.begin(async (tx) => {
          await tx`select set_config('app.user_id', ${userId}, true)`;
          await tx`delete from maps where id = ${id}`;
        }),
    };
  }
}
