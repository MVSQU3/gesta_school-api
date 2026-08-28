# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Structure du dépôt

Le dossier parent **n'est pas un dépôt git**. Il contient deux projets indépendants,
chacun avec son propre `.git` :

- `gesta_school-api/` — NestJS 11 + TypeORM + PostgreSQL
- `gesta_school-web/` — React 19 + Vite + Tailwind 4

Un changement qui touche les deux (ajout de champ, nouvelle route) produit donc **deux
commits dans deux dépôts**. La documentation transverse (audits, plan, jeu de données de
test) est versionnée dans `gesta_school-api/docs/` ; les copies à la racine du dossier
parent n'en sont que des doubles de travail.

## Commandes

```bash
# API (depuis gesta_school-api/)
npm run dev                  # NestJS en watch, port 3001
npm test                     # Jest, 42 suites
npx jest src/parents         # une suite ou un dossier
npx jest -t "assertGuardianOf" # un test par son nom
npm run lint                 # ESLint --fix
npm run migration:run        # applique les migrations en attente
npm run migration:show       # état des migrations (à vérifier avant d'en écrire une)
npm run migration:generate src/migrations/NomDeLaMigration
npm run seed

# Web (depuis gesta_school-web/)
npm run dev                  # Vite, port 5173
npm test                     # Vitest
npm run build                # tsc -b && vite build
npm run lint
```

`.claude/launch.json` démarre le front. Côté web, `npm test` lance Vitest.

## Architecture

### Multi-tenant : l'invariant central

Chaque `School` est un tenant étanche. Tout membre du personnel porte un `schoolId` dans
son JWT, et **ne peut jamais désigner une autre école** — seul le `SUPER_ADMIN`, rattaché
à aucune école, passe un `?schoolId=` explicite.

Ce contrôle est concentré dans [`resolveSchoolId()`](gesta_school-api/src/common/utils/resolve-school.ts),
appelé par les 16 contrôleurs. **Toute nouvelle route qui lit ou écrit des données
d'établissement doit passer par lui**, et le service doit filtrer sur `schoolId` en base.
Trois fichiers de tests y sont dédiés (`src/common/utils/controllers-tenancy*.spec.ts`).

Piège connu : `RolesGuard` laisse passer tout utilisateur authentifié sur un handler
**sans** `@Roles`. Un nouveau handler sans décorateur est donc ouvert à tous les rôles.

### Rôles

`SUPER_ADMIN`, `DIRECTOR`, `SECRETARY`, `ACCOUNTANT`, `TEACHER`, `PARENT`.

`PARENT` est le seul rôle dont la portée n'est **pas** l'établissement : le `schoolId` du
jeton ne suffit pas à l'autoriser. Chaque lecture passe par
`ParentsService.assertGuardianOf()`, qui vérifie la table de liaison `parent_students`
*en plus* du `schoolId`. Une route de l'espace parent qui oublierait cet appel ouvrirait
l'établissement entier. Les routes parent vivent sous `/api/v1/parents/me/…` et ne
réutilisent jamais une route d'établissement.

### Cycle de vie d'une inscription — « Enrôlement Éclair 72h »

`PENDING_PAYMENT` → (versement) `PARTIALLY_PAID` → (solde réglé) `ENROLLED`
`PENDING_PAYMENT` → (72 h sans versement) `EXPIRED` → écran « Les Oubliés » → renouvellement

L'expiration est appliquée à deux endroits, volontairement : un cron horaire
(`src/cron/expiration-cron.service.ts`) qui alimente l'écran de rattrapage, et une
vérification synchrone à chaque encaissement. Un dossier déjà entamé n'expire plus.

### Année scolaire

`AcademicYear.isActive` est un simple drapeau, **sans dates**. Activer une année clôture
les autres dans une transaction (`activateExclusively`). Conséquences :

