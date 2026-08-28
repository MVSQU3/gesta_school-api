/**
 * =============================================================================
 * Jeu de données de démonstration — Gesta School
 * =============================================================================
 *
 * Peuple une base déjà migrée avec deux établissements complets et cohérents :
 *
 *   - Collège Moderne de Bouaké (CMB) — découpage au TRIMESTRE, 8 classes ;
 *   - Lycée Moderne d'Abidjan (LMA) — découpage au SEMESTRE, 6 classes.
 *
 * Chacun reçoit ses utilisateurs (direction, secrétariat, comptabilité,
 * enseignants), son programme (matières + coefficients par classe), deux années
 * scolaires — 2025-2026 close et intégralement notée, 2026-2027 active en cours
 * de campagne d'inscription — ses élèves, inscriptions, encaissements,
 * évaluations, notes et absences.
 *
 * Les données respectent les invariants métier de l'application :
 *   - références et numéros de reçu au format INS/REC-SLUG-AA-XXXX, avec les
 *     compteurs `counters` positionnés en conséquence ;
 *   - statut d'inscription déduit de la somme des versements non annulés ;
 *   - `expiresAt` = création + 72 h ; les dossiers sans versement au-delà du
 *     délai sont EXPIRED ;
 *   - notes rattachées à l'inscription, jamais à l'élève, et uniquement dans
 *     les matières réellement au programme de la classe ;
 *   - un enseignant ne note que ce qui lui est affecté (teaching_assignments).
 *
 * Le tirage est déterministe (générateur à graine fixe) : deux exécutions
 * produisent les mêmes élèves et les mêmes notes.
 *
 * Utilisation :
 *   npm run seed            # vide les tables métier puis réinsère
 *   npm run seed -- --force # requis si NODE_ENV=production
 *
 * ATTENTION : le script commence par VIDER toutes les tables métier
 * (TRUNCATE ... CASCADE). Il n'est pas destiné à une base de production.
 * =============================================================================
 */

import 'dotenv/config';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';

import { Absence, AbsenceStatus } from '../absences/entities/absence.entity';
import { AcademicYear } from '../academic-years/entities/academic-year.entity';
import {
  ClassRoom,
  ClassRoomLevel,
} from '../classrooms/entities/classroom.entity';
import { Counter, CounterScope } from '../common/counters/counter.entity';
import { Role } from '../common/enums/role.enum';
import {
  Enrollment,
  EnrollmentStatus,
} from '../enrollments/entities/enrollment.entity';
import {
  Evaluation,
  EvaluationType,
} from '../evaluations/entities/evaluation.entity';
import { Grade } from '../evaluations/entities/grade.entity';
import { GradingPeriod } from '../grading-periods/entities/grading-period.entity';
import {
  CancellationType,
  Payment,
  PaymentMethod,
} from '../payments/entities/payment.entity';
import { PeriodSystem, School } from '../schools/entities/school.entity';
import { Student } from '../students/entities/student.entity';
import { ClassRoomSubject } from '../subjects/entities/classroom-subject.entity';
import { Subject } from '../subjects/entities/subject.entity';
import { TeachingAssignment } from '../teaching/entities/teaching-assignment.entity';
import {
  DayOfWeek,
  ScheduleEntry,
} from '../schedule/entities/schedule-entry.entity';
import { TimeSlot } from '../schedule/entities/time-slot.entity';
import { User } from '../users/entities/user.entity';

import {
  ABSENCE_REASONS,
  ClassSpec,
  CMB_CLASSES,
  COLLEGE_SUBJECTS,
  EVALUATION_TOPICS,
  FEMALE_FIRST_NAMES,
  LAST_NAMES,
  LMA_CLASSES,
  LYCEE_SUBJECTS,
  MALE_FIRST_NAMES,
  SubjectSpec,
  TEACHER_FIRST_NAMES,
} from './data';

// -----------------------------------------------------------------------------
// Paramètres
// -----------------------------------------------------------------------------

/** Mot de passe commun à tous les comptes créés. */
const DEFAULT_PASSWORD = 'Gesta@2026';

/** Coût bcrypt : volontairement bas ici, le seed crée une trentaine de comptes. */
const BCRYPT_ROUNDS = 10;

/** Nombre de lignes par requête d'insertion groupée. */
const CHUNK_SIZE = 500;

/**
 * Tables vidées avant réinsertion, dans un ordre indifférent : le CASCADE et
 * le RESTART IDENTITY d'un TRUNCATE unique règlent les dépendances.
 */
const TABLES = [
  // Le journal d'audit est vidé explicitement : le CASCADE depuis `schools`
  // n'emporterait pas les lignes du super-administrateur (schoolId NULL).
  'audit_logs',
  'grades',
  'evaluations',
  'absences',
  'payments',
  'enrollments',
  'teaching_assignments',
  'classroom_subjects',
  'subjects',
  'grading_periods',
  'students',
  'classrooms',
  'academic_years',
  'counters',
  'users',
  'schools',
];

// -----------------------------------------------------------------------------
// Aléatoire déterministe
// -----------------------------------------------------------------------------

/**
 * Générateur mulberry32 : suite pseudo-aléatoire reproductible à partir d'une
 * graine fixe. Un seed rejouable facilite la comparaison de captures d'écran
 * et le débogage d'un bulletin précis.
 */
function makeRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = makeRandom(20262027);

/** Entier dans [min, max]. */
const randInt = (min: number, max: number) =>
  min + Math.floor(rand() * (max - min + 1));

const pick = <T>(items: T[]): T => items[Math.floor(rand() * items.length)];

/** Vrai avec la probabilité `p`. */
const chance = (p: number) => rand() < p;

