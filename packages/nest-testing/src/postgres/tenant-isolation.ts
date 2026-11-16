import type { PoolClient } from 'pg';

import { quoteIdentifier, type TestDatabase } from './test-database.js';

/**
 * Interface TenantIsolationOptions
 *
 * @description
 * What `checkTenantIsolation` and `assertTenantIsolation` probe.
 */
export interface TenantIsolationOptions {
  // #region Properties
  /**
   * Property table
   *
   * @description
   * Name of a table of the `public` schema that has an `organization_id` column.
   *
   * @type {string}
   * @readonly
   */
  readonly table: string;

  /**
   * Property organizationId
   *
   * @description
   * UUID of the organization that owns rows of the table. Seed at least one row for it first:
   * an empty table proves nothing.
   *
   * @type {string}
   * @readonly
   */
  readonly organizationId: string;

  /**
   * Property otherOrganizationId
   *
   * @description
   * UUID of another organization, which must neither read nor change those rows.
   *
   * @type {string}
   * @readonly
   */
  readonly otherOrganizationId: string;
  // #endregion
}

/**
 * Interface TenantIsolationReport
 *
 * @description
 * What the application role can do to the rows of one organization, from each point of view.
 */
export interface TenantIsolationReport {
  // #region Properties
  /**
   * Property table
   *
   * @description
   * Table that was probed.
   *
   * @type {string}
   * @readonly
   */
  readonly table: string;

  /**
   * Property enabled
   *
   * @description
   * Whether row-level security is enabled on the table.
   *
   * @type {boolean}
   * @readonly
   */
  readonly enabled: boolean;

  /**
   * Property forced
   *
   * @description
   * Whether row-level security is forced, so the owner of the table is subject to it too.
   *
   * @type {boolean}
   * @readonly
   */
  readonly forced: boolean;

  /**
   * Property ownedRows
   *
   * @description
   * Rows of the organization as the superuser counts them.
   *
   * @type {number}
   * @readonly
   */
  readonly ownedRows: number;

  /**
   * Property visibleToOwner
   *
   * @description
   * Rows of the organization it reads itself. Equal to `ownedRows` when isolation holds.
   *
   * @type {number}
   * @readonly
   */
  readonly visibleToOwner: number;

  /**
   * Property visibleToOther
   *
   * @description
   * Rows of the organization the other organization reads. Zero when isolation holds.
   *
   * @type {number}
   * @readonly
   */
  readonly visibleToOther: number;

  /**
   * Property visibleWithoutOrganization
   *
   * @description
   * Rows of the table a transaction with no organization and no system access reads. Zero when
   * isolation holds.
   *
   * @type {number}
   * @readonly
   */
  readonly visibleWithoutOrganization: number;

  /**
   * Property writableByOther
   *
   * @description
   * Rows of the organization the other organization could update or delete. Zero when isolation
   * holds. The attempt is rolled back.
   *
   * @type {number}
   * @readonly
   */
  readonly writableByOther: number;

  /**
   * Property failures
   *
   * @description
   * One sentence per broken guarantee; empty when isolation holds.
   *
   * @type {readonly string[]}
   * @readonly
   */
  readonly failures: readonly string[];
  // #endregion
}

/**
 * Interface UnprotectedTable
 *
 * @description
 * A table with an `organization_id` column that row-level security does not fully protect.
 */
export interface UnprotectedTable {
  // #region Properties
  /**
   * Property table
   *
   * @description
   * Name of the table, in the `public` schema.
   *
   * @type {string}
   * @readonly
   */
  readonly table: string;

  /**
   * Property reason
   *
   * @description
   * What is missing: `not-enabled`, `not-forced` or `no-policy`.
   *
   * @type {'not-enabled' | 'not-forced' | 'no-policy'}
   * @readonly
   */
  readonly reason: 'not-enabled' | 'not-forced' | 'no-policy';
  // #endregion
}

/**
 * Class RollbackProbe
 *
 * @description
 * Carries the result of a write attempt out of a transaction that must roll back.
 */
class RollbackProbe extends Error {
  // #region Constructor
  /**
   * Constructor
   *
   * @description
   * Stores the number of rows the attempt reached.
   *
   * @param {number} rows - Rows the attempt would have changed.
   * @constructor
   */
  public constructor(public readonly rows: number) {
    super('Rolled back on purpose.');
  }
  // #endregion
}

