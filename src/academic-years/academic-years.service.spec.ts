import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { Enrollment } from '../enrollments/entities/enrollment.entity';
import { GradingPeriodsService } from '../grading-periods/grading-periods.service';
import { AcademicYear } from './entities/academic-year.entity';
import { AcademicYearsService } from './academic-years.service';
import { AuditService } from '../audit/audit.service';

describe('AcademicYearsService (années scolaires)', () => {
  let service: AcademicYearsService;
  let yearRepo: any;
  let enrollmentRepo: any;
  let periodsService: any;
  let manager: any;
  let dataSource: any;

  const year = (overrides: any = {}) => ({
    id: 'year-1',
    schoolId: 'school-1',
    label: '2026-2027',
    isActive: false,
    ...overrides,
  });

  beforeEach(async () => {
    manager = { update: jest.fn() };
    dataSource = { transaction: jest.fn((cb: any) => cb(manager)) };

    yearRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(year()),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn((d) => ({ ...d })),
      save: jest.fn((y) => Promise.resolve({ ...y, id: 'year-1' })),
      remove: jest.fn(),
    };
    enrollmentRepo = { count: jest.fn().mockResolvedValue(0) };
    periodsService = {
      generateForAcademicYear: jest.fn(),
      closeAllOfYear: jest.fn().mockResolvedValue(3),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AcademicYearsService,
        { provide: getRepositoryToken(AcademicYear), useValue: yearRepo },
        { provide: getRepositoryToken(Enrollment), useValue: enrollmentRepo },
        { provide: GradingPeriodsService, useValue: periodsService },
        { provide: getDataSourceToken(), useValue: dataSource },
            {
        provide: AuditService,
        useValue: { record: jest.fn(), diff: jest.fn().mockReturnValue(null) },
      },
      ],
    }).compile();

    service = module.get<AcademicYearsService>(AcademicYearsService);
  });

  describe('create', () => {
    it('crée une année et génère ses périodes de notation', async () => {
      yearRepo.findOne.mockResolvedValueOnce(null).mockResolvedValue(year());

      await service.create({ label: '2026-2027' } as any, 'school-1');

      // Sans périodes, aucune évaluation n'est saisissable : les créer
      // d'office évite une année inutilisable jusqu'à ce qu'on y pense.
      expect(periodsService.generateForAcademicYear).toHaveBeenCalledWith(
        'year-1',
        'school-1',
      );
    });

    it('refuse un libellé déjà utilisé dans l’établissement', async () => {
      yearRepo.findOne.mockResolvedValue(year());

      await expect(
        service.create({ label: '2026-2027' } as any, 'school-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('n’active rien pour une année créée inactive', async () => {
      yearRepo.findOne.mockResolvedValueOnce(null).mockResolvedValue(year());

      await service.create(
        { label: '2026-2027', isActive: false } as any,
        'school-1',
      );
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('exige un établissement résolu', async () => {
      await expect(
        service.create({ label: '2026-2027' } as any, ''),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('unicité de l’année active', () => {
    it('désactive toutes les autres années dans une même transaction', async () => {
      yearRepo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValue(year({ isActive: true }));
      yearRepo.save.mockResolvedValue(year({ isActive: true }));

      await service.create(
        { label: '2026-2027', isActive: true } as any,
        'school-1',
      );

      // Deux années actives simultanément rendraient indéterminée la
      // résolution de l'année par défaut à l'inscription.
      expect(dataSource.transaction).toHaveBeenCalled();
      expect(manager.update).toHaveBeenNthCalledWith(
        1,
        AcademicYear,
        { schoolId: 'school-1' },
        { isActive: false },
      );
      expect(manager.update).toHaveBeenNthCalledWith(
        2,
        AcademicYear,
        { id: 'year-1', schoolId: 'school-1' },
        { isActive: true },
      );
    });

    it('bascule l’année active à la modification', async () => {
      yearRepo.findOne.mockResolvedValue(year({ isActive: false }));

      await service.update('year-1', { isActive: true } as any, 'school-1');
      expect(dataSource.transaction).toHaveBeenCalled();
    });

    it('ne rebascule pas une année déjà active', async () => {
      yearRepo.findOne.mockResolvedValue(year({ isActive: true }));

      await service.update('year-1', { isActive: true } as any, 'school-1');
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('clôture une année sans en activer d’autre', async () => {
      yearRepo.findOne.mockResolvedValue(year({ isActive: true }));

      await service.update('year-1', { isActive: false } as any, 'school-1');

      // Une école peut rester sans année active le temps d'en ouvrir une.
      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(yearRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ isActive: false }),
      );
    });
  });

  describe('update', () => {
    it('refuse un libellé déjà pris par une autre année', async () => {
      yearRepo.findOne
        .mockResolvedValueOnce(year())
        .mockResolvedValueOnce(year({ id: 'autre', label: '2025-2026' }));

      await expect(
        service.update('year-1', { label: '2025-2026' } as any, 'school-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('refuse une année d’un autre établissement', async () => {
      yearRepo.findOne.mockResolvedValue(null);

      await expect(
        service.update('year-x', {} as any, 'school-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('supprime une année sans inscription', async () => {
      const result = await service.remove('year-1', 'school-1');

      expect(yearRepo.remove).toHaveBeenCalled();
      expect(result.message).toContain('2026-2027');
    });

    it('refuse de supprimer une année portant des inscriptions', async () => {
      enrollmentRepo.count.mockResolvedValue(42);

      // Supprimer l'année effacerait la trace de ce qui a été facturé.
      await expect(service.remove('year-1', 'school-1')).rejects.toThrow(
        /42 inscription\(s\)/,
      );
      expect(yearRepo.remove).not.toHaveBeenCalled();
    });

    it('propose la clôture comme alternative', async () => {
      enrollmentRepo.count.mockResolvedValue(1);

      await expect(service.remove('year-1', 'school-1')).rejects.toThrow(
        /clôturer à la place/,
      );
    });
  });

  describe('lecture', () => {
    it('classe les années de la plus récente à la plus ancienne', async () => {
      await service.findAllBySchool('school-1');

      expect(yearRepo.find).toHaveBeenCalledWith({
        where: { schoolId: 'school-1' },
        order: { label: 'DESC' },
      });
    });

    it('permet au SUPER_ADMIN de voir toutes les écoles', async () => {
      await service.findAll();

      expect(yearRepo.find).toHaveBeenCalledWith({ order: { label: 'DESC' } });
    });
  });

  describe('clôture de l’année', () => {
    it('clôture aussi ses périodes de notation', async () => {
      await service.update('year-1', { isActive: false } as any, 'school-1');

      // Sans cela, un enseignant pouvait encore saisir des notes sur le
      // dernier trimestre d'une année terminée.
      expect(periodsService.closeAllOfYear).toHaveBeenCalledWith(
        'year-1',
        'school-1',
      );
    });

    it('ne rouvre pas les périodes en réactivant une année', async () => {
      await service.update('year-1', { isActive: true } as any, 'school-1');

      // Une période close l'a été pour une raison — la fin du trimestre — que
      // la réactivation de l'année ne remet pas en cause.
      expect(periodsService.closeAllOfYear).not.toHaveBeenCalled();
    });
  });
});
