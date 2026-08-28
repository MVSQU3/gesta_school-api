# 🔧 Plan d'Implémentation Multi-Tenant — Option B (Applicative)

## Objectif

Corriger les 20 failles identifiées dans l'audit en ajoutant un filtrage `WHERE schoolId = ?` dans les services, et en forçant le `schoolId` depuis le JWT (pas le client).

## Décisions d'architecture validées

- ✅ `Student` reste **sans** `schoolId` (libre circulation entre écoles)
- ✅ L'isolation des élèves se fait via `Enrollment.schoolId`
- ✅ Approche **applicative** (filtres dans le code) — migration vers RLS (Option A) prévue plus tard
- ✅ Les 3 fichiers tenant (context, interceptor, subscriber) + `TenantBaseEntity` sont conservés pour la migration future

> [!IMPORTANT]
> **Impact sur la base de données** : Ce plan ajoute des colonnes `schoolId` sur 2 tables (`academic_years`, `payments`). La BDD existante sera modifiée par TypeORM `synchronize: true`. Les lignes existantes auront `schoolId = NULL` temporairement — il faudra un script de migration pour les rattacher.

---

## Proposed Changes

### Composant 1 : Entités Backend

> Ajouter `schoolId` sur les entités orphelines et protéger les endpoints.

---

#### [MODIFY] [academic-year.entity.ts](file:///c:/Users/Test/Desktop/Gesta_Shool_v1.1/backend/src/academic-years/entities/academic-year.entity.ts)

**Changements** :
- Ajouter colonne `schoolId` (UUID, NOT NULL)
- Ajouter relation `ManyToOne` vers `School`
- Remplacer `unique: true` sur `label` par un `@Unique(['schoolId', 'label'])` composite

```diff
+import { ManyToOne, JoinColumn, Unique } from 'typeorm';
+import { School } from '../../schools/entities/school.entity';

 @Entity('academic_years')
+@Unique(['schoolId', 'label'])
 export class AcademicYear {
   @PrimaryGeneratedColumn('uuid')
   id: string;

+  @Column({ type: 'uuid' })
+  schoolId: string;
+
+  @ManyToOne(() => School, { onDelete: 'CASCADE' })
+  @JoinColumn({ name: 'schoolId' })
+  school: School;
+
   @Column({
     type: 'varchar',
     length: 20,
     nullable: false,
-    unique: true,
   })
   label: string;
```

---

#### [MODIFY] [payment.entity.ts](file:///c:/Users/Test/Desktop/Gesta_Shool_v1.1/backend/src/payments/entities/payment.entity.ts)

**Changements** :
- Ajouter colonne `schoolId` (UUID, NOT NULL)
- Ajouter relation `ManyToOne` vers `School`

```diff
+import { ManyToOne, JoinColumn } from 'typeorm';
+import { School } from '../../schools/entities/school.entity';

 @Entity('payments')
 export class Payment {
+  @Column({ type: 'uuid' })
+  schoolId: string;
+
+  @ManyToOne(() => School, { onDelete: 'CASCADE' })
+  @JoinColumn({ name: 'schoolId' })
+  school: School;
```

---

### Composant 2 : Guards & Auth — Sécuriser les endpoints ouverts

---

#### [MODIFY] [students.controller.ts](file:///c:/Users/Test/Desktop/Gesta_Shool_v1.1/backend/src/students/students.controller.ts)

**Changements** :
- Corriger la route : `'students'` → `'api/v1/students'`
- Ajouter `@UseGuards(JwtAuthGuard, RolesGuard)` au niveau du controller
- Ajouter `@Roles` sur les endpoints
- `findAll` : injecter `@CurrentUser('schoolId')` et le passer au service

```diff
-@Controller('students')
+@Controller('api/v1/students')
+@UseGuards(JwtAuthGuard, RolesGuard)
 export class StudentsController {
+
+  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR, Role.SECRETARY)
   @Get()
-  findAll() {
-    return this.studentsService.findAll();
+  findAll(@CurrentUser('schoolId') schoolId: string) {
+    return this.studentsService.findAllBySchool(schoolId);
   }
```

