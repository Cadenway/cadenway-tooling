import {
  atelierNord,
  cooperativeLumen,
  type AtelierNordFixture,
  type CooperativeLumenFixture,
} from './atelier-nord.js';
import { sprint14, statuses, type FixtureStatus, type Sprint14Fixture } from './sprint-14.js';

/**
 * Interface Fixtures
 *
 * @description
 * The fixtures taken from the mockup. They are plain data: no table, no rule. Each service maps
 * them to its own tables.
 */
export interface Fixtures {
  // #region Methods
  /**
   * Method atelierNord
   *
   * @description
   * Returns the organization Atelier Nord and its people: CM, IR, HD and LP.
   *
   * @returns {AtelierNordFixture} The organization and its people.
   */
  atelierNord(): AtelierNordFixture;

  /**
   * Method cooperativeLumen
   *
   * @description
   * Returns a second organization, for the tests of isolation between organizations.
   *
   * @returns {CooperativeLumenFixture} The organization and the membership of Camille Martin.
   */
  cooperativeLumen(): CooperativeLumenFixture;

  /**
   * Method sprint14
   *
   * @description
   * Returns Sprint 14 of the space Produit, with the task `CAD-482`.
   *
   * @returns {Sprint14Fixture} The space, the sprint, the statuses and the tasks.
   */
  sprint14(): Sprint14Fixture;

  /**
   * Method statuses
   *
   * @description
   * Returns the ten default statuses of the mockup.
   *
   * @returns {readonly FixtureStatus[]} The statuses, in the order of the mockup.
   */
  statuses(): readonly FixtureStatus[];
  // #endregion
}

/**
 * Constant fixtures
 *
 * @description
 * Entry to the mockup fixtures: `fixtures.atelierNord()`, `fixtures.sprint14()`. A failing test
 * then names what the product shows: Atelier Nord, Camille Martin, `CAD-482`.
 *
 * @type {Fixtures}
 */
export const fixtures: Fixtures = Object.freeze({
  atelierNord,
  cooperativeLumen,
  sprint14,
  statuses,
});