/**
 * Tirage approximativement gaussien (somme de trois uniformes), borné.
 * Sert aux notes : une classe réelle se concentre autour de sa moyenne, avec
 * quelques extrêmes, plutôt que de s'étaler uniformément entre 0 et 20.
 */
function gaussian(
  mean: number,
  spread: number,
  min: number,
  max: number,
): number {
  const g = (rand() + rand() + rand()) / 3; // centré sur 0.5
  const value = mean + (g - 0.5) * 2 * spread;
  return Math.min(max, Math.max(min, value));
}

// -----------------------------------------------------------------------------
// Dates
// -----------------------------------------------------------------------------

const date = (y: number, m: number, d: number, h = 9, min = 0) =>
  new Date(y, m - 1, d, h, min, 0, 0);

const addHours = (d: Date, hours: number) =>
  new Date(d.getTime() + hours * 3600 * 1000);

const addDays = (d: Date, days: number) =>
  new Date(d.getTime() + days * 24 * 3600 * 1000);

/** Format `YYYY-MM-DD` attendu par les colonnes `date` de PostgreSQL. */
const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;

/** Jour ouvré tiré au hasard dans un intervalle (ni samedi ni dimanche). */
function workingDayBetween(start: Date, end: Date): Date {
  for (let attempt = 0; attempt < 20; attempt++) {
    const d = new Date(
      start.getTime() + rand() * (end.getTime() - start.getTime()),
    );
    const day = d.getDay();
    if (day !== 0 && day !== 6) return d;
  }
  return start;
}

// -----------------------------------------------------------------------------
// Modèle du seed
// -----------------------------------------------------------------------------

interface PeriodSpec {
  label: string;
  sequence: number;
  start: Date;
  end: Date;
  closed: boolean;
}

interface YearSpec {
  label: string;
  isActive: boolean;
  /** Ouverture de la campagne d'inscription. */
  enrollmentOpensAt: Date;
  periods: PeriodSpec[];
  /** Année déjà déroulée : évaluations, notes et absences sont générées. */
  graded: boolean;
}

interface SchoolSpec {
  name: string;
  slug: string;
  address: string;
  phone: string;
  periodSystem: PeriodSystem;
  level: ClassRoomLevel;
  domain: string;
  classes: ClassSpec[];
  subjects: SubjectSpec[];
  /** Ville de rattachement, utilisée pour les indicatifs téléphoniques. */
  city: string;
}

const SCHOOLS: SchoolSpec[] = [
  {
    name: 'Collège Moderne de Bouaké',
    slug: 'CMB',
    address: 'Quartier Air France, BP 1204, Bouaké',
    phone: '+2252731630012',
    periodSystem: PeriodSystem.TRIMESTER,
    level: ClassRoomLevel.COLLEGE,
    domain: 'college-bouake.edu.ci',
    classes: CMB_CLASSES,
    subjects: COLLEGE_SUBJECTS,
    city: 'Bouaké',
  },
  {
    name: "Lycée Moderne d'Abidjan",
    slug: 'LMA',
    address: 'Boulevard Latrille, Cocody, BP 3357, Abidjan',
    phone: '+2252722441870',
    periodSystem: PeriodSystem.SEMESTER,
    level: ClassRoomLevel.LYCEE,
    domain: 'lycee-abidjan.edu.ci',
    classes: LMA_CLASSES,
    subjects: LYCEE_SUBJECTS,
    city: 'Abidjan',
  },
];

/**
 * Années scolaires générées pour chaque établissement.
 *
 * 2025-2026 est close et intégralement notée ; 2026-2027 est l'année active,
 * ouverte aux inscriptions depuis juillet mais dont les cours n'ont pas encore
 * commencé — d'où l'absence de notes et d'absences.
 */
function yearsFor(system: PeriodSystem): YearSpec[] {
  const trimesters = (y: number): PeriodSpec[] => [
    {
      label: '1er Trimestre',
      sequence: 1,
      start: date(y, 9, 15),
      end: date(y, 12, 19),
      closed: true,
    },
    {
      label: '2e Trimestre',
      sequence: 2,
      start: date(y + 1, 1, 5),
      end: date(y + 1, 3, 27),
      closed: true,
    },
    {
      label: '3e Trimestre',
      sequence: 3,
      start: date(y + 1, 4, 6),
      end: date(y + 1, 6, 26),
      closed: true,
    },
  ];
  const semesters = (y: number): PeriodSpec[] => [
    {
      label: '1er Semestre',
      sequence: 1,
      start: date(y, 9, 15),
      end: date(y + 1, 1, 30),
      closed: true,
    },
    {
      label: '2e Semestre',
      sequence: 2,
      start: date(y + 1, 2, 2),
      end: date(y + 1, 6, 26),
      closed: true,
    },
  ];
  const build = system === PeriodSystem.TRIMESTER ? trimesters : semesters;

  const upcoming = build(2026).map((p) => ({ ...p, closed: false }));

  return [
    {
      label: '2025-2026',
      isActive: false,
      enrollmentOpensAt: date(2025, 7, 21),
      periods: build(2025),
      graded: true,
    },
    {
      label: '2026-2027',
      isActive: true,
      enrollmentOpensAt: date(2026, 7, 6),
      periods: upcoming,
      graded: false,
    },
  ];
}

// -----------------------------------------------------------------------------
// Références documentaires
// -----------------------------------------------------------------------------

/**
 * Compteurs de références, tenus en mémoire pendant le seed puis persistés
 * dans `counters` : l'application reprendra la numérotation là où elle s'arrête
 * ici, sans risque de collision sur la contrainte d'unicité.
 */