---

#### [MODIFY] [classrooms.controller.ts](file:///c:/Users/Test/Desktop/Gesta_Shool_v1.1/backend/src/classrooms/classrooms.controller.ts)

**Changements** :
- Ajouter `@UseGuards(JwtAuthGuard, RolesGuard)` au niveau du controller
- `findAll` : filtrer par `schoolId` du JWT
- `create` : injecter `schoolId` depuis le JWT

```diff
 @Controller('api/v1/classrooms')
+@UseGuards(JwtAuthGuard, RolesGuard)
 export class ClassRoomsController {

+  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR)
   @Post()
-  async create(@Body() dto: CreateClassRoomDto): Promise<ClassRoom> {
+  async create(@Body() dto: CreateClassRoomDto, @CurrentUser('schoolId') schoolId: string): Promise<ClassRoom> {
+    dto.schoolId = schoolId; // Forcé par le serveur
     return await this.classRoomsService.create(dto);
   }

+  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR, Role.SECRETARY, Role.ACCOUNTANT)
   @Get()
-  async findAll(): Promise<ClassRoom[]> {
-    return await this.classRoomsService.findAll();
+  async findAll(@CurrentUser('schoolId') schoolId: string): Promise<ClassRoom[]> {
+    return await this.classRoomsService.findAllBySchool(schoolId);
   }
```

---

#### [MODIFY] [academic-years.controller.ts](file:///c:/Users/Test/Desktop/Gesta_Shool_v1.1/backend/src/academic-years/academic-years.controller.ts)

**Changements** :
- Ajouter `@UseGuards(JwtAuthGuard, RolesGuard)`
- Filtrer par `schoolId` du JWT dans toutes les méthodes
- `create` : injecter `schoolId`

```diff
 @Controller('api/v1/academic-years')
+@UseGuards(JwtAuthGuard, RolesGuard)
 export class AcademicYearsController {

+  @Roles(Role.SUPER_ADMIN, Role.DIRECTOR)
   @Post()
-  async create(@Body() dto: CreateAcademicYearDto): Promise<AcademicYear> {
-    return await this.academicYearsService.create(dto);
+  async create(@Body() dto: CreateAcademicYearDto, @CurrentUser('schoolId') schoolId: string): Promise<AcademicYear> {
+    return await this.academicYearsService.create(dto, schoolId);
   }

   @Get()
-  async findAll(): Promise<AcademicYear[]> {
-    return await this.academicYearsService.findAll();
+  async findAll(@CurrentUser('schoolId') schoolId: string): Promise<AcademicYear[]> {
+    return await this.academicYearsService.findAllBySchool(schoolId);
   }

   @Get('active')
-  async findActive(): Promise<AcademicYear> {
-    return await this.academicYearsService.findActive();
+  async findActive(@CurrentUser('schoolId') schoolId: string): Promise<AcademicYear> {
+    return await this.academicYearsService.findActiveBySchool(schoolId);
   }
```

---

#### [MODIFY] [enrollments.controller.ts](file:///c:/Users/Test/Desktop/Gesta_Shool_v1.1/backend/src/enrollments/enrollments.controller.ts)

**Changements** :
- `create()` : forcer `dto.schoolId = user.schoolId` depuis le JWT (pas le body)
- `findExpired()` : utiliser `user.schoolId` au lieu du query param client
- `renew()` : vérifier que l'inscription appartient à l'école de l'utilisateur

