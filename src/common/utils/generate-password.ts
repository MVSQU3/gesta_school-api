import { randomInt } from 'crypto';

/**
 * Alphabet volontairement restreint : ni 0/O, ni 1/l/I, ni 5/S.
 *
 * Un mot de passe provisoire est lu à voix haute ou recopié à la main depuis
 * l'écran du directeur. Les caractères ambigus y provoquent des échecs de
 * connexion que personne ne sait expliquer.
 */
const ALPHABET = 'ABCDEFGHJKMNPQRTUVWXYZabcdefghjkmnpqrtuvwxyz2346789';

/**
 * Génère un mot de passe provisoire lisible.
 * `randomInt` s'appuie sur le générateur cryptographique de Node, pas sur
 * Math.random.
 */
export function generateTemporaryPassword(length = 10): string {
  let password = '';
  for (let i = 0; i < length; i++) {
    password += ALPHABET[randomInt(ALPHABET.length)];
  }
  return password;
}
