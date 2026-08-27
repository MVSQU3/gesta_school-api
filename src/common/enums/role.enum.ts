export enum Role {
  SUPER_ADMIN = 'SUPER_ADMIN',
  DIRECTOR = 'DIRECTOR',
  SECRETARY = 'SECRETARY',
  ACCOUNTANT = 'ACCOUNTANT',
  /** Saisit les notes des matières et classes qui lui sont affectées. */
  TEACHER = 'TEACHER',
  /**
   * Parent ou tuteur. Role en lecture seule, et le seul dont la portee n'est
   * pas l'etablissement entier mais quelques eleves nommement rattaches : le
   * `schoolId` du jeton ne suffit pas a l'autoriser, chaque acces passe en
   * plus par la table de liaison `parent_students`.
   */
  PARENT = 'PARENT',
}