```diff
   @Post()
-  async create(@Body() dto: CreateEnrollmentDto): Promise<Enrollment> {
-    return await this.enrollmentsService.create(dto);
+  async create(
+    @Body() dto: CreateEnrollmentDto,
+    @CurrentUser() user: AuthUser,
+  ): Promise<Enrollment> {
+    dto.schoolId = user.schoolId; // Forcé par le serveur
+    return await this.enrollmentsService.create(dto);
   }

   @Get('expired')
-  async findExpired(@Query('schoolId') schoolId?: string): Promise<Enrollment[]> {
-    return await this.enrollmentsService.findExpired(schoolId);
+  async findExpired(@CurrentUser('schoolId') schoolId: string): Promise<Enrollment[]> {
+    return await this.enrollmentsService.findExpired(schoolId);
   }

   @Patch(':id/renew')
-  async renew(@Param('id') id: string): Promise<Enrollment> {
-    return await this.enrollmentsService.renew(id);
+  async renew(@Param('id') id: string, @CurrentUser('schoolId') schoolId: string): Promise<Enrollment> {
+    return await this.enrollmentsService.renew(id, schoolId);
   }
```

---

#### [MODIFY] [payments.controller.ts](file:///c:/Users/Test/Desktop/Gesta_Shool_v1.1/backend/src/payments/payments.controller.ts)

**Changements** :
- `processPayment()` : injecter `schoolId` et `slug` depuis le JWT
- `findOne()` : vérifier que le paiement appartient à l'école de l'utilisateur

```diff
   @Post()
-  async processPayment(@Body() dto: CreatePaymentDto): Promise<Payment> {
-    return await this.paymentsService.processPayment(dto);
+  async processPayment(
+    @Body() dto: CreatePaymentDto,
+    @CurrentUser() user: AuthUser,
+  ): Promise<Payment> {
+    return await this.paymentsService.processPayment(dto, user.schoolId, user.slug);
   }

   @Get(':id')
-  async findOne(@Param('id') id: string): Promise<Payment> {
-    return await this.paymentsService.findOne(id);
+  async findOne(@Param('id') id: string, @CurrentUser('schoolId') schoolId: string): Promise<Payment> {
+    return await this.paymentsService.findOne(id, schoolId);
   }
```

---

#### [MODIFY] [schools.controller.ts](file:///c:/Users/Test/Desktop/Gesta_Shool_v1.1/backend/src/schools/schools.controller.ts)

**Changements** :
- `findAll()` : un non-SUPER_ADMIN ne voit que **son** école
- `findOne()` : un non-SUPER_ADMIN ne peut accéder qu'à **son** école

```diff
   @Get()
-  async findAll(): Promise<School[]> {
-    return await this.schoolsService.findAll();
+  async findAll(@CurrentUser() user: AuthUser): Promise<School | School[]> {
+    if (user.roles.includes(Role.SUPER_ADMIN)) {
+      return await this.schoolsService.findAll();
+    }
+    return await this.schoolsService.findOne(user.schoolId);
   }
```

---

### Composant 3 : Services Backend — Filtrage par tenant

---

#### [MODIFY] [students.service.ts](file:///c:/Users/Test/Desktop/Gesta_Shool_v1.1/backend/src/students/students.service.ts)

**Changements** :
- Supprimer `findAll()` global
- Ajouter `findAllBySchool(schoolId)` qui filtre via les enrollments

```diff
-  async findAll(): Promise<Student[]> {
-    return await this.studentRepository.find({
-      order: { createdAt: 'DESC' },
-    });
-  }
+  async findAllBySchool(schoolId: string): Promise<Student[]> {
+    return await this.studentRepository
+      .createQueryBuilder('student')
+      .innerJoin('student.enrollments', 'enrollment', 'enrollment.schoolId = :schoolId', { schoolId })
+      .orderBy('student.createdAt', 'DESC')
+      .getMany();
+  }
```

> [!IMPORTANT]
> Ceci nécessite d'ajouter une relation `@OneToMany` sur `Student` vers `Enrollment` pour que le `createQueryBuilder` puisse faire le `innerJoin`.

---

#### [MODIFY] [classrooms.service.ts](file:///c:/Users/Test/Desktop/Gesta_Shool_v1.1/backend/src/classrooms/classrooms.service.ts)

