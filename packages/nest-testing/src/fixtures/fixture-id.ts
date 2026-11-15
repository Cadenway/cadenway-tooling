/**
 * Type FixtureIdGroup
 *
 * @description
 * Kind of entity a stable fixture id is built for. Each kind has its own range, so two entities
 * never share an id.
 *
 * @type {'organization' | 'user' | 'space' | 'list' | 'task'}
 */
export type FixtureIdGroup = 'organization' | 'user' | 'space' | 'list' | 'task';

/**
 * Constant GROUP_CODES
 *
 * @description
 * Second block of the UUID, by kind of entity.
 *
 * @type {Readonly<Record<FixtureIdGroup, string>>}
 */
const GROUP_CODES: Readonly<Record<FixtureIdGroup, string>> = {
  organization: '0001',
  user: '0002',
  space: '0003',
  list: '0004',
  task: '0005',
};

/**
 * Function fixtureId
 *
 * @description
 * Builds the stable UUID of a fixture entity. The mockup gives no UUID: these are written for the
 * tests, shaped as UUID version 7 so they pass the same validation as an id PostgreSQL generates.
 * The last block is the index in decimal, so task `CAD-482` ends in `000000000482`.
 *
 * @param {FixtureIdGroup} group - Kind of entity.
 * @param {number} index - Positive integer, unique inside the kind, below 10^12.
 * @returns {string} The UUID, for example `0193a1f0-0005-7000-8000-000000000482`.
 * @throws {RangeError} When the index is not an integer from 1 to 999 999 999 999.
 */
export function fixtureId(group: FixtureIdGroup, index: number): string {
  if (!Number.isInteger(index) || index < 1 || index > 999_999_999_999) {
    throw new RangeError('A fixture id index is an integer from 1 to 999999999999.');
  }
  return `0193a1f0-${GROUP_CODES[group]}-7000-8000-${String(index).padStart(12, '0')}`;
}
