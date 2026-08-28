import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { Role } from '../common/enums/role.enum';
import { Enrollment } from '../enrollments/entities/enrollment.entity';
import { GradingPeriod } from '../grading-periods/entities/grading-period.entity';
import { ScheduleEntry } from '../schedule/entities/schedule-entry.entity';
import { Absence, AbsenceStatus } from './entities/absence.entity';
import { RollCall } from './entities/roll-call.entity';
import { AbsencesService } from './absences.service';
import { AuditService } from '../audit/audit.service';

describe('AbsencesService (appel par séance)', () => {
  let service: AbsencesService;
  let repos: Record<string, any>;
  let manager: any;
  let audit: any;
  let queryBuilder: any;

  const DIRECTOR = {
    id: 'dir-1',
    roles: [Role.DIRECTOR],
    schoolId: 'school-1',
  } as AuthUser;
  const TEACHER = {
    id: 'teach-1',
    roles: [Role.TEACHER],
    schoolId: 'school-1',
  } as AuthUser;
  const OTHER_TEACHER = {
    id: 'teach-2',
    roles: [Role.TEACHER],
    schoolId: 'school-1',
  } as AuthUser;

  /** Dernier lundi écoulé : la séance de référence a lieu le lundi. */
  const lastMonday = () => {
    const d = new Date();
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7 || 7));
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  /** Le mardi qui suit ce lundi — jour où la séance n'a pas lieu. */
  const lastTuesday = () => {
    const d = new Date(`${lastMonday()}T00:00:00`);
    d.setDate(d.getDate() + 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  /** Séance du lundi, français en 6ème A, assurée par TEACHER. */
  const session = (overrides: any = {}) => ({
    id: 'entry-1',
    schoolId: 'school-1',
    academicYearId: 'year-1',
    classRoomId: 'class-1',
    teacherId: 'teach-1',
    dayOfWeek: 1,
    timeSlotId: 'slot-1',
    timeSlot: { id: 'slot-1', label: '1ère heure', isBreak: false, sequence: 1 },
    classRoom: { name: '6ème A' },
    teachingAssignment: { subjectId: 'sub-fr', subject: { name: 'Français' } },
    ...overrides,
  });

  const openPeriod = (overrides: any = {}) => ({
    id: 'period-1',
    label: '1er Semestre',
    isClosed: false,
    sequence: 1,
    startDate: '2000-01-01',
    endDate: '2099-12-31',
    ...overrides,
  });

  const dto = (overrides: any = {}) => ({
    scheduleEntryId: 'entry-1',
    date: lastMonday(),
    entries: [{ enrollmentId: 'enr-1', status: AbsenceStatus.ABSENT }],
    ...overrides,
  });

  beforeEach(async () => {
    queryBuilder = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      addGroupBy: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
    };

    repos = {
      absence: {
        find: jest.fn().mockResolvedValue([]),
        findOne: jest.fn().mockResolvedValue(null),
        create: jest.fn((d) => ({ ...d })),
        merge: jest.fn((current, d) => Object.assign(current, d)),
        save: jest.fn((d) => Promise.resolve(d)),
        remove: jest.fn(),
        createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
      },
      enrollment: {
        find: jest.fn().mockResolvedValue([{ id: 'enr-1' }]),
      },
      period: {
        find: jest.fn().mockResolvedValue([openPeriod()]),
      },
      schedule: {
        find: jest.fn().mockResolvedValue([session()]),
        findOne: jest.fn().mockResolvedValue(session()),
      },
      rollCall: {
        find: jest.fn().mockResolvedValue([]),
      },
    };

    manager = {
      remove: jest.fn(),
      save: jest.fn(),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((_e: unknown, d: any) => ({ ...d })),
      merge: jest.fn((_e: unknown, current: any, d: any) =>
        Object.assign(current, d),
      ),
    };
    audit = { record: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AbsencesService,
        { provide: getRepositoryToken(Absence), useValue: repos.absence },
        { provide: getRepositoryToken(Enrollment), useValue: repos.enrollment },
        { provide: getRepositoryToken(GradingPeriod), useValue: repos.period },
        {
          provide: getRepositoryToken(ScheduleEntry),
          useValue: repos.schedule,
        },
        { provide: getRepositoryToken(RollCall), useValue: repos.rollCall },
        {
          provide: getDataSourceToken(),
          useValue: { transaction: jest.fn((cb: any) => cb(manager)) },
        },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    service = module.get<AbsencesService>(AbsencesService);
  });

  describe('la séance commande l’appel', () => {
    it('refuse une séance qui n’existe pas dans l’établissement', async () => {
      repos.schedule.findOne.mockResolvedValue(null);

      await expect(service.record(dto(), 'school-1', TEACHER)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('refuse à un enseignant le cours d’un collègue', async () => {
      // L'appel revient à celui qui tient la classe : sans ce contrôle,
      // n'importe quel professeur pouvait relever l'assiduité de tous.
      await expect(
        service.record(dto(), 'school-1', OTHER_TEACHER),
      ).rejects.toThrow(/n'assurez pas ce cours/);
    });

    it('en dispense la direction, qui corrige quand l’enseignant n’a pas pu', async () => {
      await expect(
        service.record(dto(), 'school-1', DIRECTOR),
      ).resolves.toBeDefined();
    });

    it('refuse une date qui ne tombe pas le jour du cours', async () => {
      // Le cours a lieu le lundi : on ne l'appelle pas pour un mardi.
      await expect(
        service.record(dto({ date: lastTuesday() }), 'school-1', TEACHER),
      ).rejects.toThrow(/lundi/);
    });

    it('accepte une saisie différée, tant qu’elle vise le bon jour', async () => {
      // Relever le mardi l'appel du lundi reste possible : c'est l'heure de
      // saisie qui est libre, pas la séance visée.
      await expect(
        service.record(dto(), 'school-1', TEACHER),
      ).resolves.toBeDefined();
    });
  });

  describe('contrôle de la date', () => {
    it('refuse un appel daté du futur', async () => {
      const nextMonday = new Date(`${lastMonday()}T00:00:00`);
      nextMonday.setDate(nextMonday.getDate() + 14);
      const iso = `${nextMonday.getFullYear()}-${String(nextMonday.getMonth() + 1).padStart(2, '0')}-${String(nextMonday.getDate()).padStart(2, '0')}`;

      await expect(
        service.record(dto({ date: iso }), 'school-1', TEACHER),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuse une date que ne couvre aucune période', async () => {
      repos.period.find.mockResolvedValue([
        openPeriod({ startDate: '2000-01-01', endDate: '2000-06-30' }),
      ]);

      await expect(service.record(dto(), 'school-1', TEACHER)).rejects.toThrow(
        /aucune période de notation/,
      );
    });

    it('refuse une période clôturée', async () => {
      repos.period.find.mockResolvedValue([openPeriod({ isClosed: true })]);

      await expect(service.record(dto(), 'school-1', TEACHER)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('enregistrement', () => {
    it('rattache la matière et le créneau de la séance', async () => {
      await service.record(dto(), 'school-1', TEACHER);

      const [saved] = manager.save.mock.calls[0];
      expect(saved[0]).toMatchObject({
        subjectId: 'sub-fr',
        timeSlotId: 'slot-1',
        scheduleEntryId: 'entry-1',
        gradingPeriodId: 'period-1',
        status: AbsenceStatus.ABSENT,
      });
    });

    it('accepte le retard comme un statut à part entière', async () => {
      await service.record(
        dto({
          entries: [{ enrollmentId: 'enr-1', status: AbsenceStatus.LATE }],
        }),
        'school-1',
        TEACHER,
      );

      const [saved] = manager.save.mock.calls[0];
      expect(saved[0].status).toBe(AbsenceStatus.LATE);
    });

    it('efface ce qui n’est plus déclaré : l’élève est repassé présent', async () => {
      repos.absence.find.mockResolvedValue([
        { id: 'abs-1', enrollmentId: 'enr-1' },
      ]);

      const result = await service.record(
        dto({ entries: [] }),
        'school-1',
        TEACHER,
      );

      expect(manager.remove).toHaveBeenCalled();
      expect(result.cleared).toBe(1);
    });

    it('écarte un élève étranger à la classe sans faire échouer l’appel', async () => {
      const result = await service.record(
        dto({
          entries: [
            { enrollmentId: 'enr-1', status: AbsenceStatus.ABSENT },
            { enrollmentId: 'enr-autre-classe', status: AbsenceStatus.ABSENT },
          ],
        }),
        'school-1',
        TEACHER,
      );

      expect(result.recorded).toBe(1);
    });

    it('journalise l’appel avec la matière et la classe', async () => {
      await service.record(dto(), 'school-1', TEACHER);

      const [entry] = audit.record.mock.calls[0];
      expect(entry.summary).toContain('Français');
      expect(entry.summary).toContain('6ème A');
    });

    it('trace l’appel même quand tout le monde est présent', async () => {
      await service.record(dto({ entries: [] }), 'school-1', TEACHER);

      // Sans cette marque, une séance sans absent serait indiscernable d'une
      // séance jamais appelée.
      const saved = manager.save.mock.calls.map((c: any[]) => c[0]);
      expect(
        saved.some((v: any) => v?.scheduleEntryId === 'entry-1' && v?.takenByUserId),
      ).toBe(true);

      const [entry] = audit.record.mock.calls[0];
      expect(entry.summary).toContain('aucun absent');
    });

    it('met à jour la marque plutôt que d’en créer une seconde', async () => {
      manager.findOne.mockResolvedValue({ id: 'rc-1', takenByUserId: 'old' });

      await service.record(dto(), 'school-1', TEACHER);

      expect(manager.merge).toHaveBeenCalled();
      expect(manager.create).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ scheduleEntryId: 'entry-1' }),
      );
    });
  });

  describe('feuille d’appel', () => {
    it('rend « présent » comme absence de marque', async () => {
      repos.enrollment.find.mockResolvedValue([
        {
          id: 'enr-1',
          studentId: 'st-1',
          student: { firstName: 'Ama', lastName: 'Kouassi' },
        },
      ]);

      const result = await service.getRollCall(
        'school-1',
        'entry-1',
        lastMonday(),
        TEACHER,
      );

      expect(result.students[0].mark).toBeNull();
      expect(result.session.subjectName).toBe('Français');
    });

    it('exige un établissement résolu', async () => {
      await expect(
        service.getRollCall('', 'entry-1', lastMonday(), TEACHER),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('séances proposées à l’enseignant', () => {
    it('écarte les pauses, qui ne s’appellent pas', async () => {
      repos.schedule.find.mockResolvedValue([
        session(),
        session({ id: 'entry-2', timeSlot: { isBreak: true, sequence: 2 } }),
      ]);

      const sessions = await service.getMySessions(
        'school-1',
        lastMonday(),
        TEACHER,
      );

      expect(sessions).toHaveLength(1);
    });
  });

  describe('appels manquants', () => {
    /** Intervalle passé de deux semaines, borné au dernier lundi. */
    const range = () => {
      const end = new Date(`${lastMonday()}T00:00:00`);
      const start = new Date(end);
      start.setDate(start.getDate() - 7);
      const iso = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      return { from: iso(start), to: iso(end) };
    };

    it('signale la séance du lundi non appelée', async () => {
      const { from, to } = range();

      const missing = await service.getMissingRollCalls('school-1', from, to);

      // Deux lundis dans l'intervalle, aucun appel enregistré.
      expect(missing.length).toBeGreaterThan(0);
      expect(missing[0]).toMatchObject({
        scheduleEntryId: 'entry-1',
        subjectName: 'Français',
        classRoomName: '6ème A',
      });
    });

    it('ne signale plus une séance déjà appelée', async () => {
      const { from, to } = range();
      repos.rollCall.find.mockResolvedValue([
        { scheduleEntryId: 'entry-1', date: to },
      ]);

      const missing = await service.getMissingRollCalls('school-1', from, to);

      expect(missing.some((m) => m.date === to)).toBe(false);
    });

    it('écarte les pauses, qui ne s’appellent pas', async () => {
      const { from, to } = range();
      repos.schedule.find.mockResolvedValue([
        session({ timeSlot: { isBreak: true, label: 'Récréation' } }),
      ]);

      await expect(
        service.getMissingRollCalls('school-1', from, to),
      ).resolves.toEqual([]);
    });

    it('refuse un intervalle inversé', async () => {
      await expect(
        service.getMissingRollCalls('school-1', '2026-09-01', '2026-08-01'),
      ).rejects.toThrow(/précéder/);
    });

    it('refuse un intervalle trop large, qui déroulerait un an de calendrier', async () => {
      await expect(
        service.getMissingRollCalls('school-1', '2026-01-01', '2026-12-31'),
      ).rejects.toThrow(/dépasse/);
    });

    it('exige un établissement résolu', async () => {
      await expect(
        service.getMissingRollCalls('', '2026-08-01', '2026-08-10'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('cumul du bulletin', () => {
    it('ne compte pas les retards comme des absences', async () => {
      await service.countByPeriod('school-1', ['enr-1'], 'period-1');

      // L'élève était là : un retard ne se compte pas en séance manquée.
      const statusFilter = queryBuilder.andWhere.mock.calls.find(
        (c: any[]) => typeof c[0] === 'string' && c[0].includes('status'),
      );
      expect(statusFilter?.[1]).toEqual({ status: AbsenceStatus.ABSENT });
    });

    it('ne requête rien pour une liste vide', async () => {
      const result = await service.countByPeriod('school-1', [], 'period-1');
      expect(result.size).toBe(0);
      expect(repos.absence.createQueryBuilder).not.toHaveBeenCalled();
    });
  });

  describe('suivi de la direction', () => {
    it('exige un établissement résolu', async () => {
      await expect(service.getOverview('', {})).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('ne retient que les élèves au-delà du seuil', async () => {
      queryBuilder.getRawMany.mockResolvedValue([
        {
          enrollmentId: 'enr-1',
          lastName: 'Aka',
          firstName: 'Nadège',
          classRoomId: 'c1',
          classRoomName: '6ème A',
          subjectId: 'sub-fr',
          subjectName: 'Français',
          unjustified: '6',
          justified: '1',
          late: '2',
        },
        {
          enrollmentId: 'enr-2',
          lastName: 'Traoré',
          firstName: 'Ismaël',
          classRoomId: 'c1',
          classRoomName: '6ème A',
          subjectId: 'sub-fr',
          subjectName: 'Français',
          unjustified: '1',
          justified: '0',
          late: '0',
        },
      ]);

      const atRisk = await service.getAtRisk('school-1', 5, {});

      expect(atRisk).toHaveLength(1);
      expect(atRisk[0].lastName).toBe('Aka');
      expect(atRisk[0].subjects).toContain('Français');
    });

    it('additionne les matières pour un même élève', async () => {
      queryBuilder.getRawMany.mockResolvedValue([
        {
          enrollmentId: 'enr-1',
          lastName: 'Aka',
          firstName: 'Nadège',
          classRoomId: 'c1',
          classRoomName: '6ème A',
          subjectId: 'sub-fr',
          subjectName: 'Français',
          unjustified: '3',
          justified: '0',
          late: '0',
        },
        {
          enrollmentId: 'enr-1',
          lastName: 'Aka',
          firstName: 'Nadège',
          classRoomId: 'c1',
          classRoomName: '6ème A',
          subjectId: 'sub-math',
          subjectName: 'Mathématiques',
          unjustified: '3',
          justified: '0',
          late: '0',
        },
      ]);

      const atRisk = await service.getAtRisk('school-1', 5, {});

      // Trois absences en français et trois en maths font six, pas trois.
      expect(atRisk[0].unjustified).toBe(6);
      expect(atRisk[0].subjects).toEqual(['Français', 'Mathématiques']);
    });
  });

  describe('correction', () => {
    it('refuse une ligne d’un autre établissement', async () => {
      repos.absence.findOne.mockResolvedValue(null);

      await expect(
        service.update('abs-1', { isJustified: true }, 'school-2'),
      ).rejects.toThrow(NotFoundException);
    });

    it('journalise la suppression', async () => {
      repos.absence.findOne.mockResolvedValue({
        id: 'abs-1',
        subject: { name: 'Français' },
      });

      await service.remove('abs-1', 'school-1', DIRECTOR);

      expect(audit.record).toHaveBeenCalled();
    });
  });
});