/**
 * Function count
 *
 * @description
 * Reads the single integer a counting query returns.
 *
 * @param {{ rows: unknown[] }} result - Result of a `select count(*)::int as n` query.
 * @returns {number} The count.
 */
function count(result: { rows: unknown[] }): number {
  return (result.rows[0] as { n: number }).n;
}

/**
 * Function attemptWrites
 *
 * @description
 * Tries, as one organization, to update then delete the rows of another, and reports how many
 * rows the statements reached. A statement the role may not run reaches none. Nothing is kept:
 * the transaction always rolls back.
 *
 * @param {TestDatabase} database - Database to probe.
 * @param {string} table - Quoted table name.
 * @param {TenantIsolationOptions} options - Organizations of the probe.
 * @returns {Promise<number>} Rows another organization could change.
 */
async function attemptWrites(
  database: TestDatabase,
  table: string,
  options: TenantIsolationOptions,
): Promise<number> {
  /**
   * Function reach
   *
   * @description
   * Runs one write behind a savepoint and returns the rows it reached, zero when refused.
   *
   * @param {PoolClient} client - Connection of the transaction.
   * @param {string} statement - Write statement taking the organization id.
   * @returns {Promise<number>} Rows reached.
   */
  const reach = async (client: PoolClient, statement: string): Promise<number> => {
    await client.query('savepoint probe');
    try {
      const result: { rowCount: number | null } = await client.query(statement, [
        options.organizationId,
      ]);
      return result.rowCount ?? 0;
    } catch {
      await client.query('rollback to savepoint probe');
      return 0;
    }
  };
  try {
    await database.asOrganization(
      options.otherOrganizationId,
      async (client: PoolClient): Promise<never> => {
        const updated: number = await reach(
          client,
          `update ${table} set organization_id = organization_id where organization_id = $1`,
        );
        const deleted: number = await reach(
          client,
          `delete from ${table} where organization_id = $1`,
        );
        throw new RollbackProbe(Math.max(updated, deleted));
      },
    );
  } catch (error) {
    if (error instanceof RollbackProbe) {
      return error.rows;
    }
    throw error;
  }
  return 0;
}

/**
 * Function checkTenantIsolation
 *
 * @description
 * Probes one table with the application role and reports whether an organization can read or
 * change the rows of another: row-level security enabled and forced, the application role held
 * to it, every row visible to its organization, none visible to another organization or to a
 * transaction without one, none writable by another organization.
 *
 * @param {TestDatabase} database - Database of the service under test, migrated and seeded.
 * @param {TenantIsolationOptions} options - Table and organizations to probe.
 * @returns {Promise<TenantIsolationReport>} The observations and the broken guarantees.
 */
