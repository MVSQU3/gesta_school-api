import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BulletinsService } from '../bulletins/bulletins.service';
import { Enrollment } from '../enrollments/entities/enrollment.entity';
import { GradingPeriod } from '../grading-periods/entities/grading-period.entity';
import { Student } from '../students/entities/student.entity';
import { TransferRequest, TransferStatus } from './entities/transfer-request.entity';
import { TransfersService } from './transfers.service';

/**
 * Le transfert est la seule fonctionnalité qui traverse le cloisonnement
 * multi-établissement. Les tests portent donc autant sur ce qui doit sortir
 * que sur ce qui ne doit jamais sortir.
 */
describe('TransfersService (transfert de dossier)', () => {
  let service: TransfersService;
  let repos: Record<string, any>;
  let bulletins: any;
  let queryBuilder: any;

  const HOLDING = 'school-A';
  const REQUESTING = 'school-D';

  const student = () => ({
    id: 'student-1',
    schoolId: HOLDING,
    firstName: 'Yao',
    lastName: 'Brou',
    birthDay: new Date('2011-04-12'),
    school: { id: HOLDING, name: 'École A' },
  });

  const approvedRequest = (overrides: any = {}) => ({
    id: 'req-1',
    requestingSchoolId: REQUESTING,
    holdingSchoolId: HOLDING,
    studentId: 'student-1',
    status: TransferStatus.APPROVED,
    expiresAt: new Date(Date.now() + 86_400_000),
    student: student(),
    holdingSchool: { id: HOLDING, name: 'École A' },
    requestingSchool: { id: REQUESTING, name: 'École D' },
    ...overrides,
  });

  beforeEach(async () => {
    queryBuilder = {
      innerJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };

    repos = {
      request: {
        find: jest.fn().mockResolvedValue([]),
        findOne: jest.fn(),
        save: jest.fn((r) => Promise.resolve(r)),
        create: jest.fn((d) => ({ ...d })),
      },
      student: {
        findOne: jest.fn(),
        createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
      },
      enrollment: { find: jest.fn().mockResolvedValue([]) },
      period: { find: jest.fn().mockResolvedValue([]) },
    };
    bulletins = { getStudentBulletin: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransfersService,
        { provide: getRepositoryToken(TransferRequest), useValue: repos.request },
        { provide: getRepositoryToken(Student), useValue: repos.student },
        { provide: getRepositoryToken(Enrollment), useValue: repos.enrollment },
        { provide: getRepositoryToken(GradingPeriod), useValue: repos.period },
        { provide: BulletinsService, useValue: bulletins },
      ],
    }).compile();

    service = module.get<TransfersService>(TransfersService);
  });

  describe('recherche inter-écoles', () => {
    const criteria = {
      lastName: 'Brou',
      firstName: 'Yao',
      birthDay: '12-04-2011',
    };

    it('exclut l’établissement demandeur de la recherche', async () => {
      await service.searchAcrossSchools(REQUESTING, criteria);

      expect(queryBuilder.where).toHaveBeenCalledWith(
        'student.schoolId != :requestingSchoolId',
        { requestingSchoolId: REQUESTING },
      );
    });

    it('exige les trois critères simultanément', async () => {
      await service.searchAcrossSchools(REQUESTING, criteria);

      // Sans la date de naissance, l'endpoint deviendrait un annuaire des
      // élèves de toutes les écoles, consultable par n'importe quel directeur.
      const clauses = queryBuilder.andWhere.mock.calls.map((c: any[]) => c[0]);
      expect(clauses.join(' ')).toMatch(/firstName/);
      expect(clauses.join(' ')).toMatch(/lastName/);
      expect(clauses.join(' ')).toMatch(/birthDay/);
    });

    it('compare les noms sans tenir compte de la casse ni des espaces', async () => {
      await service.searchAcrossSchools(REQUESTING, {
        ...criteria,
        firstName: '  YAO ',
      });

      const call = queryBuilder.andWhere.mock.calls.find((c: any[]) =>
        c[0].includes('firstName'),
      );
      expect(call[0]).toContain('LOWER(TRIM(');
      expect(call[1]).toEqual({ firstName: 'yao' });
    });

    it('ne retourne que l’identité et l’établissement détenteur', async () => {
      queryBuilder.getMany.mockResolvedValue([student()]);

      const [match] = await service.searchAcrossSchools(REQUESTING, criteria);

      // Aucune note, aucun solde, aucun téléphone : le consentement de l'école
      // détentrice n'a pas encore été donné.
      expect(Object.keys(match).sort()).toEqual([
        'birthDay',
        'existingRequest',
        'firstName',
        'lastName',
        'school',
        'studentId',
      ]);
    });

    it('n’interroge pas les demandes quand aucun élève ne correspond', async () => {
      queryBuilder.getMany.mockResolvedValue([]);

      await expect(
        service.searchAcrossSchools(REQUESTING, criteria),
      ).resolves.toEqual([]);
      expect(repos.request.find).not.toHaveBeenCalled();
    });

    it('signale une demande déjà en cours pour cet élève', async () => {
      queryBuilder.getMany.mockResolvedValue([student()]);
      repos.request.find.mockResolvedValue([
        { id: 'req-1', studentId: 'student-1', status: TransferStatus.PENDING },
      ]);

      const [match] = await service.searchAcrossSchools(REQUESTING, criteria);
      expect(match.existingRequest).toEqual({
        id: 'req-1',
        status: TransferStatus.PENDING,
      });
    });
  });

  describe('émission d’une demande', () => {
    const dto = {
      studentId: 'student-1',
      holdingSchoolId: HOLDING,
      reason: 'Inscription en 4ème, vérification du niveau',
    };

    it('crée la demande en attente', async () => {
      repos.student.findOne.mockResolvedValue(student());
      repos.request.findOne.mockResolvedValue(null);

      const created = await service.create(REQUESTING, 'user-1', dto);
      expect(created.status).toBe(TransferStatus.PENDING);
      expect(created.holdingSchoolId).toBe(HOLDING);
    });

    it('refuse un élève inconnu', async () => {
      repos.student.findOne.mockResolvedValue(null);

      await expect(service.create(REQUESTING, 'user-1', dto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('refuse un établissement détenteur falsifié', async () => {
      repos.student.findOne.mockResolvedValue(student());

      // Sinon la demande partirait à une école qui ne détient rien, dont le
      // directeur accorderait un accès sur un dossier qui n'est pas le sien.
      await expect(
        service.create(REQUESTING, 'user-1', { ...dto, holdingSchoolId: 'school-X' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('renvoie vers l’espace Élèves pour un élève déjà inscrit chez soi', async () => {
      repos.student.findOne.mockResolvedValue({ ...student(), schoolId: REQUESTING });

      await expect(
        service.create(REQUESTING, 'user-1', { ...dto, holdingSchoolId: REQUESTING }),
      ).rejects.toThrow(/espace Élèves/);
    });

    it('refuse une seconde demande quand une est déjà en attente', async () => {
      repos.student.findOne.mockResolvedValue(student());
      repos.request.findOne.mockResolvedValue({ status: TransferStatus.PENDING });

      await expect(service.create(REQUESTING, 'user-1', dto)).rejects.toThrow(
        /déjà en attente/,
      );
    });

    it('signale un accès déjà accordé plutôt que de le redemander', async () => {
      repos.student.findOne.mockResolvedValue(student());
      repos.request.findOne.mockResolvedValue({ status: TransferStatus.APPROVED });

      await expect(service.create(REQUESTING, 'user-1', dto)).rejects.toThrow(
        /déjà accès/,
      );
    });
  });

  describe('décision de l’école détentrice', () => {
    it('accorde un accès borné dans le temps', async () => {
      repos.request.findOne.mockResolvedValue(
        approvedRequest({ status: TransferStatus.PENDING, expiresAt: null }),
      );

      const before = Date.now();
      const result = await service.approve('req-1', HOLDING, 'user-A', {
        durationDays: 30,
      });

      expect(result.status).toBe(TransferStatus.APPROVED);
      const days = (result.expiresAt!.getTime() - before) / 86_400_000;
      expect(Math.round(days)).toBe(30);
    });

    it('applique 30 jours par défaut', async () => {
      repos.request.findOne.mockResolvedValue(
        approvedRequest({ status: TransferStatus.PENDING, expiresAt: null }),
      );

      const before = Date.now();
      const result = await service.approve('req-1', HOLDING, 'user-A', {});
      const days = (result.expiresAt!.getTime() - before) / 86_400_000;
      expect(Math.round(days)).toBe(30);
    });

    it('enregistre le motif et l’auteur d’un refus', async () => {
      repos.request.findOne.mockResolvedValue(
        approvedRequest({ status: TransferStatus.PENDING }),
      );

      const result = await service.reject('req-1', HOLDING, 'user-A', {
        reason: 'Dossier non soldé',
      });
      expect(result.status).toBe(TransferStatus.REJECTED);
      expect(result.decisionReason).toBe('Dossier non soldé');
      expect(result.decidedById).toBe('user-A');
    });

    it('refuse de retraiter une demande déjà décidée', async () => {
      repos.request.findOne.mockResolvedValue(
        approvedRequest({ status: TransferStatus.REJECTED }),
      );

      await expect(
        service.approve('req-1', HOLDING, 'user-A', {}),
      ).rejects.toThrow(BadRequestException);
    });

    it('révoque un accès en cours', async () => {
      repos.request.findOne.mockResolvedValue(approvedRequest());

      const result = await service.revoke('req-1', HOLDING, 'user-A', 'Demande du parent');
      expect(result.status).toBe(TransferStatus.REVOKED);
      expect(result.decisionReason).toBe('Demande du parent');
    });

    it('ne révoque pas une demande jamais accordée', async () => {
      repos.request.findOne.mockResolvedValue(
        approvedRequest({ status: TransferStatus.PENDING }),
      );

      await expect(service.revoke('req-1', HOLDING, 'user-A')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('empêche l’école demandeuse de s’auto-accorder l’accès', async () => {
      repos.request.findOne.mockResolvedValue(
        approvedRequest({ status: TransferStatus.PENDING }),
      );

      // Et répond 404 plutôt que 403 : distinguer les deux permettrait de
      // sonder l'existence des demandes des autres établissements.
      await expect(
        service.approve('req-1', REQUESTING, 'user-D', {}),
      ).rejects.toThrow(NotFoundException);
    });

    it('empêche l’école détentrice de lire le dossier via la route demandeuse', async () => {
      repos.request.findOne.mockResolvedValue(approvedRequest());

      await expect(service.getSharedFile('req-1', HOLDING)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('dossier partagé', () => {
    const withBulletin = (average: number | null) => {
      repos.enrollment.find.mockResolvedValue([
        {
          id: 'enr-1',
          academicYearId: 'year-1',
          academicYear: { label: '2025-2026' },
          classRoom: { name: '5ème A' },
        },
      ]);
      repos.period.find.mockResolvedValue([{ id: 'p1', label: '1er Trimestre' }]);
      bulletins.getStudentBulletin.mockResolvedValue({
        bulletin: {
          average,
          rank: 3,
          classSize: 40,
          subjects: [
            {
              name: 'Mathématiques',
              coefficient: 4,
              average: 15,
              classAverage: 12,
              // Champs présents dans le bulletin interne mais qui ne doivent
              // pas franchir la frontière inter-écoles.
              points: 60,
              evaluationCount: 3,
            },
          ],
          absences: { justified: 2, unjustified: 1 },
        },
      });
    };

    it('refuse la lecture avant acceptation', async () => {
      repos.request.findOne.mockResolvedValue(
        approvedRequest({ status: TransferStatus.PENDING }),
      );

      await expect(service.getSharedFile('req-1', REQUESTING)).rejects.toThrow(
        /pas encore été acceptée/,
      );
    });

    it('refuse la lecture après révocation', async () => {
      repos.request.findOne.mockResolvedValue(
        approvedRequest({ status: TransferStatus.REVOKED }),
      );

      await expect(service.getSharedFile('req-1', REQUESTING)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('refuse la lecture passé le terme', async () => {
      repos.request.findOne.mockResolvedValue(
        approvedRequest({ expiresAt: new Date(Date.now() - 1000) }),
      );

      await expect(service.getSharedFile('req-1', REQUESTING)).rejects.toThrow(
        /a expiré/,
      );
    });

    it('revérifie l’autorisation à chaque lecture', async () => {
      repos.request.findOne.mockResolvedValue(approvedRequest());
      withBulletin(14);

      await service.getSharedFile('req-1', REQUESTING);
      await service.getSharedFile('req-1', REQUESTING);

      // Un écran déjà ouvert ne doit pas survivre à une révocation.
      expect(repos.request.findOne).toHaveBeenCalledTimes(2);
    });

    it('transmet les bulletins avec le détail par matière', async () => {
      repos.request.findOne.mockResolvedValue(approvedRequest());
      withBulletin(14);

      const file = await service.getSharedFile('req-1', REQUESTING);
      expect(file.years[0].label).toBe('2025-2026');
      expect(file.years[0].periods[0].average).toBe(14);
      expect(file.years[0].periods[0].subjects[0]).toEqual({
        name: 'Mathématiques',
        coefficient: 4,
        average: 15,
        classAverage: 12,
      });
    });

    it('ne laisse fuir ni finances, ni absences, ni coordonnées', async () => {
      repos.request.findOne.mockResolvedValue(approvedRequest());
      withBulletin(14);

      const raw = JSON.stringify(await service.getSharedFile('req-1', REQUESTING));

      // Ce que la famille devait à l'école précédente ne regarde pas la
      // suivante : l'exposer ferait de l'outil un fichier de mauvais payeurs.
      expect(raw).not.toMatch(/balance|amountPaid|totalDue|receipt|payment/i);
      expect(raw).not.toMatch(/absence|justified|parentPhone/i);
      expect(raw).not.toMatch(/points|evaluationCount/i);
    });

    it('omet une période sans aucune note', async () => {
      repos.request.findOne.mockResolvedValue(approvedRequest());
      withBulletin(null);

      // Une ligne vide dans un dossier reçu se lit comme un mauvais résultat.
      const file = await service.getSharedFile('req-1', REQUESTING);
      expect(file.years).toEqual([]);
    });

    it('omet une période dont le bulletin n’est pas calculable', async () => {
      repos.request.findOne.mockResolvedValue(approvedRequest());
      withBulletin(14);
      bulletins.getStudentBulletin.mockRejectedValue(new Error('pas de bulletin'));

      const file = await service.getSharedFile('req-1', REQUESTING);
      expect(file.years).toEqual([]);
    });

    it('ne lit que les inscriptions de l’école détentrice', async () => {
      repos.request.findOne.mockResolvedValue(approvedRequest());
      withBulletin(14);

      await service.getSharedFile('req-1', REQUESTING);
      expect(repos.enrollment.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { studentId: 'student-1', schoolId: HOLDING },
        }),
      );
    });

    it('signale une demande inexistante', async () => {
      repos.request.findOne.mockResolvedValue(null);

      await expect(service.getSharedFile('req-x', REQUESTING)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('listes', () => {
    it('sépare les demandes émises des demandes reçues', async () => {
      await service.findOutgoing(REQUESTING);
      expect(repos.request.find.mock.calls[0][0].where).toEqual({
        requestingSchoolId: REQUESTING,
      });

      await service.findIncoming(HOLDING);
      expect(repos.request.find.mock.calls[1][0].where).toEqual({
        holdingSchoolId: HOLDING,
      });
    });
  });
});