class ReferenceCounters {
  private readonly values = new Map<string, number>();

  private key(schoolId: string, scope: CounterScope, year: number) {
    return `${schoolId}|${scope}|${year}`;
  }

  next(schoolId: string, scope: CounterScope, year: number): number {
    const key = this.key(schoolId, scope, year);
    const value = (this.values.get(key) ?? 0) + 1;
    this.values.set(key, value);
    return value;
  }

  /** Lignes à insérer dans `counters` en fin de seed. */
  rows(): Counter[] {
    return [...this.values.entries()].map(([key, lastValue]) => {
      const [schoolId, scope, year] = key.split('|');
      return {
        id: randomUUID(),
        schoolId,
        scope: scope as CounterScope,
        year: Number(year),
        lastValue,
      } as Counter;
    });
  }
}

const counters = new ReferenceCounters();

function reference(
  prefix: 'INS' | 'REC',
  scope: CounterScope,
  schoolId: string,
  slug: string,
  when: Date,
): string {
  const year = when.getFullYear();
  const sequence = counters.next(schoolId, scope, year);
  return `${prefix}-${slug}-${String(year).slice(-2)}-${String(sequence).padStart(4, '0')}`;
}

// -----------------------------------------------------------------------------
// Insertion groupée
// -----------------------------------------------------------------------------

async function insertAll<T extends object>(
  manager: EntityManager,
  target: new () => T,
  rows: T[],
): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    await manager.insert(target, rows.slice(i, i + CHUNK_SIZE));
  }
}

/**
 * Repositionne une colonne de date que TypeORM impose à `CURRENT_TIMESTAMP`
 * (`@CreateDateColumn`). Sans cela, tous les dossiers et tous les
 * encaissements porteraient la date d'exécution du seed, et les journaux de
 * caisse comme les statistiques par période seraient inexploitables.
 */
async function backdate(
  manager: EntityManager,
  table: string,
  columns: string[],
  entries: Array<{ id: string; at: Date }>,
): Promise<void> {
  for (let i = 0; i < entries.length; i += CHUNK_SIZE) {
    const slice = entries.slice(i, i + CHUNK_SIZE);
    const sets = columns.map((c) => `"${c}" = v.at`).join(', ');
    await manager.query(
      `UPDATE "${table}" t SET ${sets}
       FROM (SELECT unnest($1::uuid[]) AS id, unnest($2::timestamptz[]) AS at) v
       WHERE t.id = v.id`,
      [slice.map((e) => e.id), slice.map((e) => e.at.toISOString())],
    );
  }
}

// -----------------------------------------------------------------------------
// Génération
// -----------------------------------------------------------------------------

/** Numéro de téléphone ivoirien plausible (opérateurs mobiles, 10 chiffres). */
function phoneNumber(): string {
  const prefix = pick(['01', '05', '07']); // Moov, MTN, Orange
  let rest = '';
  for (let i = 0; i < 8; i++) rest += randInt(0, 9);
  return `+225${prefix}${rest}`;
}

/** Translittération sommaire pour construire une adresse e-mail. */
function slugifyName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

interface SeededStudent {
  entity: Student;
  /**
   * Niveau scolaire de l'élève, entre 0 et 1 : détermine la distribution de
   * ses notes d'une évaluation à l'autre. Un bon élève le reste globalement,
   * ce qu'un tirage indépendant par note ne reproduirait pas.
   */
  ability: number;
}