export async function checkTenantIsolation(
  database: TestDatabase,
  options: TenantIsolationOptions,
): Promise<TenantIsolationReport> {
  const table: string = `public.${quoteIdentifier(options.table)}`;
  const failures: string[] = [];
  const flags: { rows: { enabled: boolean; forced: boolean; owner: string }[] } =
    await database.admin.query(
      `select c.relrowsecurity as enabled, c.relforcerowsecurity as forced,
              pg_get_userbyid(c.relowner) as owner
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = $1 and c.relkind in ('r', 'p')`,
      [options.table],
    );
  const flag: { enabled: boolean; forced: boolean; owner: string } | undefined = flags.rows[0];
  if (flag === undefined) {
    throw new Error(`No table public.${options.table} in the test database.`);
  }
  if (!flag.enabled) {
    failures.push(`Row-level security is not enabled on ${options.table}.`);
  }
  if (!flag.forced) {
    failures.push(
      `Row-level security is not forced on ${options.table}: add ` +
        `ALTER TABLE "${options.table}" FORCE ROW LEVEL SECURITY to its migration.`,
    );
  }
  if (flag.owner === database.roles.app) {
    failures.push(`The application role owns ${options.table}: the migrator role must own it.`);
  }
  const role: { rows: { privileged: boolean }[] } = await database.admin.query(
    'select (rolsuper or rolbypassrls) as privileged from pg_roles where rolname = $1',
    [database.roles.app],
  );
  if (role.rows[0]?.privileged !== false) {
    failures.push('The application role is a superuser or bypasses row-level security.');
  }

  const owned: string = `select count(*)::int as n from ${table} where organization_id = $1`;
  const ownedRows: number = count(await database.admin.query(owned, [options.organizationId]));
  if (ownedRows === 0) {
    failures.push(
      `${options.table} has no row of organization ${options.organizationId}: seed one, ` +
        'an empty table proves nothing.',
    );
  }
  const visibleToOwner: number = await database.asOrganization(
    options.organizationId,
    async (client: PoolClient): Promise<number> =>
      count(await client.query(owned, [options.organizationId])),
  );
  if (visibleToOwner !== ownedRows) {
    failures.push(
      `Organization ${options.organizationId} reads ${String(visibleToOwner)} of its ` +
        `${String(ownedRows)} rows of ${options.table}.`,
    );
  }
  const visibleToOther: number = await database.asOrganization(
    options.otherOrganizationId,
    async (client: PoolClient): Promise<number> =>
      count(await client.query(owned, [options.organizationId])),
  );
  if (visibleToOther !== 0) {
    failures.push(
      `Organization ${options.otherOrganizationId} reads ${String(visibleToOther)} rows of ` +
        `organization ${options.organizationId} in ${options.table}.`,
    );
  }
  const visibleWithoutOrganization: number = count(
    await database.app.query(`select count(*)::int as n from ${table}`),
  );
  if (visibleWithoutOrganization !== 0) {
    failures.push(
      `A transaction with no organization reads ${String(visibleWithoutOrganization)} rows ` +
        `of ${options.table}.`,
    );
  }
  const writableByOther: number = await attemptWrites(database, table, options);
  if (writableByOther !== 0) {
    failures.push(
      `Organization ${options.otherOrganizationId} can change ${String(writableByOther)} ` +
        `rows of organization ${options.organizationId} in ${options.table}.`,
    );
  }
  return {
    table: options.table,
    enabled: flag.enabled,
    forced: flag.forced,
    ownedRows,
    visibleToOwner,
    visibleToOther,
    visibleWithoutOrganization,
    writableByOther,
    failures,
  };
}

/**
 * Function assertTenantIsolation
 *
 * @description
 * Proves that one organization cannot read or change the rows another owns in a table, and
 * throws with every broken guarantee otherwise. Call it once per tenant-owned table, after
 * seeding a row for the first organization.
 *
 * @param {TestDatabase} database - Database of the service under test, migrated and seeded.
 * @param {TenantIsolationOptions} options - Table and organizations to probe.
 * @returns {Promise<TenantIsolationReport>} The observations, when isolation holds.
 * @throws {Error} When a guarantee is broken, listing each one.
 */
export async function assertTenantIsolation(
  database: TestDatabase,
  options: TenantIsolationOptions,
): Promise<TenantIsolationReport> {
  const report: TenantIsolationReport = await checkTenantIsolation(database, options);
  if (report.failures.length > 0) {
    throw new Error(
      `Tenant isolation is broken on ${options.table}:\n- ${report.failures.join('\n- ')}`,
    );
  }
  return report;
}

/**
 * Function findUnprotectedTables
 *
 * @description
 * Lists the tables of the `public` schema that have an `organization_id` column without full
 * row-level security: not enabled, not forced, or without any policy. An empty list is what a
 * migrated service database must give.
 *
 * @param {TestDatabase} database - Database of the service under test, migrated.
 * @returns {Promise<UnprotectedTable[]>} The tables and what each one misses, by table name.
 */
export async function findUnprotectedTables(database: TestDatabase): Promise<UnprotectedTable[]> {
  const result: { rows: { table: string; enabled: boolean; forced: boolean; policies: number }[] } =
    await database.admin.query(
      `select c.relname as "table", c.relrowsecurity as enabled, c.relforcerowsecurity as forced,
              (select count(*)::int from pg_policy p where p.polrelid = c.oid) as policies
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
         join pg_attribute a on a.attrelid = c.oid
        where n.nspname = 'public' and c.relkind in ('r', 'p')
          and a.attname = 'organization_id' and not a.attisdropped
        order by c.relname`,
    );
  const unprotected: UnprotectedTable[] = [];
  for (const row of result.rows) {
    if (!row.enabled) {
      unprotected.push({ table: row.table, reason: 'not-enabled' });
    } else if (!row.forced) {
      unprotected.push({ table: row.table, reason: 'not-forced' });
    } else if (row.policies === 0) {
      unprotected.push({ table: row.table, reason: 'no-policy' });
    }
  }
  return unprotected;
}
