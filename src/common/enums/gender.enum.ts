/**
 * Sexe declare d'un compte parent.
 *
 * Sert a designer la personne — « Pere » ou « Mere » — la ou figurait
 * auparavant un lien de parente saisi a la main. Deux valeurs suffisent a ce
 * que l'ecole a besoin de savoir pour s'adresser correctement a la famille.
 */
export enum Gender {
  MALE = 'MALE',
  FEMALE = 'FEMALE',
}

/** Libelle du parent selon son sexe. */
export const PARENT_ROLE_LABELS: Record<Gender, string> = {
  [Gender.MALE]: 'Pere',
  [Gender.FEMALE]: 'Mere',
};