async function seed(dataSource: DataSource): Promise<void> {
  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, BCRYPT_ROUNDS);
  const now = new Date();

  /** Aucun encaissement ne peut être daté d'un instant qui n'est pas encore arrivé. */
  const clampToNow = (d: Date): Date =>
    d.getTime() > now.getTime()
      ? new Date(now.getTime() - randInt(5, 90) * 60000)
      : d;

  await dataSource.transaction(async (manager) => {
    await manager.query(
      `TRUNCATE TABLE ${TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
    );

    const schools: School[] = [];
    const users: User[] = [];
    const academicYears: AcademicYear[] = [];
    const gradingPeriods: GradingPeriod[] = [];
    const classrooms: ClassRoom[] = [];
    const subjects: Subject[] = [];
    const classroomSubjects: ClassRoomSubject[] = [];
    const assignments: TeachingAssignment[] = [];
    const timeSlots: TimeSlot[] = [];
    const scheduleEntries: ScheduleEntry[] = [];
    const students: Student[] = [];
    const enrollments: Enrollment[] = [];
    const payments: Payment[] = [];
    const evaluations: Evaluation[] = [];
    const grades: Grade[] = [];
    const absences: Absence[] = [];

    const enrollmentDates: Array<{ id: string; at: Date }> = [];
    const paymentDates: Array<{ id: string; at: Date }> = [];

    // --- Super-administrateur (hors établissement) ---------------------------
    users.push({
      id: randomUUID(),
      email: 'superadmin@gesta-school.ci',
      passwordHash,
      roles: [Role.SUPER_ADMIN],
      isActive: true,
      passwordChangedAt: null,
      mustChangePassword: false,
      slug: null as unknown as string,
      schoolId: null,
    } as User);

    for (const spec of SCHOOLS) {
      const school: School = {
        id: randomUUID(),
        name: spec.name,
        slug: spec.slug,
        address: spec.address,
        phone: spec.phone,
        periodSystem: spec.periodSystem,
        createdAt: date(2025, 6, 12, 8, 30),
      };
      schools.push(school);

      /**
       * Créneaux horaires de l'établissement, communs à toutes les classes.
       *
       * Six heures de cours et une pause : de quoi placer une séance par
       * matière sans prétendre à une grille réaliste.
       */
      const slotsOfSchool: TimeSlot[] = [
        { label: '1ère heure', startTime: '07:30', endTime: '08:30' },
        { label: '2ème heure', startTime: '08:30', endTime: '09:30' },
        { label: '3ème heure', startTime: '09:45', endTime: '10:45' },
        { label: '4ème heure', startTime: '10:45', endTime: '11:45' },
        { label: '5ème heure', startTime: '14:00', endTime: '15:00' },
        { label: '6ème heure', startTime: '15:00', endTime: '16:00' },
      ].map(
        (slot, index) =>
          ({
            id: randomUUID(),
            schoolId: school.id,
            label: slot.label,
            startTime: slot.startTime,
            endTime: slot.endTime,
            sequence: index + 1,
            isBreak: false,
          }) as TimeSlot,
      );
      timeSlots.push(...slotsOfSchool);

      /** Affectations de l'école, pour placer une séance par matière. */
      const assignmentsOfClass: TeachingAssignment[] = [];

      // --- Personnel administratif ------------------------------------------
      const makeUser = (
        email: string,
        roles: Role[],
        opts: { mustChange?: boolean; active?: boolean } = {},
      ): User => {
        const user = {
          id: randomUUID(),
          email,
          passwordHash,
          roles,
          isActive: opts.active ?? true,
          passwordChangedAt: opts.mustChange ? null : date(2026, 1, 12, 10, 0),
          mustChangePassword: opts.mustChange ?? false,
          slug: spec.slug,
          schoolId: school.id,
        } as User;
        users.push(user);
        return user;
      };

      const director = makeUser(`direction@${spec.domain}`, [Role.DIRECTOR]);
      const secretary = makeUser(`secretariat@${spec.domain}`, [
        Role.SECRETARY,
      ]);
      const accountant = makeUser(`comptabilite@${spec.domain}`, [
        Role.ACCOUNTANT,
      ]);
      // Compte créé en cours d'année : mot de passe provisoire jamais changé.
      makeUser(`secretariat2@${spec.domain}`, [Role.SECRETARY], {
        mustChange: true,
      });
      // Agent parti en fin d'année : désactivé, mais ses saisies restent.
      makeUser(`caisse.ancien@${spec.domain}`, [Role.ACCOUNTANT], {
        active: false,
      });

      // --- Matières et enseignants ------------------------------------------
      const subjectByShort = new Map<string, Subject>();
      const teacherBySubject = new Map<string, User>();

      spec.subjects.forEach((subjectSpec, index) => {
        const subject = {
          id: randomUUID(),
          schoolId: school.id,
          name: subjectSpec.name,
          shortName: subjectSpec.shortName,
        } as Subject;
        subjects.push(subject);
        subjectByShort.set(subjectSpec.shortName, subject);

        const lastName =
          LAST_NAMES[(index * 7 + spec.slug.length) % LAST_NAMES.length];
        const firstName =
          TEACHER_FIRST_NAMES[index % TEACHER_FIRST_NAMES.length];
        const teacher = makeUser(
          `${slugifyName(firstName)}.${slugifyName(lastName)}@${spec.domain}`,
          [Role.TEACHER],
        );
        teacherBySubject.set(subjectSpec.shortName, teacher);
      });

      // --- Classes ----------------------------------------------------------
      const classByName = new Map<string, ClassRoom>();
      for (const classSpec of spec.classes) {
        const classroom = {
          id: randomUUID(),
          schoolId: school.id,
          name: classSpec.name,
          level: spec.level,
          tuitionFee: classSpec.tuitionFee,
          createdAt: date(2025, 6, 20, 9, 0),
        } as ClassRoom;
        classrooms.push(classroom);
        classByName.set(classSpec.name, classroom);

        // Programme de la classe : le coefficient dépend de la série.
        const isScientific = /C$/.test(classSpec.name.trim());
        for (const subjectSpec of spec.subjects) {
          const subject = subjectByShort.get(subjectSpec.shortName)!;
          classroomSubjects.push({
            id: randomUUID(),
            schoolId: school.id,
            classRoomId: classroom.id,
            subjectId: subject.id,
            coefficient:
              isScientific && subjectSpec.coefficientC !== undefined
                ? subjectSpec.coefficientC
                : subjectSpec.coefficient,
          } as ClassRoomSubject);
        }
      }

      // --- Années scolaires et périodes -------------------------------------
      const years = yearsFor(spec.periodSystem);
      const yearEntities = new Map<string, AcademicYear>();
      const periodsByYear = new Map<string, GradingPeriod[]>();

      for (const yearSpec of years) {
        const year = {
          id: randomUUID(),
          schoolId: school.id,
          label: yearSpec.label,
          isActive: yearSpec.isActive,
          createdAt: yearSpec.enrollmentOpensAt,
        } as AcademicYear;
        academicYears.push(year);
        yearEntities.set(yearSpec.label, year);

        const periods = yearSpec.periods.map(
          (periodSpec) =>
            ({
              id: randomUUID(),
              schoolId: school.id,
              academicYearId: year.id,
              label: periodSpec.label,
              sequence: periodSpec.sequence,
              startDate: isoDay(periodSpec.start) as unknown as Date,
              endDate: isoDay(periodSpec.end) as unknown as Date,
              isClosed: periodSpec.closed,
            }) as GradingPeriod,
        );
        gradingPeriods.push(...periods);
        periodsByYear.set(yearSpec.label, periods);

        // Services des enseignants pour l'année.
        for (const classSpec of spec.classes) {
          const classroom = classByName.get(classSpec.name)!;
          for (const subjectSpec of spec.subjects) {
            const assignment = {
              id: randomUUID(),
              schoolId: school.id,
              teacherId: teacherBySubject.get(subjectSpec.shortName)!.id,
              classRoomId: classroom.id,
              subjectId: subjectByShort.get(subjectSpec.shortName)!.id,
              academicYearId: year.id,
            } as TeachingAssignment;
            assignments.push(assignment);
            assignmentsOfClass.push(assignment);
          }

          /**
           * Emploi du temps minimal : une séance par matière et par semaine.
           *
           * Il ne prétend pas produire une grille réaliste — il rend l'appel
           * possible. L'assiduité se relève désormais par séance, et sans
           * emploi du temps aucun professeur ne pourrait faire l'appel.
           *
           * Le placement suit les contraintes d'unicité de la table : une
           * classe et un enseignant ne peuvent occuper deux fois le même
           * créneau.
           */
          assignmentsOfClass
            .filter((a) => a.classRoomId === classroom.id)
            .forEach((assignment, index) => {
              const slot = slotsOfSchool[index % slotsOfSchool.length];
              const day = ((index % 5) + 1) as DayOfWeek;
              scheduleEntries.push({
                id: randomUUID(),
                schoolId: school.id,
                academicYearId: year.id,
                teachingAssignmentId: assignment.id,
                classRoomId: classroom.id,
                teacherId: assignment.teacherId,
                dayOfWeek: day,
                timeSlotId: slot.id,
              } as ScheduleEntry);
            });
        }
      }

      // --- Élèves et inscriptions -------------------------------------------

      /** Élèves scolarisés l'année 2025-2026, par classe. */
      const cohort2025 = new Map<string, SeededStudent[]>();

      const newStudent = (levelName: string): SeededStudent => {
        const female = chance(0.5);
        const firstName = pick(female ? FEMALE_FIRST_NAMES : MALE_FIRST_NAMES);
        const lastName = pick(LAST_NAMES);
        // Âge théorique : 11 ans en 6ème, 16 ans en 2nde.
        const baseAge = spec.level === ClassRoomLevel.COLLEGE ? 11 : 16;
        const offset = spec.classes.findIndex((c) => c.name === levelName);
        const birthYear =
          2025 - baseAge - Math.max(0, Math.floor(offset / 2)) + randInt(-1, 1);
        const entity = {
          id: randomUUID(),
          schoolId: school.id,
          firstName,
          lastName,
          birthDay: isoDay(
            date(birthYear, randInt(1, 12), randInt(1, 28)),
          ) as unknown as Date,
          parentPhone: phoneNumber(),
          createdAt: date(2025, 7, randInt(21, 31), randInt(8, 16)),
        } as Student;
        students.push(entity);
        return { entity, ability: gaussian(0.5, 0.32, 0.05, 0.98) };
      };

      /**
       * Ouvre un dossier d'inscription et son échéancier de versements.
       *
       * Le statut n'est pas choisi arbitrairement : il est déduit de la somme
       * des versements non annulés, exactement comme le fait le service métier.
       */
      const enroll = (
        student: SeededStudent,
        classroom: ClassRoom,
        year: AcademicYear,
        createdAt: Date,
        profile: 'settled' | 'campaign',
      ): Enrollment => {
        const tuition = classrooms.find(
          (c) => c.id === classroom.id,
        )!.tuitionFee;
        const enrollment = {
          id: randomUUID(),
          schoolId: school.id,
          studentId: student.entity.id,
          classRoomId: classroom.id,
          academicYearId: year.id,
          reference: reference(
            'INS',
            CounterScope.ENROLLMENT,
            school.id,
            spec.slug,
            createdAt,
          ),
          status: EnrollmentStatus.PENDING_PAYMENT,
          expiresAt: addHours(createdAt, 72),
          totalDue: tuition,
          createdByUserId: chance(0.8) ? secretary.id : director.id,
        } as Enrollment;

        // Échéancier : versement d'inscription, puis une à trois tranches.
        let paidTotal = 0;
        const instalments: Array<{ amount: number; at: Date }> = [];

        // Répartition des situations financières.
        //  - année close : la quasi-totalité des familles a soldé ;
        //  - campagne en cours : beaucoup de dossiers encore en attente.
        const roll = rand();
        const fullyPaid = profile === 'settled' ? roll < 0.82 : roll < 0.26;
        const partial =
          profile === 'settled'
            ? roll >= 0.82 && roll < 0.95
            : roll >= 0.26 && roll < 0.79;

        /**
         * Date d'une tranche.
         *
         * Année écoulée : échéancier mensuel classique. Campagne en cours : les
         * tranches sont resserrées sur le temps réellement écoulé depuis
         * l'ouverture du dossier — un versement ne peut pas être daté d'un jour
         * qui n'est pas encore arrivé.
         */
        const instalmentDate = (rank: number): Date => {
          if (profile === 'settled') {
            return rank === 0
              ? addHours(createdAt, randInt(1, 40))
              : addDays(createdAt, 30 * rank + randInt(0, 25));
          }
          const elapsedHours = (now.getTime() - createdAt.getTime()) / 3600000;
          const offset =
            rank === 0 ? randInt(1, 40) : rank * 96 + randInt(2, 72);
          return clampToNow(
            addHours(createdAt, Math.min(offset, elapsedHours)),
          );
        };

        if (fullyPaid) {
          const parts = randInt(2, 3);
          let remaining = tuition;
          for (let i = 0; i < parts; i++) {
            const isLast = i === parts - 1;
            const amount = isLast
              ? remaining
              : Math.round((remaining * (i === 0 ? 0.45 : 0.5)) / 5000) * 5000;
            remaining -= amount;
            instalments.push({ amount, at: instalmentDate(i) });
          }
        } else if (partial) {
          const parts = randInt(1, 2);
          for (let i = 0; i < parts; i++) {
            const amount =
              Math.round((tuition * (i === 0 ? 0.4 : 0.2)) / 5000) * 5000;
            instalments.push({ amount, at: instalmentDate(i) });
          }
        }

        for (const instalment of instalments) {
          // Un versement sur vingt est annulé : erreur de saisie ou remboursement.
          const cancelled = chance(0.05);
          const payment = {
            id: randomUUID(),
            schoolId: school.id,
            enrollmentId: enrollment.id,
            amount: instalment.amount,
            method: pick([
              PaymentMethod.CASH,
              PaymentMethod.CASH,
              PaymentMethod.MOBILE_MONEY,
              PaymentMethod.MOBILE_MONEY,
              PaymentMethod.BANK_TRANSFER,
            ]),
            receiptNumber: reference(
              'REC',
              CounterScope.RECEIPT,
              school.id,
              spec.slug,
              instalment.at,
            ),
            receivedByUserId: chance(0.75) ? accountant.id : secretary.id,
            cancelledAt: null,
            cancellationType: null,
            cancellationReason: null,
            cancelledByUserId: null,
          } as Payment;

          if (cancelled) {
            const type = chance(0.6)
              ? CancellationType.ERROR
              : CancellationType.REFUND;
            payment.cancelledAt = clampToNow(
              addDays(instalment.at, randInt(0, 3)),
            );
            payment.cancellationType = type;
            payment.cancellationReason =
              type === CancellationType.ERROR
                ? 'Erreur de saisie : montant encaissé sur le mauvais dossier'
                : 'Remboursement à la famille suite au départ de l’élève';
            payment.cancelledByUserId = director.id;
            // Le versement annulé est immédiatement remplacé par le bon.
            const replacement = {
              ...payment,
              id: randomUUID(),
              receiptNumber: reference(
                'REC',
                CounterScope.RECEIPT,
                school.id,
                spec.slug,
                instalment.at,
              ),
              cancelledAt: null,
              cancellationType: null,
              cancellationReason: null,
              cancelledByUserId: null,
            } as Payment;
            if (type === CancellationType.ERROR) {
              payments.push(replacement);
              paymentDates.push({
                id: replacement.id,
                at: clampToNow(addDays(instalment.at, 1)),
              });
              paidTotal += instalment.amount;
            }
          } else {
            paidTotal += instalment.amount;
          }

          payments.push(payment);
          paymentDates.push({ id: payment.id, at: instalment.at });
        }

        if (paidTotal >= tuition) {
          enrollment.status = EnrollmentStatus.ENROLLED;
        } else if (paidTotal > 0) {
          enrollment.status = EnrollmentStatus.PARTIALLY_PAID;
        } else {
          // Sans le moindre versement, le dossier expire au bout de 72 heures.
          enrollment.status =
            enrollment.expiresAt < now
              ? EnrollmentStatus.EXPIRED
              : EnrollmentStatus.PENDING_PAYMENT;
        }

        enrollments.push(enrollment);
        enrollmentDates.push({ id: enrollment.id, at: createdAt });
        return enrollment;
      };

      const year2025 = yearEntities.get('2025-2026')!;
      const year2026 = yearEntities.get('2026-2027')!;

      // Année 2025-2026 : effectifs complets, dossiers soldés pour l'essentiel.
      for (const classSpec of spec.classes) {
        const classroom = classByName.get(classSpec.name)!;
        const cohort: SeededStudent[] = [];
        for (let i = 0; i < classSpec.headcount; i++) {
          const student = newStudent(classSpec.name);
          const createdAt = date(
            2025,
            randInt(7, 9),
            randInt(1, 28),
            randInt(8, 16),
            randInt(0, 59),
          );
          enroll(student, classroom, year2025, createdAt, 'settled');
          cohort.push(student);
        }
        cohort2025.set(classSpec.name, cohort);
      }

      // Année 2026-2027 : campagne ouverte début juillet, en cours à ce jour.
      const campaignStart = date(2026, 7, 6, 8, 0);
      const campaignEnd = date(2026, 7, 31, 17, 0);

      /**
       * Date d'ouverture d'un dossier de la campagne en cours.
       *
       * Un dossier sur cinq est ouvert dans les 72 heures précédant le jour du
       * seed : son jeton court encore, il reste PENDING_PAYMENT au lieu de
       * basculer EXPIRED. Sans cela, tous les dossiers sans versement
       * apparaîtraient expirés et l'écran de relance serait vide.
       */
      const campaignDate = (): Date =>
        chance(0.2)
          ? new Date(now.getTime() - randInt(1, 60) * 3600 * 1000)
          : workingDayBetween(campaignStart, campaignEnd);

      for (const classSpec of spec.classes) {
        // Réinscriptions : les élèves de la classe précédente montent d'un cran.
        const source = spec.classes.find((c) => c.next === classSpec.name);
        const promoted = source ? (cohort2025.get(source.name) ?? []) : [];
        const classroom = classByName.get(classSpec.name)!;

        for (const student of promoted) {
          // Une famille sur dix ne réinscrit pas (déménagement, autre école).
          if (!chance(0.9)) continue;
          enroll(student, classroom, year2026, campaignDate(), 'campaign');
        }

        // Classes d'entrée : recrutement de nouveaux élèves.
        if (classSpec.entry) {
          for (let i = 0; i < classSpec.headcount; i++) {
            const student = newStudent(classSpec.name);
            enroll(student, classroom, year2026, campaignDate(), 'campaign');
          }
        }
      }

      // --- Évaluations, notes et absences (année écoulée) --------------------
      const gradedYear = years.find((y) => y.graded)!;
      const periods = periodsByYear.get(gradedYear.label)!;
      const periodSpecs = gradedYear.periods;

      // Inscriptions retenues pour la notation : celles de l'année écoulée dont
      // la place a effectivement été sécurisée (au moins un versement).
      const gradable = enrollments.filter(
        (e) =>
          e.academicYearId === year2025.id &&
          (e.status === EnrollmentStatus.ENROLLED ||
            e.status === EnrollmentStatus.PARTIALLY_PAID),
      );
      const abilityByEnrollment = new Map<string, number>();
      const studentAbility = new Map<string, number>();
      for (const cohort of cohort2025.values()) {
        for (const s of cohort) studentAbility.set(s.entity.id, s.ability);
      }
      for (const e of gradable) {
        abilityByEnrollment.set(e.id, studentAbility.get(e.studentId) ?? 0.5);
      }

      const enrollmentsByClass = new Map<string, Enrollment[]>();
      for (const e of gradable) {
        const list = enrollmentsByClass.get(e.classRoomId) ?? [];
        list.push(e);
        enrollmentsByClass.set(e.classRoomId, list);
      }

      for (const classSpec of spec.classes) {
        const classroom = classByName.get(classSpec.name)!;
        const classEnrollments = enrollmentsByClass.get(classroom.id) ?? [];
        if (classEnrollments.length === 0) continue;

        for (let p = 0; p < periods.length; p++) {
          const period = periods[p];
          const periodSpec = periodSpecs[p];

          for (const subjectSpec of spec.subjects) {
            const subject = subjectByShort.get(subjectSpec.shortName)!;
            const teacher = teacherBySubject.get(subjectSpec.shortName)!;
            const topics = EVALUATION_TOPICS[subjectSpec.shortName] ?? [
              'Évaluation',
            ];

            // Usage courant : deux interrogations et un devoir surveillé.
            const plan: Array<{
              type: EvaluationType;
              maxScore: number;
              weight: number;
            }> = [
              { type: EvaluationType.INTERROGATION, maxScore: 10, weight: 1 },
              { type: EvaluationType.INTERROGATION, maxScore: 20, weight: 1 },
              { type: EvaluationType.DEVOIR, maxScore: 20, weight: 2 },
            ];

            plan.forEach((slot, index) => {
              const topic = topics[(p * 3 + index) % topics.length];
              const evaluationDate = workingDayBetween(
                addDays(periodSpec.start, 10 + index * 20),
                addDays(periodSpec.start, 25 + index * 20),
              );
              const evaluation = {
                id: randomUUID(),
                schoolId: school.id,
                classRoomId: classroom.id,
                subjectId: subject.id,
                gradingPeriodId: period.id,
                type: slot.type,
                title:
                  slot.type === EvaluationType.DEVOIR
                    ? `Devoir n°${p + 1} — ${topic}`
                    : `Interrogation n°${index + 1} — ${topic}`,
                date: isoDay(evaluationDate) as unknown as Date,
                maxScore: slot.maxScore,
                weight: slot.weight,
                createdByUserId: teacher.id,
              } as Evaluation;
              evaluations.push(evaluation);

              for (const enrollment of classEnrollments) {
                const ability = abilityByEnrollment.get(enrollment.id) ?? 0.5;
                // Absent à l'épreuve : la note est neutralisée, pas mise à zéro.
                const isAbsent = chance(0.03);
                let score: number | null = null;
                if (!isAbsent) {
                  // Une matière est plus ou moins réussie selon l'élève, mais
                  // la difficulté propre à l'épreuve joue aussi.
                  const mean = 4 + ability * 13 + (rand() - 0.5) * 2;
                  const raw = gaussian(mean, 3.5, 0, 20);
                  score = Math.round((raw * slot.maxScore) / 20 / 0.25) * 0.25;
                  score = Math.min(slot.maxScore, Math.max(0, score));
                }
                grades.push({
                  id: randomUUID(),
                  schoolId: school.id,
                  evaluationId: evaluation.id,
                  enrollmentId: enrollment.id,
                  score,
                  isAbsent,
                  comment: isAbsent
                    ? 'Absent à l’épreuve'
                    : score !== null && score / slot.maxScore >= 0.85
                      ? 'Excellent travail'
                      : score !== null && score / slot.maxScore < 0.35
                        ? 'Travail insuffisant, doit se ressaisir'
                        : null,
                  recordedByUserId: teacher.id,
                } as Grade);
              }
            });
          }

          /**
           * Absences de la période, rattachées à une séance de cours.
           *
           * Le tirage se fait sur les séances de la classe : on choisit un
           * cours, puis une date qui tombe le bon jour de la semaine. C'est
           * la même contrainte que celle imposée aux enseignants — un cours
           * du lundi ne s'appelle que pour un lundi.
           */
          const sessionsOfClass = scheduleEntries.filter(
            (e) =>
              e.classRoomId === classroom.id && e.academicYearId === year2025.id,
          );

          for (const enrollment of classEnrollments) {
            if (sessionsOfClass.length === 0) break;

            const count = chance(0.35)
              ? randInt(1, 8)
              : chance(0.5)
                ? randInt(1, 3)
                : 0;
            const taken = new Set<string>();
            for (let i = 0; i < count; i++) {
              const session =
                sessionsOfClass[randInt(0, sessionsOfClass.length - 1)];
              const day = workingDayBetween(periodSpec.start, periodSpec.end);
              // La date doit tomber le jour de la séance.
              if (day.getDay() !== session.dayOfWeek) continue;

              const key = `${isoDay(day)}|${session.timeSlotId}`;
              if (taken.has(key)) continue; // contrainte d'unicité
              taken.add(key);

              const isJustified = chance(0.55);
              absences.push({
                id: randomUUID(),
                schoolId: school.id,
                enrollmentId: enrollment.id,
                scheduleEntryId: session.id,
                subjectId: assignments.find(
                  (a) => a.id === session.teachingAssignmentId,
                )!.subjectId,
                timeSlotId: session.timeSlotId,
                gradingPeriodId: period.id,
                date: isoDay(day) as unknown as Date,
                // Un relevé sur cinq est un retard, pas une absence.
                status: chance(0.2)
                  ? AbsenceStatus.LATE
                  : AbsenceStatus.ABSENT,
                isJustified,
                reason: isJustified ? pick(ABSENCE_REASONS) : null,
                recordedByUserId: secretary.id,
              } as Absence);
            }
          }
        }
      }
    }

    // --- Écriture ----------------------------------------------------------
    await insertAll(manager, School, schools);
    await insertAll(manager, User, users);
    await insertAll(manager, AcademicYear, academicYears);
    await insertAll(manager, GradingPeriod, gradingPeriods);
    await insertAll(manager, ClassRoom, classrooms);
    await insertAll(manager, Subject, subjects);
    await insertAll(manager, ClassRoomSubject, classroomSubjects);
    await insertAll(manager, TeachingAssignment, assignments);
    await insertAll(manager, TimeSlot, timeSlots);
    await insertAll(manager, ScheduleEntry, scheduleEntries);
    await insertAll(manager, Student, students);
    await insertAll(manager, Enrollment, enrollments);
    await insertAll(manager, Payment, payments);
    await insertAll(manager, Evaluation, evaluations);
    await insertAll(manager, Grade, grades);
    await insertAll(manager, Absence, absences);
    await insertAll(manager, Counter, counters.rows());

    // Les colonnes `@CreateDateColumn` ont été écrasées par PostgreSQL : on
    // rétablit les dates réelles des dossiers et des encaissements.
    await backdate(
      manager,
      'enrollments',
      ['createdAt', 'updatedAt'],
      enrollmentDates,
    );
    await backdate(manager, 'payments', ['paidAt'], paymentDates);

    // --- Récapitulatif -----------------------------------------------------
    const line = (label: string, value: number | string) =>
      console.log(`  ${label.padEnd(26, '.')} ${value}`);

    console.log('\nJeu de données inséré :');
    line('Établissements', schools.length);
    line('Utilisateurs', users.length);
    line('Années scolaires', academicYears.length);
    line('Périodes de notation', gradingPeriods.length);
    line('Classes', classrooms.length);
    line('Matières', subjects.length);
    line('Programmes (classe/matière)', classroomSubjects.length);
    line('Affectations enseignants', assignments.length);
    line('Élèves', students.length);
    line('Inscriptions', enrollments.length);
    line('Versements', payments.length);
    line('Évaluations', evaluations.length);
    line('Notes', grades.length);
    line('Absences', absences.length);

    const byStatus = enrollments.reduce<Record<string, number>>((acc, e) => {
      acc[e.status] = (acc[e.status] ?? 0) + 1;
      return acc;
    }, {});
    console.log('\nInscriptions par statut :');
    for (const [status, count] of Object.entries(byStatus)) line(status, count);

    const collected = payments
      .filter((p) => !p.cancelledAt)
      .reduce((sum, p) => sum + Number(p.amount), 0);
    const expected = enrollments.reduce(
      (sum, e) => sum + Number(e.totalDue),
      0,
    );
    console.log('\nCaisse :');
    line('Encaissé (FCFA)', collected.toLocaleString('fr-FR'));
    line('Attendu (FCFA)', expected.toLocaleString('fr-FR'));
    line('Versements annulés', payments.filter((p) => p.cancelledAt).length);

    console.log('\nComptes de démonstration (mot de passe commun) :');
    console.log(`  Mot de passe .............. ${DEFAULT_PASSWORD}`);
    console.log('  superadmin@gesta-school.ci  SUPER_ADMIN');
    for (const spec of SCHOOLS) {
      console.log(`  direction@${spec.domain}  DIRECTOR (${spec.slug})`);
      console.log(`  secretariat@${spec.domain}  SECRETARY (${spec.slug})`);
      console.log(`  comptabilite@${spec.domain}  ACCOUNTANT (${spec.slug})`);
    }
    console.log('  Enseignants : prenom.nom@<domaine> (voir table users)\n');
  });
}

// -----------------------------------------------------------------------------
// Point d'entrée
// -----------------------------------------------------------------------------

async function main(): Promise<void> {
  const force = process.argv.includes('--force');
  if (process.env.NODE_ENV === 'production' && !force) {
    throw new Error(
      'Refus d’exécution : NODE_ENV=production. Ce script VIDE les tables métier. ' +
        'Relancez avec --force si c’est bien ce que vous voulez.',
    );
  }

  const dataSource = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    entities: [__dirname + '/../**/*.entity{.ts,.js}'],
    synchronize: false,
    logging: ['error'],
  });

  await dataSource.initialize();
  console.log(
    `Connecté à ${process.env.DB_DATABASE}@${process.env.DB_HOST}:${process.env.DB_PORT}`,
  );

  try {
    const started = Date.now();
    await seed(dataSource);
    console.log(`Terminé en ${((Date.now() - started) / 1000).toFixed(1)} s.`);
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error) => {
  console.error(
    '\nÉchec du seed :',
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
