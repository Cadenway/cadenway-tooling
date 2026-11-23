import { fixtureId } from './fixture-id.js';

/**
 * Type FixtureMemberRole
 *
 * @description
 * Role of a member in an organization, as the members page of the mockup lists them.
 *
 * @type {'owner' | 'admin' | 'member' | 'guest'}
 */
export type FixtureMemberRole = 'owner' | 'admin' | 'member' | 'guest';

/**
 * Type FixtureInitials
 *
 * @description
 * Initials of the four people of the mockup, used wherever it assigns or quotes someone.
 *
 * @type {'CM' | 'IR' | 'HD' | 'LP'}
 */
export type FixtureInitials = 'CM' | 'IR' | 'HD' | 'LP';

/**
 * Interface FixtureOrganization
 *
 * @description
 * One organization of the mockup.
 */
export interface FixtureOrganization {
  // #region Properties
  /**
   * Property id
   *
   * @description
   * Stable UUID written for the tests; the mockup gives none.
   *
   * @type {string}
   * @readonly
   */
  readonly id: string;

  /**
   * Property key
   *
   * @description
   * Short key of the organization switcher of the mockup, such as `AN`.
   *
   * @type {string}
   * @readonly
   */
  readonly key: string;

  /**
   * Property name
   *
   * @description
   * Display name.
   *
   * @type {string}
   * @readonly
   */
  readonly name: string;

  /**
   * Property slug
   *
   * @description
   * Path segment of the organization in the application address of the mockup.
   *
   * @type {string}
   * @readonly
   */
  readonly slug: string;

  /**
   * Property planLabel
   *
   * @description
   * Name of the plan as the mockup shows it, in French. It is a label, not a contract key.
   *
   * @type {string}
   * @readonly
   */
  readonly planLabel: string;
  // #endregion
}

/**
 * Interface FixturePerson
 *
 * @description
 * One person of the mockup, with the membership the mockup gives them in the organization of the
 * fixture.
 */
export interface FixturePerson {
  // #region Properties
  /**
   * Property id
   *
   * @description
   * Stable UUID written for the tests; the mockup gives none.
   *
   * @type {string}
   * @readonly
   */
  readonly id: string;

  /**
   * Property initials
   *
   * @description
   * Initials the mockup uses on avatars and assignments.
   *
   * @type {FixtureInitials}
   * @readonly
   */
  readonly initials: FixtureInitials;

  /**
   * Property name
   *
   * @description
   * Full name.
   *
   * @type {string}
   * @readonly
   */
  readonly name: string;

  /**
   * Property email
   *
   * @description
   * E-mail address of the members page of the mockup.
   *
   * @type {string}
   * @readonly
   */
  readonly email: string;

  /**
   * Property role
   *
   * @description
   * Role in the organization of the fixture.
   *
   * @type {FixtureMemberRole}
   * @readonly
   */
  readonly role: FixtureMemberRole;

  /**
   * Property mfaEnabled
   *
   * @description
   * Whether the members page shows two-factor authentication as active.
   *
   * @type {boolean}
   * @readonly
   */
  readonly mfaEnabled: boolean;
  // #endregion
}

/**
 * Interface AtelierNordFixture
 *
 * @description
 * The organization Atelier Nord and the four people the mockup works with.
 */
export interface AtelierNordFixture {
  // #region Properties
  /**
   * Property organization
   *
   * @description
   * Atelier Nord.
   *
   * @type {FixtureOrganization}
   * @readonly
   */
  readonly organization: FixtureOrganization;

  /**
   * Property CM
   *
   * @description
   * Camille Martin, owner, the signed-in user of the mockup.
   *
   * @type {FixturePerson}
   * @readonly
   */
  readonly CM: FixturePerson;

  /**
   * Property IR
   *
   * @description
   * Inès Robert, administrator.
   *
   * @type {FixturePerson}
   * @readonly
   */
  readonly IR: FixturePerson;

  /**
   * Property HD
   *
   * @description
   * Hugo Dubois, administrator.
   *
   * @type {FixturePerson}
   * @readonly
   */
  readonly HD: FixturePerson;

  /**
   * Property LP
   *
   * @description
   * Léa Petit, member.
   *
   * @type {FixturePerson}
   * @readonly
   */
  readonly LP: FixturePerson;

  /**
   * Property members
   *
   * @description
   * The four people, in the order of the members page.
   *
   * @type {readonly FixturePerson[]}
   * @readonly
   */
  readonly members: readonly FixturePerson[];
  // #endregion
}

