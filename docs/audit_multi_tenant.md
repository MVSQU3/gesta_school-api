# 🔍 Audit Multi-Tenant — Gesta School v1.1 *(archivé)*

> [!NOTE]
> ## ✅ Résolu — vérifié le 27 août 2026
>
> **Les 20 failles décrites ci-dessous ont toutes été corrigées.** Ce document
> est conservé à titre d'historique : il explique *pourquoi* le cloisonnement
> par école est écrit comme il l'est aujourd'hui. Il ne décrit **plus** l'état
> du code et ne doit pas être lu comme un état des lieux.
>
> Les chemins qu'il cite (`Gesta_Shool_v1.1/backend`, `/frontend`) n'existent
> plus : les projets sont désormais `gesta_school-api` et `gesta_school-web`.
>
> **Ce qui a été retenu comme correction :**
>
> - Failles #1–#3 — `schoolId` ajouté sur `Student`, `AcademicYear` et `Payment`.
> - Faille #3 (compteur) — le `count()` global a cédé la place à une table
>   `counters` et à un `INSERT … ON CONFLICT ("schoolId", "scope", "year")`.
>   La numérotation repart à `0001` par école, et la race condition signalée
>   disparaît avec elle : l'incrément est atomique.
> - Failles #4–#6 — chaque service expose un `findAllBySchool(schoolId)`. Les
>   `findAll()` globaux subsistent, mais ne sont atteignables que par un
>   `SUPER_ADMIN` qui ne désigne aucune école.
> - Failles #7–#11 — `schoolId` et `slug` ne sont plus jamais lus dans le corps
>   de la requête. `CreatePaymentDto` ne porte plus que `reference`, `amount`
>   et `method` ; tout le reste vient du jeton.
> - Failles #12–#16 — `@UseGuards(JwtAuthGuard, RolesGuard)` sur tous les
>   contrôleurs, et `students` est repassé sous `api/v1`.
> - Faille #15 — `SchoolsController.findAll()` ne renvoie que l'école de
>   l'appelant.
> - Failles #17–#19 — le front porte le `schoolId` dans ses clés de cache et
>   dans l'encaissement.
>
> **Écart assumé avec le Pilier 2 :** le `TenantGuard` recommandé n'a pas été
> écrit. Un guard générique ne peut pas dire à quelle école appartient une
> ressource sans la charger d'abord ; le cloisonnement passe donc par
> `resolveSchoolId()` (`src/common/utils/resolve-school.ts`), appelé
> explicitement par les contrôleurs, doublé d'un `WHERE schoolId` dans les
> services. Trois fichiers de tests (`controllers-tenancy*.spec.ts`) verrouillent
> ce comportement.

---

> **Date de l'audit** : 22 juillet 2026  
> **Objectif** : Identifier toutes les failles qui empêchent un véritable isolement multi-tenant (où chaque école ne voit et ne manipule que SES propres données).

---

## 📖 Contexte : Qu'est-ce que le Multi-Tenant ?

**Analogie simple** : Imagine un immeuble de bureaux. Chaque étage est occupé par une entreprise différente. Le multi-tenant, c'est garantir que :
- L'entreprise du 3ème étage ne peut **jamais** ouvrir la porte du 5ème étage
- Les facteurs livrent le courrier **uniquement** au bon étage
- L'ascenseur ne donne accès **qu'à l'étage autorisé** avec le bon badge

Dans Gesta School, chaque **école** est un « étage ». Un secrétaire du Collège Moderne de Bouaké (CMB) ne doit **jamais** voir les élèves, classes, ou paiements du Lycée Moderne d'Abidjan (LMA).

---

## 🚨 Résumé des Failles Identifiées