**Changements** :
- Ajouter `findAllBySchool(schoolId)` filtré
- `findOne` : vérifier l'appartenance à l'école

```diff
-  async findAll(): Promise<ClassRoom[]> {
-    return await this.classRoomRepository.find({
-      order: { name: 'ASC' },
-    });
-  }
+  async findAllBySchool(schoolId: string): Promise<ClassRoom[]> {
+    return await this.classRoomRepository.find({
+      where: { schoolId },
+      order: { name: 'ASC' },
+    });
+  }
```

---

#### [MODIFY] [academic-years.service.ts](file:///c:/Users/Test/Desktop/Gesta_Shool_v1.1/backend/src/academic-years/academic-years.service.ts)

**Changements** :
- `create()` : recevoir et injecter `schoolId`
- `findAll()` → `findAllBySchool(schoolId)`
- `findActive()` → `findActiveBySchool(schoolId)`

```diff
-  async create(dto: CreateAcademicYearDto): Promise<AcademicYear> {
-    const academicYear = this.academicYearRepository.create(dto);
+  async create(dto: CreateAcademicYearDto, schoolId: string): Promise<AcademicYear> {
+    const academicYear = this.academicYearRepository.create({ ...dto, schoolId });
     return await this.academicYearRepository.save(academicYear);
   }

-  async findAll(): Promise<AcademicYear[]> {
-    return await this.academicYearRepository.find({ order: { label: 'DESC' } });
+  async findAllBySchool(schoolId: string): Promise<AcademicYear[]> {
+    return await this.academicYearRepository.find({
+      where: { schoolId },
+      order: { label: 'DESC' },
+    });
   }

-  async findActive(): Promise<AcademicYear> {
-    const activeYear = await this.academicYearRepository.findOne({ where: { isActive: true } });
+  async findActiveBySchool(schoolId: string): Promise<AcademicYear> {
+    const activeYear = await this.academicYearRepository.findOne({
+      where: { isActive: true, schoolId },
+    });
```

---

#### [MODIFY] [enrollments.service.ts](file:///c:/Users/Test/Desktop/Gesta_Shool_v1.1/backend/src/enrollments/enrollments.service.ts)

**Changements** :
- `findExpired()` : `schoolId` **obligatoire** (pas optionnel)
- `renew()` : recevoir `schoolId` et vérifier que l'inscription appartient à l'école
- `findByReference()` : utiliser le `schoolId` du JWT, pas du DTO

---

#### [MODIFY] [payments.service.ts](file:///c:/Users/Test/Desktop/Gesta_Shool_v1.1/backend/src/payments/payments.service.ts)

**Changements** :
- `generateReceiptNumber()` : filtrer `count()` par `schoolId`
- `processPayment()` : recevoir `schoolId`/`slug` depuis le controller, injecter `schoolId` sur le paiement
- `findOne()` : vérifier l'appartenance à l'école

```diff
-  private async generateReceiptNumber(schoolSlug: string): Promise<string> {
+  private async generateReceiptNumber(schoolId: string, schoolSlug: string): Promise<string> {
     const currentYearShort = new Date().getFullYear().toString().slice(-2);
-    const count = await this.paymentRepository.count();
+    const count = await this.paymentRepository.count({ where: { schoolId } });
```

---

#### [MODIFY] [create-payment.dto.ts](file:///c:/Users/Test/Desktop/Gesta_Shool_v1.1/backend/src/payments/dto/create-payment.dto.ts)

**Changements** :
- Retirer `schoolId` et `slug` du DTO (ils viendront du JWT côté serveur)

```diff
 export class CreatePaymentDto {
   reference: string;
-  slug: string;
-  schoolId: string;
   amount: number;
 }
```

---

### Composant 4 : Relation manquante sur Student

---

#### [MODIFY] [student.entity.ts](file:///c:/Users/Test/Desktop/Gesta_Shool_v1.1/backend/src/students/entities/student.entity.ts)

**Changement** : Ajouter la relation inverse `@OneToMany` vers `Enrollment` pour permettre le filtrage par école via les inscriptions.