/**
 * Interface CooperativeLumenFixture
 *
 * @description
 * A second organization of the mockup, for the tests that prove one organization cannot reach
 * the data of another.
 */
export interface CooperativeLumenFixture {
  // #region Properties
  /**
   * Property organization
   *
   * @description
   * Coopérative Lumen.
   *
   * @type {FixtureOrganization}
   * @readonly
   */
  readonly organization: FixtureOrganization;

  /**
   * Property CM
   *
   * @description
   * Camille Martin as the mockup shows her there: the same person, with the role of a member.
   *
   * @type {FixturePerson}
   * @readonly
   */
  readonly CM: FixturePerson;
  // #endregion
}

/**
 * Function person
 *
 * @description
 * Builds one frozen person.
 *
 * @param {number} index - Rank on the members page, which gives the stable id.
 * @param {FixtureInitials} initials - Initials of the person.
 * @param {string} name - Full name.
 * @param {string} email - E-mail address.
 * @param {FixtureMemberRole} role - Role in the organization.
 * @returns {FixturePerson} The person.
 */
function person(
  index: number,
  initials: FixtureInitials,
  name: string,
  email: string,
  role: FixtureMemberRole,
): FixturePerson {
  return Object.freeze({
    id: fixtureId('user', index),
    initials,
    name,
    email,
    role,
    mfaEnabled: true,
  });
}

/**
 * Constant CAMILLE
 *
 * @description
 * Camille Martin in Atelier Nord (`Organisation.dc.html`, `MEMBERS`).
 *
 * @type {FixturePerson}
 */
const CAMILLE: FixturePerson = person(
  1,
  'CM',
  'Camille Martin',
  'camille.martin@ateliernord.fr',
  'owner',
);

/**
 * Constant ATELIER_NORD
 *
 * @description
 * Atelier Nord: `ORGS` of `App.dc.html` for the organization, `MEMBERS` of `Organisation.dc.html`
 * for the people.
 *
 * @type {AtelierNordFixture}
 */
const ATELIER_NORD: AtelierNordFixture = ((): AtelierNordFixture => {
  const IR: FixturePerson = person(2, 'IR', 'Inès Robert', 'ines.robert@ateliernord.fr', 'admin');
  const HD: FixturePerson = person(3, 'HD', 'Hugo Dubois', 'hugo.dubois@ateliernord.fr', 'admin');
  const LP: FixturePerson = person(4, 'LP', 'Léa Petit', 'lea.petit@ateliernord.fr', 'member');
  return Object.freeze({
    organization: Object.freeze({
      id: fixtureId('organization', 1),
      key: 'AN',
      name: 'Atelier Nord',
      slug: 'atelier-nord',
      planLabel: 'Équipe',
    }),
    CM: CAMILLE,
    IR,
    HD,
    LP,
    members: Object.freeze([CAMILLE, IR, HD, LP]),
  });
})();

/**
 * Constant COOPERATIVE_LUMEN
 *
 * @description
 * Coopérative Lumen (`ORGS` of `App.dc.html`), where Camille Martin is a member.
 *
 * @type {CooperativeLumenFixture}
 */
const COOPERATIVE_LUMEN: CooperativeLumenFixture = Object.freeze({
  organization: Object.freeze({
    id: fixtureId('organization', 2),
    key: 'CL',
    name: 'Coopérative Lumen',
    slug: 'lumen',
    planLabel: 'Entreprise',
  }),
  CM: Object.freeze({ ...CAMILLE, role: 'member' as const }),
});

/**
 * Function atelierNord
 *
 * @description
 * Returns the organization Atelier Nord and its people: Camille Martin (CM), Inès Robert (IR),
 * Hugo Dubois (HD) and Léa Petit (LP). The data is frozen: spread it to derive a variant.
 *
 * @returns {AtelierNordFixture} The organization and its people.
 */
export function atelierNord(): AtelierNordFixture {
  return ATELIER_NORD;
}

/**
 * Function cooperativeLumen
 *
 * @description
 * Returns a second organization, Coopérative Lumen, to test that one organization cannot read or
 * change the data of another.
 *
 * @returns {CooperativeLumenFixture} The organization and the membership of Camille Martin.
 */
export function cooperativeLumen(): CooperativeLumenFixture {
  return COOPERATIVE_LUMEN;
}