| # | Sévérité | Entité / Module | Faille |
|---|----------|-----------------|--------|
| 1 | 🔴 CRITIQUE | `Student` | Aucun `schoolId` — élèves partagés entre toutes les écoles |
| 2 | 🔴 CRITIQUE | `AcademicYear` | Aucun `schoolId` — années académiques globales |
| 3 | 🔴 CRITIQUE | `Payment` | Aucun `schoolId` — compteur de reçus global, pas par école |
| 4 | 🔴 CRITIQUE | `StudentsService` | `findAll()` retourne TOUS les élèves de TOUTES les écoles |
| 5 | 🔴 CRITIQUE | `ClassRoomsService` | `findAll()` retourne TOUTES les classes de TOUTES les écoles |
| 6 | 🔴 CRITIQUE | `AcademicYearsService` | `findAll()` et `findActive()` — pas de filtre par école |
| 7 | 🔴 CRITIQUE | `EnrollmentsController` | `create()` ne vérifie pas que le `schoolId` du body correspond à celui du JWT |
| 8 | 🔴 CRITIQUE | `EnrollmentsController` | `findExpired()` — `schoolId` est un query param optionnel envoyé par le client |
| 9 | 🔴 CRITIQUE | `EnrollmentsController` | `renew()` — aucune vérification que l'inscription appartient à l'école de l'utilisateur |
| 10 | 🔴 CRITIQUE | `PaymentsController` | `processPayment()` — `schoolId` et `slug` viennent du body client (falsifiable) |
| 11 | 🔴 CRITIQUE | `PaymentsController` | `findOne()` — n'importe quel utilisateur peut voir n'importe quel reçu |
| 12 | 🟠 HAUTE | `ClassRoomsController` | Aucun guard `@UseGuards(JwtAuthGuard)` — endpoints publics |
| 13 | 🟠 HAUTE | `StudentsController` | Aucun guard `@UseGuards(JwtAuthGuard)` — endpoints publics |
| 14 | 🟠 HAUTE | `AcademicYearsController` | Aucun guard `@UseGuards(JwtAuthGuard)` — endpoints publics |
| 15 | 🟠 HAUTE | `SchoolsController` | `findAll()` et `findOne()` n'ont pas de `@Roles` — tout utilisateur authentifié voit toutes les écoles |
| 16 | 🟠 HAUTE | `StudentsController` | Route `students` au lieu de `api/v1/students` — incohérence API |
| 17 | 🟡 MOYENNE | Frontend `useClassRooms` | Charge TOUTES les classes sans filtre `schoolId` |
| 18 | 🟡 MOYENNE | Frontend `usePayments` | N'envoie PAS `schoolId` ni `slug` dans le payload (les valeurs sont manquantes) |
| 19 | 🟡 MOYENNE | Frontend `CaisseGuichet` | Le `handlePay` ne transmet pas `schoolId` ni `slug` au backend |
| 20 | 🟡 MOYENNE | `RolesGuard` | Vérifie le rôle mais PAS l'appartenance à l'école (pas de TenantGuard) |

---

## 📋 Détail Faille par Faille

---

### FAILLE #1 — 🔴 `Student` : Aucune colonne `schoolId`

