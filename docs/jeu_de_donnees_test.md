# Jeu de données de test — Collège le Navire

> Base vidée le 27 août 2026. Seul `superadmin@gesta-school.ci` subsiste.
> Les valeurs ci-dessous respectent les validations du serveur : les saisir
> telles quelles évite les refus de formulaire.

---

## 1. Établissement (Super-Admin)

| Champ | Valeur |
|---|---|
| Nom | `Collège le Navire` |
| Code / Slug | `CLN` |
| Découpage | **2 semestres** |
| Adresse | `Cocody Riviera 3, Abidjan` |
| Téléphone | `+2252722334455` |

Le slug est **obligatoire à la connexion** de tout le personnel. Il est comparé
sans tenir compte de la casse : `cln` fonctionne aussi bien que `CLN`.

Toutes les références porteront ce code : `INS-CLN-26-0001`, `REC-CLN-26-0001`.

---

## 2. Année scolaire

| Libellé | Active |
|---|---|
| `2026-2027` | ✅ oui |

L'ouverture crée automatiquement les périodes. Avec le découpage en semestres :
**1er Semestre**, **2e Semestre**.

> Si vous créez l'école en trimestres puis basculez en semestres, l'année déjà
> ouverte garde ses 3 trimestres. Le bouton « Régénérer » de l'onglet *Année
> scolaire* les recrée — tant qu'aucune note ni absence n'y est saisie.

---

## 3. Personnel

Créé par la direction (ou le Super-Admin). Mot de passe : **6 caractères minimum**.

| Rôle | Email | Mot de passe |
|---|---|---|
| DIRECTOR | `direction@college-navire.edu.ci` | `Navire2026` |
| SECRETARY | `secretariat@college-navire.edu.ci` | `Navire2026` |
| ACCOUNTANT | `comptabilite@college-navire.edu.ci` | `Navire2026` |
| TEACHER | `koffi.maths@college-navire.edu.ci` | `Navire2026` |
| TEACHER | `kouame.francais@college-navire.edu.ci` | `Navire2026` |
| TEACHER | `kone.svt@college-navire.edu.ci` | `Navire2026` |

---

## 4. Classes

`level` vaut **COLLEGE** ou **LYCEE**, rien d'autre.

| Nom | Niveau | Frais annuels (FCFA) |
|---|---|---|
| `6ème A` | COLLEGE | `150000` |
| `5ème A` | COLLEGE | `160000` |
| `3ème A` | COLLEGE | `180000` |
| `2nde C` | LYCEE | `220000` |
| `Tle D` | LYCEE | `250000` |

---

## 5. Matières et coefficients

| Matière | Abrégé | Coef. 6ème A | Coef. 3ème A |
|---|---|---|---|
| `Mathématiques` | `MATH` | 4 | 5 |
| `Français` | `FR` | 4 | 4 |
| `Anglais` | `ANG` | 2 | 3 |
| `SVT` | `SVT` | 2 | 2 |
| `Histoire-Géographie` | `HG` | 2 | 2 |
| `EPS` | `EPS` | 1 | 1 |

**Affectations enseignants** — Koffi → Mathématiques (6ème A, 3ème A) ·
Kouamé → Français (6ème A, 3ème A) · Koné → SVT (6ème A).

---

## 6. Élèves

Date au format **JJ-MM-AAAA**. Téléphone : numéro ivoirien valide, `+225` suivi
de 10 chiffres commençant par 01, 05 ou 07.

| # | Nom | Prénom | Naissance | Tél. parent | Classe |
|---|---|---|---|---|---|
| 1 | `Aka` | `Nadège` | `14-03-2012` | `+2250701020304` | 6ème A |
| 2 | `Aka` | `Serge` | `02-11-2009` | `+2250701020304` | 3ème A |
| 3 | `Kouassi` | `Ama` | `25-08-2012` | `+2250501020305` | 6ème A |
| 4 | `Traoré` | `Ismaël` | `07-01-2012` | `+2250101020306` | 6ème A |
| 5 | `N'Dri` | `Honorine` | `19-06-2011` | `+2250701020307` | 5ème A |
| 6 | `Sangaré` | `Étienne` | `30-09-2009` | `+2250501020308` | 3ème A |
| 7 | `Kobenan` | `Georges` | `12-04-2008` | `+2250101020309` | 2nde C |
| 8 | `Diomandé` | `Adjoua` | `05-12-2007` | `+2250701020310` | Tle D |

