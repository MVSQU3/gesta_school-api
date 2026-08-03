import type { CookieOptions, Response } from 'express';

/** Nom du cookie de session. */
export const SESSION_COOKIE = 'gesta_session';

/** Durée de vie du cookie, alignée sur celle du jeton (24 h). */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Options du cookie de session, définies à un seul endroit.
 *
 * `httpOnly` est le cœur du dispositif : le jeton devient invisible pour le
 * JavaScript de la page. Une faille XSS ne permet plus de l'exfiltrer et de
 * s'en servir ailleurs — au pire l'attaquant agit depuis le navigateur de la
 * victime, le temps de sa session.
 *
 * `sameSite: 'lax'` protège du CSRF : le navigateur n'envoie pas le cookie sur
 * les requêtes POST, PATCH ou DELETE déclenchées depuis un autre site. C'est
 * suffisant tant que l'interface et l'API partagent le même domaine
 * enregistrable — un port ou un sous-domaine différent reste « same-site ».
 * Si vous les déployez un jour sur deux domaines distincts, il faudra passer à
 * `sameSite: 'none'` avec `secure`, et ajouter un jeton anti-CSRF.
 */
export function sessionCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    // En HTTP clair, un cookie `secure` ne serait jamais envoyé : on ne
    // l'active qu'en production, où le trafic est chiffré.
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE_MS,
  };
}

/** Pose le cookie de session sur la réponse. */
export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions());
}

/**
 * Efface le cookie de session.
 *
 * Les attributs doivent correspondre à ceux de la pose, sans quoi le
 * navigateur conserverait le cookie d'origine.
 */
export function clearSessionCookie(res: Response): void {
  const { maxAge: _ignored, ...options } = sessionCookieOptions();
  res.clearCookie(SESSION_COOKIE, options);
}
