/**
 * Longueur minimale d'un mot de passe choisi par un utilisateur.
 *
 * Alignee sur celle des mots de passe provisoires que le serveur genere
 * lui-meme (`generateTemporaryPassword`) : il n'y avait aucune raison
 * d'imposer aux utilisateurs un plancher plus bas que ce que le logiciel se
 * donne. Ces comptes ouvrent l'acces aux donnees personnelles d'eleves et a
 * la caisse.
 *
 * Le controle porte sur la longueur seule, sans exigence de casse ni de
 * caractere special : ces regles poussent surtout a ecrire le mot de passe
 * sur un papier colle a l'ecran, ce qu'un guichet partage ne pardonne pas.
 */
export const MIN_PASSWORD_LENGTH = 10;

export const PASSWORD_TOO_SHORT = `Le mot de passe doit comporter au moins ${MIN_PASSWORD_LENGTH} caracteres.`;