**Fichier** : [student.entity.ts](file:///c:/Users/Test/Desktop/Gesta_Shool_v1.1/backend/src/students/entities/student.entity.ts)

**Le problème** : L'entité `Student` n'a aucune relation `ManyToOne` vers `School`. Un élève créé depuis le Collège Moderne de Bouaké est visible par toutes les autres écoles.

**Conséquence** : 
- Un directeur de l'école A peut voir les élèves créés par l'école B
- En production, **les données personnelles des élèves fuient entre établissements** (nom, prénom, téléphone parent)
- La relation est uniquement maintenue via `Enrollment` → c'est une jointure indirecte fragile

**Ce qu'il faut** : Ajouter une colonne `schoolId` UUID + relation `ManyToOne` vers `School`, comme c'est fait pour `ClassRoom`.

---

### FAILLE #2 — 🔴 `AcademicYear` : Globale au lieu de par école

**Fichier** : [academic-year.entity.ts](file:///c:/Users/Test/Desktop/Gesta_Shool_v1.1/backend/src/academic-years/entities/academic-year.entity.ts)

**Le problème** : L'entité `AcademicYear` n'a aucun `schoolId`. La contrainte `unique: true` sur `label` signifie qu'une seule école peut créer "2026-2027" — les autres recevront un conflit.

**Conséquence** :
- Si l'école A crée "2026-2027" et la désactive, **toutes les écoles perdent cette année**
- Chaque école devrait pouvoir gérer indépendamment son calendrier académique

**Ce qu'il faut** : Ajouter `schoolId` + contrainte unique composite `(schoolId, label)`.

---

### FAILLE #3 — 🔴 `Payment` : Compteur de reçus global

**Fichier** : [payments.service.ts](file:///c:/Users/Test/Desktop/Gesta_Shool_v1.1/backend/src/payments/payments.service.ts#L29-L34)

**Le problème** : 
```typescript
const count = await this.paymentRepository.count(); // ← TOUS les paiements de TOUTES les écoles !
```

Le compteur `REC-CMB-26-XXXX` utilise `count()` global. Si l'école A a 50 paiements et l'école B fait son 1er paiement, le reçu sera `REC-LMA-26-0051` au lieu de `REC-LMA-26-0001`.

**Conséquence** : Numérotation incohérente par école + possibilité de collision si deux écoles paient en même temps (race condition sur le compteur).

**Ce qu'il faut** : Filtrer par `schoolId` dans le `count()`. Mieux : ajouter `schoolId` sur l'entité `Payment`.

---

### FAILLE #4 — 🔴 `StudentsService.findAll()` : Fuite inter-école

**Fichier** : [students.service.ts](file:///c:/Users/Test/Desktop/Gesta_Shool_v1.1/backend/src/students/students.service.ts#L29-L33)

```typescript
async findAll(): Promise<Student[]> {
  return await this.studentRepository.find({
    order: { createdAt: 'DESC' },
  }); // ← Pas de filtre schoolId
}
```

**Conséquence** : Retourne TOUS les élèves de TOUTES les écoles sans distinction.

---

### FAILLE #5 — 🔴 `ClassRoomsService.findAll()` : Fuite inter-école

**Fichier** : [classrooms.service.ts](file:///c:/Users/Test/Desktop/Gesta_Shool_v1.1/backend/src/classrooms/classrooms.service.ts#L19-L23)

```typescript
async findAll(): Promise<ClassRoom[]> {
  return await this.classRoomRepository.find({
    order: { name: 'ASC' },
  }); // ← Pas de filtre schoolId alors que la colonne existe !
}
```

**Conséquence** : L'entité `ClassRoom` a bien un `schoolId`, mais le service ignore cette colonne. Le secrétaire de l'école A voit les classes "6ème A" de l'école B dans son formulaire d'inscription.

---

### FAILLE #6 — 🔴 `AcademicYearsService` : Globale

**Fichier** : [academic-years.service.ts](file:///c:/Users/Test/Desktop/Gesta_Shool_v1.1/backend/src/academic-years/academic-years.service.ts)

- `findAll()` : retourne toutes les années de toutes les écoles
- `findActive()` : retourne l'année active globale — si une école la désactive, toutes les écoles sont impactées

---

### FAILLE #7 — 🔴 `EnrollmentsController.create()` : `schoolId` non vérifié

**Fichier** : [enrollments.controller.ts](file:///c:/Users/Test/Desktop/Gesta_Shool_v1.1/backend/src/enrollments/enrollments.controller.ts#L28-L34)

```typescript
@Post()
async create(@Body() createEnrollmentDto: CreateEnrollmentDto): Promise<Enrollment> {
  return await this.enrollmentsService.create(createEnrollmentDto);
  // ← Le schoolId vient du body, PAS du JWT. Un attaquant peut envoyer n'importe quel schoolId.
}
```

**Conséquence** : Un utilisateur de l'école A peut créer des inscriptions au nom de l'école B en falsifiant le `schoolId` dans le body JSON.

**Ce qu'il faut** : Injecter `@CurrentUser()` et forcer `schoolId = user.schoolId`.

---

### FAILLE #8 — 🔴 `EnrollmentsController.findExpired()` : `schoolId` optionnel côté client

**Fichier** : [enrollments.controller.ts](file:///c:/Users/Test/Desktop/Gesta_Shool_v1.1/backend/src/enrollments/enrollments.controller.ts#L39-L45)

```typescript
@Get('expired')
async findExpired(@Query('schoolId') schoolId?: string): Promise<Enrollment[]> {
  return await this.enrollmentsService.findExpired(schoolId);
  // ← Si on omet le query param, on récupère les dossiers expirés de TOUTES les écoles
}
```

**Conséquence** : Un utilisateur peut retirer le `?schoolId=...` de l'URL et voir tous les dossiers expirés de toutes les écoles.

---

### FAILLE #9 — 🔴 `EnrollmentsController.renew()` : Pas de vérification d'appartenance

**Fichier** : [enrollments.controller.ts](file:///c:/Users/Test/Desktop/Gesta_Shool_v1.1/backend/src/enrollments/enrollments.controller.ts#L51-L55)

```typescript
@Patch(':id/renew')
async renew(@Param('id') id: string): Promise<Enrollment> {
  return await this.enrollmentsService.renew(id);
  // ← N'importe quel utilisateur authentifié peut renouveler n'importe quelle inscription
}
```

**Conséquence** : Un secrétaire de l'école A peut renouveler les dossiers de l'école B s'il connaît l'UUID.

---

### FAILLE #10 — 🔴 `PaymentsController.processPayment()` : Données client falsifiables

**Fichier** : [payments.controller.ts](file:///c:/Users/Test/Desktop/Gesta_Shool_v1.1/backend/src/payments/payments.controller.ts#L18-L24)

Le `CreatePaymentDto` attend `schoolId` et `slug` dans le body. Ces valeurs devraient venir du JWT (serveur), pas du client.

**Conséquence** : Un comptable peut envoyer le `schoolId` d'une autre école pour encaisser à tort.

---

### FAILLE #11 — 🔴 `PaymentsController.findOne()` : Pas de vérification d'appartenance

**Fichier** : [payments.controller.ts](file:///c:/Users/Test/Desktop/Gesta_Shool_v1.1/backend/src/payments/payments.controller.ts#L29-L33)

```typescript
@Get(':id')
async findOne(@Param('id') id: string): Promise<Payment> {
  return await this.paymentsService.findOne(id);
  // ← N'importe quel utilisateur peut consulter n'importe quel reçu
}
```

---

### FAILLE #12 — 🟠 `ClassRoomsController` : Endpoints publics (pas de guard)

**Fichier** : [classrooms.controller.ts](file:///c:/Users/Test/Desktop/Gesta_Shool_v1.1/backend/src/classrooms/classrooms.controller.ts)

```typescript
@Controller('api/v1/classrooms')
export class ClassRoomsController { // ← Pas de @UseGuards(JwtAuthGuard, RolesGuard)
```

**Conséquence** : N'importe qui peut appeler `GET /api/v1/classrooms` ou `POST /api/v1/classrooms` sans authentification.

---

### FAILLE #13 — 🟠 `StudentsController` : Endpoints publics

**Fichier** : [students.controller.ts](file:///c:/Users/Test/Desktop/Gesta_Shool_v1.1/backend/src/students/students.controller.ts)

```typescript
@Controller('students') // ← Pas de préfixe api/v1 + pas de guards
```

Double problème : pas d'authentification + route incohérente (`students` au lieu de `api/v1/students`).

---

### FAILLE #14 — 🟠 `AcademicYearsController` : Endpoints publics

**Fichier** : [academic-years.controller.ts](file:///c:/Users/Test/Desktop/Gesta_Shool_v1.1/backend/src/academic-years/academic-years.controller.ts)

Aucun guard. N'importe qui peut créer ou lister les années académiques.

---

### FAILLE #15 — 🟠 `SchoolsController` : `findAll` / `findOne` sans restriction

**Fichier** : [schools.controller.ts](file:///c:/Users/Test/Desktop/Gesta_Shool_v1.1/backend/src/schools/schools.controller.ts#L31-L39)

`findAll()` et `findOne()` n'ont pas de `@Roles`. Un comptable ou secrétaire peut lister tous les établissements du réseau et récupérer leurs IDs — ce qui alimente les failles #7, #8, #10.

---

### FAILLE #16 — 🟠 `StudentsController` : Route incohérente

**Fichier** : [students.controller.ts](file:///c:/Users/Test/Desktop/Gesta_Shool_v1.1/backend/src/students/students.controller.ts#L5)

La route est `@Controller('students')` alors que tous les autres modules utilisent `@Controller('api/v1/...')`. Cela crée une incohérence d'API.

---

### FAILLE #17 — 🟡 Frontend `useClassRooms` : Pas de filtre schoolId

**Fichier** : [useClasses.ts](file:///c:/Users/Test/Desktop/Gesta_Shool_v1.1/frontend/src/hooks/useClasses.ts#L5-L13)

```typescript
const { data } = await apiClient.get<ClassRoom[]>('/classrooms');
// ← Récupère TOUTES les classes de TOUTES les écoles
```

Le formulaire d'inscription affiche toutes les classes, y compris celles des autres écoles.

---

### FAILLE #18-19 — 🟡 Frontend Paiements : `schoolId` et `slug` manquants

**Fichier** : [usePayments.ts](file:///c:/Users/Test/Desktop/Gesta_Shool_v1.1/frontend/src/hooks/usePayments.ts#L5-L8)

```typescript
export interface ProcessPaymentInput {
  reference: string;
  amount: number;
  // ← Manque schoolId et slug requis par le backend (CreatePaymentDto)
}
```

Et dans [CaisseGuichet.tsx](file:///c:/Users/Test/Desktop/Gesta_Shool_v1.1/frontend/src/components/CaisseGuichet.tsx#L41-L45), le `handlePay` n'envoie ni `schoolId` ni `slug` :

```typescript
processPaymentMutation.mutate({
  reference: enrollment.reference,
  amount: Number(amount),
  // ← schoolId et slug absents → le backend retournera une erreur 400
});
```

---

### FAILLE #20 — 🟡 `RolesGuard` : Pas de concept de TenantGuard

**Fichier** : [roles.guard.ts](file:///c:/Users/Test/Desktop/Gesta_Shool_v1.1/backend/src/common/guards/roles.guard.ts)

Le guard vérifie uniquement le **rôle** (SECRETARY, DIRECTOR, etc.) mais **jamais** l'appartenance à une école spécifique. Il manque un `TenantGuard` qui :
1. Extrairait le `schoolId` du JWT
2. Comparerait avec le `schoolId` de la ressource demandée
3. Bloquerait l'accès si les deux ne correspondent pas

---

## 🏗️ Architecture de correction recommandée

Pour transformer le projet en un vrai multi-tenant, voici les 5 piliers nécessaires :

### Pilier 1 — Entités : Ajouter `schoolId` partout

| Entité | A déjà `schoolId` ? | Action |
|--------|---------------------|--------|
| `School` | ✅ (c'est le tenant) | Rien |
| `User` | ✅ | Rien |
| `ClassRoom` | ✅ | Rien |
| `Enrollment` | ✅ | Rien |
| **`Student`** | ❌ | **Ajouter** |
| **`AcademicYear`** | ❌ | **Ajouter** |
| **`Payment`** | ❌ | **Ajouter** (ou résoudre via jointure Enrollment) |

### Pilier 2 — Guards : Créer un `TenantGuard`

Un guard centralisé qui, pour chaque requête :
1. Lit `user.schoolId` depuis le JWT
2. Vérifie que la ressource manipulée appartient à cette école
3. Court-circuite si l'utilisateur est `SUPER_ADMIN`

### Pilier 3 — Services : Filtrer par `schoolId` dans CHAQUE requête

Chaque `findAll()`, `findOne()`, `create()`, `update()`, `delete()` doit inclure un `WHERE schoolId = ?`.

### Pilier 4 — Controllers : Injecter `schoolId` depuis le JWT, PAS le body client

```typescript
// ❌ Avant (falsifiable)
@Post()
create(@Body() dto: CreateEnrollmentDto) { ... }

// ✅ Après (sécurisé)
@Post()
create(@Body() dto: CreateEnrollmentDto, @CurrentUser('schoolId') schoolId: string) {
  dto.schoolId = schoolId; // Forcé par le serveur
  ...
}
```

### Pilier 5 — Frontend : Filtrer les appels API par le contexte utilisateur

Les hooks doivent envoyer le `schoolId` depuis le store `useAuthStore` dans chaque requête, au lieu de charger toutes les données globales.

---

> [!NOTE]
> **Corrigé — conservé pour la leçon.** Les failles #7 à #11 étaient des failles
> de sécurité *exploitables* : un utilisateur authentifié pouvait manipuler les
> données d'autres écoles en forgeant des requêtes HTTP (Postman, curl…), même
> si le frontend ne le lui proposait pas. Le frontend n'est **jamais** une
> barrière de sécurité — c'est ce principe qui explique pourquoi `schoolId` et
> `slug` sont aujourd'hui lus dans le jeton et jamais dans le corps de la requête.
