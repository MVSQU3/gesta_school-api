import { ValueTransformer } from 'typeorm';

/**
 * Les colonnes `decimal` de PostgreSQL sont renvoyées par le driver `pg` sous
 * forme de chaînes de caractères, afin de ne pas perdre en précision.
 *
 * Sans conversion, `enrollment.totalDue - payment.amount` produit une
 * concaténation de chaînes au lieu d'une soustraction. Ce transformateur
 * garantit que les montants sont manipulés comme des nombres côté application.
 */
export const numericTransformer: ValueTransformer = {
  to: (value?: number | null) => value,
  from: (value?: string | null): number => (value === null || value === undefined ? 0 : Number(value)),
};

/**
 * Variante pour les colonnes `decimal` réellement nullables.
 *
 * `numericTransformer` ramène null à 0, ce qui convient à un montant mais pas
 * à une note : une note absente doit rester `null` pour être neutralisée dans
 * les moyennes, alors qu'un 0 vaudrait un zéro pointé.
 */
export const nullableNumericTransformer: ValueTransformer = {
  to: (value?: number | null) => value,
  from: (value?: string | null): number | null =>
    value === null || value === undefined ? null : Number(value),
};