```diff
+import { Enrollment } from '../../enrollments/entities/enrollment.entity';

 @Entity('students')
 export class Student {
   ...
+  @OneToMany(() => Enrollment, (enrollment) => enrollment.student)
+  enrollments: Enrollment[];
 }
```

---

### Composant 5 : Frontend — Contexte tenant

---

#### [MODIFY] [useClasses.ts](file:///c:/Users/Test/Desktop/Gesta_Shool_v1.1/frontend/src/hooks/useClasses.ts)

**Changement** : Le backend filtre désormais par JWT → aucun changement nécessaire côté appel API (le token est envoyé automatiquement via l'intercepteur axios). Mais la `queryKey` devrait inclure le `schoolId` pour invalider le cache correctement quand l'utilisateur change d'école.

---

#### [MODIFY] [usePayments.ts](file:///c:/Users/Test/Desktop/Gesta_Shool_v1.1/frontend/src/hooks/usePayments.ts)

**Changement** : Retirer `schoolId` et `slug` du `ProcessPaymentInput` (le backend les injecte depuis le JWT).

```diff
 export interface ProcessPaymentInput {
   reference: string;
   amount: number;
-  // Plus besoin de schoolId ni slug
 }
```

---

#### [MODIFY] [CaisseGuichet.tsx](file:///c:/Users/Test/Desktop/Gesta_Shool_v1.1/frontend/src/components/CaisseGuichet.tsx)

**Changement** : Aucun — le composant envoie déjà seulement `reference` et `amount`, ce qui correspond au nouveau DTO simplifié.

---

### Composant 6 : Gestion SUPER_ADMIN

> [!WARNING]
> Le `SUPER_ADMIN` n'a **pas** de `schoolId` (il est global). Tous les services qui reçoivent `schoolId` depuis le JWT doivent gérer ce cas spécial : si l'utilisateur est SUPER_ADMIN, soit on retourne toutes les données, soit on exige un `schoolId` explicite en query param.

**Stratégie retenue** : Le SUPER_ADMIN qui accède aux pages métier (secrétariat, caisse) doit d'abord sélectionner une école (le `currentSchool` du `useSchoolStore` côté frontend). Le `schoolId` sélectionné sera envoyé en query param pour les endpoints métier.

**Implémentation dans les controllers** :
```typescript
const effectiveSchoolId = user.roles.includes(Role.SUPER_ADMIN) 
  ? querySchoolId || user.schoolId 
  : user.schoolId;
```

---

## Verification Plan

### Tests manuels

1. **Test isolation** : Créer 2 écoles (CMB et LMA), 2 directeurs, et vérifier que chaque directeur ne voit que ses propres classes, années, inscriptions et paiements
2. **Test falsification** : Tenter d'envoyer un `schoolId` falsifié dans le body d'un `POST /enrollments` et vérifier que le serveur l'ignore
3. **Test endpoints publics** : Vérifier que `GET /api/v1/classrooms` sans JWT retourne 401
4. **Test compteur reçu** : Vérifier que le reçu de la 2ème école commence à `REC-LMA-26-0001` et non `REC-LMA-26-0051`
5. **Test SUPER_ADMIN** : Vérifier qu'il peut accéder à toutes les écoles

### Commandes

```bash
# Relancer le backend après modifications
npm run start:dev

# Vérifier qu'il n'y a pas d'erreurs TypeScript
npx tsc --noEmit
```

---

## Ordre d'exécution recommandé

| Étape | Fichiers | Risque |
|-------|----------|--------|
| 1 | Entités (`AcademicYear`, `Payment`, `Student`) | ⚠️ Migration BDD |
| 2 | DTOs (`CreatePaymentDto`) | Faible |
| 3 | Services (filtrage) | Moyen |
| 4 | Controllers (guards + injection JWT) | Moyen |
| 5 | Frontend (hooks + composants) | Faible |
| 6 | Test complet | — |