- « année close » ne peut signifier que `isActive: false` — il faut donc **activer**
  l'année suivante avant d'y inscrire qui que ce soit ;
- les périodes de notation sont générées **à l'ouverture** de l'année, d'après
  `School.periodSystem` (3 trimestres ou 2 semestres). Changer ce réglage ensuite ne
  régénère rien.

### Argent

- Les références (`INS-CMB-26-0001`, `REC-CMB-26-0012`) viennent de la table `counters`,
  via un `INSERT … ON CONFLICT` atomique par `(schoolId, scope, year)`. Ne jamais les
  dériver d'un `COUNT()`.
- `PaymentsService.processPayment` et `cancel` sont transactionnels et verrouillent la
  ligne d'inscription en `pessimistic_write`.
- Un versement annulé n'est **jamais supprimé** : il reste avec son motif et son auteur,
  et continue d'apparaître barré au journal de caisse.
- Le solde se calcule uniquement via `BalanceService.compute()` — jamais en recalculant
  dans un service métier, pour qu'un parent lise le même chiffre que le guichet.

### Journal d'audit

`AuditModule` est `@Global` : aucune importation nécessaire. `AuditService.record()` avale
ses propres erreurs et s'appelle avec `void` — un journal en panne ne doit jamais bloquer
une opération métier.

**Toujours émettre après la validation d'une transaction, jamais dedans** : sinon le
journal consigne une opération qu'une annulation fait disparaître.

Ajouter une action impose trois écritures : l'énumération `AuditAction`, le
`Record<AuditAction, string>` de `ACTION_LABELS` (le compilateur l'exige), **et**
`AUDIT_ACTION_LABELS` côté web, qui est une copie manuelle alimentant le filtre.

### Frontend

- Le JWT vit dans un **cookie httpOnly** : le JavaScript n'y a jamais accès. `useAuthStore`
  ne garde qu'un profil d'affichage ; le serveur fait autorité.
- React Query pour les lectures, Zustand pour l'état de session/école/barre latérale.
- **Ne jamais afficher un état vide sans avoir traité l'erreur.** Un `data ?? []` seul fait
  dire « aucun versement sur cette période » à une API en panne. Utiliser
  [`QueryPanel`](gesta_school-web/src/components/QueryPanel.tsx) ou, a minima,
  [`errorMessage()`](gesta_school-web/src/api/errorMessage.ts) qui remonte la phrase du
  serveur.
- Les messages d'erreur de l'API sont rédigés pour l'utilisateur final : les afficher tels
  quels plutôt que de les remplacer.

## Conventions

Le code est commenté **en français**, et les commentaires expliquent le *pourquoi* —
l'arbitrage retenu, l'incident évité — jamais le *quoi*. C'est la convention dominante ;
s'y conformer dans toute contribution.

Le schéma n'évolue **que par migrations**. `DB_SYNCHRONIZE` reste à `false` : il supprime
sans prévenir les colonnes qu'il ne reconnaît pas. Vérifier `npm run migration:show` avant
d'écrire une migration — si la précédente est déjà appliquée, il en faut une nouvelle
plutôt qu'un amendement.

## Configuration

L'API **refuse de démarrer** si `JWT_SECRET` est absent ou fait moins de 32 caractères, ou
si `CORS_ORIGINS` est vide en production. Voir `.env.example` des deux projets, largement
commentés.

`VITE_API_URL` est figée **au build** par Vite : changer d'adresse impose de reconstruire
le front.

## Dette connue

- ~28 700 erreurs Prettier (CRLF et formatage) sur `gesta_school-api/src`, 34 alertes
  ESLint côté web. Ne pas lancer un `lint --fix` global au détour d'une tâche : le diff
  noierait le vrai changement.
- Les gestionnaires d'erreur inline utilisent `error: any` — c'est le style en place.
- `audit_chaine_complete.md` à la racine liste les manques identifiés et, en fin de
  document, les pistes déjà explorées et écartées.
