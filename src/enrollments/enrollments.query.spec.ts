import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { AcademicYear } from '../academic-years/entities/academic-year.entity';
import { AuditService } from '../audit/audit.service';
import { ClassRoom } from '../classrooms/entities/classroom.entity';
import { BalanceService } from '../common/balance/balance.service';
import { ReferencesService } from '../common/counters/references.service';
import { Payment } from '../payments/entities/payment.entity';
import { School } from '../schools/entities/school.entity';
import { StudentsService } from '../students/students.service';
import { Enrollment, EnrollmentStatus } from './entities/enrollment.entity';
import { EnrollmentsService } from './enrollments.service';

/**
 * Troisième volet : la liste filtrable des dossiers, son export paginé, et les
 * garde-fous d'ouverture qui restaient à couvrir.
 */
describe('EnrollmentsService (liste, filtres, export)', () => {
  let service: EnrollmentsService;
  let repos: Record<string, any>;
  let students: any;
  let qb: any;

  const row = (id: string, totalDue = 100000, status = EnrollmentStatus.PARTIALLY_PAID) => ({
    id,
    totalDue,
    status,
    reference: `INS-CMB-26-000${id}`,
  });

  beforeEach(async () => {
    qb = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getRawAndEntities: jest.fn().mockResolvedValue({ entities: [], raw: [] }),
      getCount: jest.fn().mockResolvedValue(0),
    };

    repos = {
      enrollment: {
        find: jest.fn().mockResolvedValue([]),
        findOne: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn((d) => ({ ...d })),
        save: jest.fn((e) => Promise.resolve({ ...e, id: 'enr-new' })),
        update: jest.fn().mockResolvedValue({ affected: 0 }),
        remove: jest.fn(),
        createQueryBuilder: jest.fn().mockReturnValue(qb),
      },
      school: { findOne: jest.fn().mockResolvedValue({ id: 'school-1', slug: 'CMB' }) },
      classRoom: {
        findOne: jest.fn().mockResolvedValue({ id: 'class-1', tuitionFee: 100000 }),
      },
      year: {
        findOne: jest
          .fn()
          .mockResolvedValue({ id: 'year-1', label: '2026-2027', isActive: true }),
      },
      payment: { count: jest.fn().mockResolvedValue(0) },
    };
    students = {
      create: jest.fn().mockResolvedValue({ id: 'st-new' }),
      findOneOfSchool: jest.fn().mockResolvedValue({ id: 'st-1' }),
      findDuplicate: jest.fn().mockResolvedValue(null),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EnrollmentsService,
        { provide: getRepositoryToken(Enrollment), useValue: repos.enrollment },
        { provide: getRepositoryToken(School), useValue: repos.school },
        { provide: getRepositoryToken(ClassRoom), useValue: repos.classRoom },
        { provide: getRepositoryToken(AcademicYear), useValue: repos.year },
        { provide: getRepositoryToken(Payment), useValue: repos.payment },
        { provide: StudentsService, useValue: students },
        {
          provide: ReferencesService,
          useValue: {
            nextEnrollmentReference: jest.fn().mockResolvedValue('INS-CMB-26-0001'),
          },
        },
        {
          provide: BalanceService,
          useValue: { compute: jest.fn(), sumPayments: jest.fn().mockResolvedValue(0) },
        },
        {
          provide: AuditService,
          useValue: { record: jest.fn(), diff: jest.fn().mockReturnValue(null) },
        },
            {
        provide: getDataSourceToken(),
        // L'ouverture d'un dossier ecrit dans une transaction : le
        // gestionnaire rejoue les appels sur les depots deja moques.
        useValue: {
          transaction: jest.fn((cb: any) =>
            cb({
              create: jest.fn((_e: unknown, d: any) => ({ ...d })),
              save: jest.fn((d: any) => Promise.resolve({ id: 'enr-new', ...d })),
              getRepository: jest.fn(),
            }),
          ),
        },
      },
      ],
    }).compile();

    service = module.get<EnrollmentsService>(EnrollmentsService);
  });

  describe('findAll', () => {
    it('exige un établissement résolu', async () => {
      await expect(service.findAll('', {} as any)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('cloisonne la liste par établissement', async () => {
      await service.findAll('school-1', {} as any);

      expect(qb.where).toHaveBeenCalledWith('enrollment.schoolId = :schoolId', {
        schoolId: 'school-1',
      });
    });

    it('n’applique aucun filtre superflu', async () => {
      await service.findAll('school-1', {} as any);

      // Seul l'agrégat du déjà-versé s'ajoute : pas de clause vide.
      expect(qb.andWhere).not.toHaveBeenCalled();
    });

    it('applique les filtres statut, année et classe', async () => {
      await service.findAll('school-1', {
        status: EnrollmentStatus.ENROLLED,
        academicYearId: 'year-1',
        classRoomId: 'class-1',
      } as any);

      expect(qb.andWhere).toHaveBeenCalledTimes(3);
    });

    it('cherche sur nom, prénom, référence et téléphone', async () => {
      await service.findAll('school-1', { search: '  Kone ' } as any);

      const [sql, params] = qb.andWhere.mock.calls[0];
      expect(sql).toContain('firstName');
      expect(sql).toContain('lastName');
      expect(sql).toContain('enrollment.reference');
      expect(sql).toContain('parentPhone');
      expect(params).toEqual({ search: '%kone%' });
    });

    it('ignore une recherche réduite à des espaces', async () => {
      await service.findAll('school-1', { search: '   ' } as any);
      expect(qb.andWhere).not.toHaveBeenCalled();
    });

    it('exclut les versements annulés du déjà-versé', async () => {
      const sub = {
        select: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
      };
      await service.findAll('school-1', {} as any);

      // L'agrégat est passé sous forme de fonction : on l'exécute pour
      // inspecter la sous-requête qu'il construit.
      const builder = qb.addSelect.mock.calls[0][0];
      builder(sub);
      expect(sub.andWhere).toHaveBeenCalledWith(
        'payment."cancelledAt" IS NULL',
      );
    });

    it('pagine à 25 lignes par défaut, du plus récent au plus ancien', async () => {
      await service.findAll('school-1', {} as any);

      expect(qb.orderBy).toHaveBeenCalledWith('enrollment.createdAt', 'DESC');
      expect(qb.skip).toHaveBeenCalledWith(0);
      expect(qb.take).toHaveBeenCalledWith(25);
    });

    it('calcule le décalage de la page demandée', async () => {
      await service.findAll('school-1', { page: 3, limit: 10 } as any);
      expect(qb.skip).toHaveBeenCalledWith(20);
    });

    it('joint à chaque dossier sa situation financière', async () => {
      qb.getRawAndEntities.mockResolvedValue({
        entities: [row('1')],
        raw: [{ amountPaid: '40000' }],
      });
      qb.getCount.mockResolvedValue(1);

      const result = await service.findAll('school-1', {} as any);
      expect(result.items[0].balanceInfo).toEqual({
        totalDue: 100000,
        amountPaid: 40000,
        balance: 60000,
        isFullyPaid: false,
        status: EnrollmentStatus.PARTIALLY_PAID,
      });
    });

    it('traite un dossier sans versement comme entièrement dû', async () => {
      qb.getRawAndEntities.mockResolvedValue({
        entities: [row('1')],
        raw: [{}],
      });

      const result = await service.findAll('school-1', {} as any);
      expect(result.items[0].balanceInfo.amountPaid).toBe(0);
      expect(result.items[0].balanceInfo.balance).toBe(100000);
    });

    it('ne rend jamais un solde négatif', async () => {
      qb.getRawAndEntities.mockResolvedValue({
        entities: [row('1')],
        raw: [{ amountPaid: '150000' }],
      });

      const result = await service.findAll('school-1', {} as any);
      expect(result.items[0].balanceInfo.balance).toBe(0);
      expect(result.items[0].balanceInfo.isFullyPaid).toBe(true);
    });

    it('ne déclare pas soldé un dossier sans tarif configuré', async () => {
      qb.getRawAndEntities.mockResolvedValue({
        entities: [row('1', 0)],
        raw: [{ amountPaid: '0' }],
      });

      const result = await service.findAll('school-1', {} as any);
      expect(result.items[0].balanceInfo.isFullyPaid).toBe(false);
    });
  });

  describe('findAllForExport', () => {
    /** Simule une base de `count` dossiers, servie par pages de 500. */
    const givenPages = (count: number) => {
      let served = 0;
      qb.getCount.mockResolvedValue(count);
      qb.getRawAndEntities.mockImplementation(() => {
        const size = Math.min(500, count - served);
        served += size;
        return Promise.resolve({
          entities: Array.from({ length: size }, (_, i) => row(String(i))),
          raw: Array.from({ length: size }, () => ({ amountPaid: '0' })),
        });
      });
    };

    it('rend tous les dossiers d’une page unique', async () => {
      givenPages(120);

      const all = await service.findAllForExport('school-1', {} as any);
      expect(all).toHaveLength(120);
    });

    it('parcourt toutes les pages jusqu’au bout', async () => {
      givenPages(1200);

      // L'export doit contenir tout le résultat filtré : s'arrêter à la
      // première page livrerait un document de relance amputé.
      const all = await service.findAllForExport('school-1', {} as any);
      expect(all).toHaveLength(1200);
    });

    it('rend une liste vide quand aucun dossier ne correspond', async () => {
      givenPages(0);

      await expect(
        service.findAllForExport('school-1', {} as any),
      ).resolves.toEqual([]);
    });
  });

  describe('garde-fous d’ouverture', () => {
    const dto = (overrides: any = {}) => ({
      schoolId: 'school-1',
      classRoomId: 'class-1',
      academicYearId: 'year-1',
      ...overrides,
    });

    it('refuse une année scolaire disparue entre-temps', async () => {
      repos.year.findOne.mockResolvedValue(null);

      await expect(service.create(dto({ studentId: 'st-1' }) as any)).rejects.toThrow(
        /Rechargez la page/,
      );
    });

    it('refuse un élève étranger à l’établissement', async () => {
      students.findOneOfSchool.mockResolvedValue(null);

      await expect(
        service.create(dto({ studentId: 'st-etranger' }) as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('exige un élève ou des données d’élève', async () => {
      await expect(service.create(dto() as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('refuse de créer une seconde fiche pour le même enfant', async () => {
      students.findDuplicate.mockResolvedValue({
        id: 'st-1',
        firstName: 'Ama',
        lastName: 'Kone',
        birthDay: '2011-03-05',
        parentPhone: '+2250700000001',
      });

      // C'est ce qui faisait perdre l'historique d'une année sur l'autre.
      await expect(
        service.create(
          dto({
            studentData: {
              firstName: 'Ama',
              lastName: 'Kone',
              birthDay: '05-03-2011',
            },
          }) as any,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('propose la fiche existante pour basculer dessus', async () => {
      students.findDuplicate.mockResolvedValue({
        id: 'st-1',
        firstName: 'Ama',
        lastName: 'Kone',
        birthDay: '2011-03-05',
        parentPhone: '+2250700000001',
      });

      const error = await service
        .create(
          dto({
            studentData: {
              firstName: 'Ama',
              lastName: 'Kone',
              birthDay: '05-03-2011',
            },
          }) as any,
        )
        .catch((e) => e);

      expect(error.getResponse().existingStudent).toMatchObject({
        id: 'st-1',
        lastName: 'Kone',
      });
    });

    it('crée la fiche quand aucun homonyme n’existe', async () => {
      repos.enrollment.findOne.mockImplementation((options: any) =>
        Promise.resolve(
          options?.where?.studentId ? null : { id: 'enr-new', reference: 'X' },
        ),
      );

      await service.create(
        dto({
          studentData: {
            firstName: 'Ama',
            lastName: 'Kone',
            birthDay: '05-03-2011',
          },
        }) as any,
      );

      expect(students.create).toHaveBeenCalled();
    });

    it('signale une inscription inexistante', async () => {
      repos.enrollment.findOne.mockResolvedValue(null);

      await expect(service.findOne('enr-x')).rejects.toThrow(NotFoundException);
    });

    it('refuse de renouveler le dossier d’un autre établissement', async () => {
      repos.enrollment.findOne.mockResolvedValue({
        id: 'enr-1',
        schoolId: 'school-2',
      });

      await expect(service.renew('enr-1', 'school-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('exige un établissement résolu pour renouveler', async () => {
      await expect(service.renew('enr-1', '')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});
