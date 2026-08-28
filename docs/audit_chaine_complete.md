# Registre des points ouverts — Gesta School

> **Mis à jour** : 27 août 2026 — tous les points ont été traités ou tranchés.
> Ce document est désormais versionné dans `gesta_school-api/docs/`.
> Chaque point a été **vérifié dans le code** au moment de la rédaction, pas
> déduit. Les points corrigés sont listés en fin de document pour éviter qu'on
> les réexamine.

---

## Vue d'ensemble

| | Point | Sévérité | Effort |
|---|---|---|---|
| **A** | Dettes non reportées d'une année sur l'autre | 🔴 | Décision de gestion |
| **B** | `renew()` ignore l'année clôturée | 🟠 | Petit |
| **C** | Quatre opérations multi-écritures sans transaction | 🟠 | Moyen |
| **D** | Dix services écrivent sans journaliser | 🟠 | Moyen |
| **E** | Cinq actions d'audit déclarées, jamais émises | 🟡 | Petit |
| **F** | Périodes de notation non clôturées avec l'année | 🟡 | Petit |
| **G** | Sans année active : 404 ici, zéro ailleurs | 🟡 | Petit |
| **H** | Mot de passe : 6 caractères minimum | 🟡 | Petit |
| **I** | Listes d'élèves et de parents non paginées | 🟡 | Moyen |
| **J** | Aucun test frontend | 🟡 | Grand |
| **K** | 28 700 erreurs Prettier / CRLF | ⚪ | Mécanique |
| **L** | Import inutilisé `SharedFile` | ⚪ | Trivial |
| **M** | Documents racine versionnés nulle part | ⚪ | Trivial |
| **N** | `Sidebar` et `MyScheduleCard` sans état d'erreur | ⚪ | Assumé |

---

## 🔴 A — Les dettes ne suivent pas l'élève d'une année à l'autre

Aucun mécanisme de report. Un dossier `PARTIALLY_PAID` de l'année N le reste
indéfiniment. La famille se réinscrit l'année suivante avec un dossier neuf, et
l'ardoise de l'an dernier **n'apparaît nulle part au guichet**.

C'est le manque le plus lourd financièrement, et le seul qui soit d'abord une
**décision de gestion** : report automatique sur le nouveau dossier, ou simple
alerte à l'encaissement ? Les deux se codent, mais pas de la même façon.

---

## 🟠 B — Renouveler un dossier contourne le garde-fou d'année close

`EnrollmentsService.renew()` ne regarde pas l'année. Renouveler un dossier
expiré d'une année clôturée le repasse en `PENDING_PAYMENT` **dans cette année
close** — ce que la création interdit désormais explicitement.

Le chemin est atteignable : « Les Oubliés » permet de sélectionner une année
passée, et le bouton « Renouveler » y est actif.

Deux réponses possibles, à trancher : refuser le renouvellement sur une année
close, ou basculer le dossier renouvelé vers l'année active — plus pratique,
mais cela déplace un dossier d'une année à l'autre et touche aux références
comptables.

---

## 🟠 C — Quatre opérations écrivent plusieurs fois sans transaction

Vérifiées une par une ; les autres services n'enchaînent qu'une écriture par
méthode et ne sont pas concernés.

| Opération | Risque si interruption |
|---|---|
| `EnrollmentsService.bulkEnroll` | Lot à moitié créé — 30 dossiers sur 50, sans moyen de savoir où reprendre. Le mécanisme `skipped` traite les refus métier, pas les pannes. |
| `GradingPeriodsService.regenerateForAcademicYear` | `remove()` puis génération : une panne entre les deux laisse l'année **sans aucune période**, donc aucune saisie de notes possible. |
| `ParentsService.createParent` | Compte parent créé sans enfant rattaché — il ne verra rien, et personne ne saura à quoi le rattacher. |
| `AbsencesService.record` | Appel d'une classe partiellement enregistré. |

`processPayment`, `cancel` et `activateExclusively` sont déjà transactionnels.

---

## 🟠 D — Dix services écrivent en base sans laisser de trace