Les élèves **1 et 2 sont frère et sœur** — même téléphone, deux classes
différentes. C'est le cas qui teste le rattachement 1-n de l'espace parent.

---

## 7. Comptes parents

Créés par le secrétariat. Le mot de passe est **généré par le serveur** et
affiché une seule fois : notez-le au moment de la création.

| Nom | Prénom | Sexe | Email | Enfants rattachés |
|---|---|---|---|---|
| `Aka` | `Bonin` | Père | `bonin.aka@gmail.com` | Nadège **et** Serge |
| `Kouassi` | `Mariam` | Mère | `mariam.kouassi@gmail.com` | Ama |
| `Traoré` | `Salif` | Père | `salif.traore@gmail.com` | Ismaël |

Le compte **Aka Bonin** est le plus important : deux enfants, dans deux classes,
donc deux dossiers et deux bulletins distincts sous un seul identifiant.

---

## 8. Scénarios de caisse

Les références s'attribuent dans l'ordre de création des dossiers.

| Dossier | Élève | Dû | Versements | Statut attendu |
|---|---|---|---|---|
| `INS-CLN-26-0001` | Aka Nadège | 150 000 | 150 000 | **ENROLLED** |
| `INS-CLN-26-0002` | Aka Serge | 180 000 | 80 000 | **PARTIALLY_PAID** — reste 100 000 |
| `INS-CLN-26-0003` | Kouassi Ama | 150 000 | 50 000 puis 100 000 | **ENROLLED** (2 reçus) |
| `INS-CLN-26-0004` | Traoré Ismaël | 150 000 | aucun | **PENDING_PAYMENT** → EXPIRED après 72 h |
| `INS-CLN-26-0005` | N'Dri Honorine | 160 000 | 60 000 **puis annulation** | Retour en **PENDING_PAYMENT** |

Reçus attendus : `REC-CLN-26-0001` à `REC-CLN-26-0004`.

**À vérifier après ces opérations** — le journal d'audit (Direction → Journal)
doit contenir « Versement encaissé » et « Versement annulé » avec le montant, la
référence et le motif d'annulation. C'est nouveau : les paiements n'y
apparaissaient pas auparavant.

---

## 9. Notes et absences

Sur le **1er Semestre**, classe 6ème A :

| Évaluation | Matière | Type | Barème | Nadège | Ama | Ismaël |
|---|---|---|---|---|---|---|
| `Interro n°1` | Mathématiques | INTERROGATION | /10 | 7 | 6 | absent |
| `Devoir n°1` | Mathématiques | DEVOIR | /20 | 14 | 11 | 9 |
| `Devoir n°1` | Français | DEVOIR | /20 | 12 | 15 | 13 |

**Absences 6ème A** — Ismaël : `10-11-2026` matin, non justifiée ·
Nadège : `12-11-2026` après-midi, justifiée (motif : « rendez-vous médical »).

Points à contrôler : une absence à une évaluation **ne compte pas comme un
zéro**, et l'espace parent affiche la note **telle qu'elle a été saisie**
(7 / 10, et non 14 / 20).

---

## 10. Parcours de vérification

1. **Super-Admin** — créer l'école avec le découpage *2 semestres*, puis le directeur.
2. **Directeur** — année 2026-2027, classes, matières, coefficients, affectations, reste du personnel.
3. **Secrétariat** — élèves et dossiers dans l'ordre du § 8, puis les 3 comptes parents.
4. **Caisse** — les versements et l'annulation du § 8.
5. **Enseignant** — les évaluations et notes du § 9.
6. **Parent** — se connecter avec `bonin.aka@gmail.com` (slug `CLN`), changer le
   mot de passe imposé, puis vérifier : bascule entre Nadège et Serge, solde,
   notes détaillées, bulletin, absences.
7. **Direction → Journal d'audit** — encaissements, annulation, création des
   comptes parents, rattachements, création de l'école.

---

## Ce qui reste connu comme incomplet

Inutile de les signaler comme des bugs :

- **Report des dettes** d'une année sur l'autre : non implémenté.
- **`renew()` sur une année clôturée** : le renouvellement d'un dossier expiré ne
  vérifie pas l'année, contrairement à la création. Décision en attente.
- **Périodes de notation** : elles ne se clôturent pas automatiquement avec l'année.
- **Recherche d'élèves sans année active** : renvoie une erreur 404 là où le
  tableau de bord affiche zéro.