`absences`, `academic-years`, `admin`, `evaluations`, `schedule`, `subjects`,
`teaching`, `transfers`, plus `cron` et `audit` (légitimes : l'un agit seul,
l'autre *est* le journal).

Modifier une note, supprimer une absence, réaffecter un enseignant sont des
actes contestables par une famille, et rien ne les retrace.

**À trancher** : le journal doit-il couvrir la pédagogie, ou rester
administratif et financier ? La réponse détermine l'ampleur du travail.

---

## 🟡 E — Cinq actions d'audit déclarées, jamais émises

```
ENROLLMENT_RENEWED
ACADEMIC_YEAR_CREATED   ACADEMIC_YEAR_UPDATED
SCHOOL_CREATED          SCHOOL_DELETED
```

Elles alimentent `ACTION_LABELS`, donc le filtre du journal propose cinq entrées
qui ne ramèneront jamais rien. `ENROLLMENT_RENEWED` est la plus gênante :
renouveler un dossier expiré est une décision de guichet, elle devrait se voir.

---

## 🟡 F — Les périodes ne se clôturent pas avec l'année

`GradingPeriod.isClosed` reste manuel. Un enseignant peut donc encore saisir des
notes sur le 3ᵉ trimestre d'une année terminée.

---

## 🟡 G — Sans année active, deux écrans réagissent différemment

`StudentsService.resolveAcademicYearId` lève une **404** — « Aucune année
scolaire active n'a été configurée ». Le tableau de bord, lui, dégrade
proprement en affichant zéro. Les deux devraient se comporter pareil.

Cas atteint dès qu'on clôture une année sans en activer une autre.

---

## 🟡 H — Le plancher de mot de passe est plus bas que ce que le système produit

`MinLength(6)` sur la connexion, la création de compte et le changement. Ces
comptes ouvrent l'accès aux données personnelles d'élèves et à la caisse.

Le mot de passe provisoire généré par le serveur fait **10 caractères** tirés
cryptographiquement : le minimum imposé aux utilisateurs est plus faible que ce
que le logiciel se donne à lui-même.

Le rate-limit couvre `/auth`, ce qui est le bon endroit — l'attaque en ligne est
freinée. Le risque porte sur la réutilisation d'un mot de passe faible ailleurs.

---

## 🟡 I — Deux listes grossissent sans pagination

La pagination n'existe que dans `audit`, `enrollments` et `payments`.

- `StudentsService.findAllBySchool()` — tous les élèves inscrits sur une année ;
- `ParentsService.findAllOfSchool()` — tous les comptes parents de l'école.

Les autres listes sont naturellement bornées (classes, matières, périodes,
personnel) et ne justifient pas de pagination.

---

## 🟡 J — Aucun test frontend

Zéro fichier de test dans `gesta_school-web`. Côté API : 818 tests, 42 suites.

Les écrans les plus exposés sont ceux qui manipulent de l'argent
(`CaisseGuichet`, `JournalCaisse`) et le contrôle d'accès (`ProtectedRoute`,
`useAuthStore`).

---

## ⚪ K — 28 700 erreurs Prettier

Fins de ligne CRLF et formatage, sur l'ensemble de `gesta_school-api/src`.
*(Le chiffre de « ~2 300 » cité dans `CLAUDE.md` ne portait que sur les
contrôleurs — il est corrigé.)*

Ne pas lancer un `lint --fix` global au détour d'une tâche : le diff noierait
le vrai changement. À traiter dans un commit dédié, ou pas du tout.

Côté web : 34 alertes ESLint, dont des `setState` dans des effets et des
avertissements *Fast refresh*, toutes antérieures aux travaux du jour.

---

## ⚪ L — Import inutilisé

`SharedFile` dans `gesta_school-web/src/components/TransfersManager.tsx:20`.
Seule erreur de `tsc -b` sur tout le front.

---

## ⚪ M — Les documents de la racine ne sont versionnés nulle part

Le dossier parent n'est pas un dépôt git. `CLAUDE.md`,
`audit_chaine_complete.md`, `audit_multi_tenant.md`, `implementation_plan.md`,
`jeu_de_donnees_test.md` et `cahier_des_charges.txt` vivent uniquement sur le
disque. Une réinstallation les perd.

---

## ⚪ N — Deux écrans sans état d'erreur, volontairement

`Sidebar` et `MyScheduleCard`. Une erreur y masque un sélecteur d'école ou une
carte secondaire, sans rien affirmer de faux. Les faire échouer bruyamment
dégraderait la navigation pour un bénéfice nul.

---

# Corrigé — ne pas réexaminer

- **Cloisonnement multi-tenant** — les 20 failles de `audit_multi_tenant.md`
  sont fermées ; les 16 contrôleurs passent par `resolveSchoolId()`.
- **Routes ouvertes par défaut** — `RolesGuard` laisse passer un handler sans
  `@Roles`. Audit des 21 contrôleurs : seuls `auth/me` (qui doit l'être) et
  `schools/findAll|findOne` (déjà bornés à l'école de l'appelant). Sain.
- **Journal des paiements** — `PAYMENT_RECEIVED` et `PAYMENT_CANCELLED`, émis
  après validation de la transaction.
- **Erreurs de lecture invisibles** — 26 écrans sur 41 les affichent désormais,
  dont les cinq qui affirmaient quelque chose de faux (tableau de bord, journal
  de caisse, Les Oubliés, espace enseignant, dossiers).
- **Trimestre / semestre** — réglable par le directeur, avec régénération des
  périodes tant qu'aucune note n'est saisie.
- **Inscription dans une année close** — refusée, à l'unité comme en masse.
- **« Les Oubliés » toutes années confondues** — borné à l'année en cours, avec
  sélecteur pour consulter les précédentes.
- **Code établissement en minuscules refusé à la connexion** — comparé sans
  casse ni espaces.
- **`onError` manquants** — les 49 appels de mutation en ont un. Faux problème.
- **Icônes lucide** — toutes celles utilisées existent en 1.25.
- **Encaissement concurrent** — `processPayment` verrouille la ligne
  d'inscription en `pessimistic_write`. Sain.
