import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuditService } from '../audit/audit.service';
import { Evaluation } from '../evaluations/entities/evaluation.entity';
import { PeriodSystem, School } from '../schools/entities/school.entity';
import { GradingPeriod } from './entities/grading-period.entity';
import { GradingPeriodsService } from './grading-periods.service';
import { Absence } from '../absences/entities/absence.entity';

describe('GradingPeriodsService (périodes de notation)', () => {
  let service: GradingPeriodsService;
  let periodRepo: any;
  let schoolRepo: any;
  let evaluationRepo: any;
  let audit: any;
  let absenceRepo: any;

  const period = (overrides: any = {}) => ({
    id: 'period-1',
    schoolId: 'school-1',
    academicYearId: 'year-1',
    label: '1er Trimestre',
    sequence: 1,
    startDate: '2026-09-01',
    endDate: '2026-12-20',
    isClosed: false,
    ...overrides,
  });

  beforeEach(async () => {
    periodRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(period()),
      create: jest.fn((d) => ({ ...d })),
      save: jest.fn((p) => Promise.resolve(p)),
      remove: jest.fn(),
    };
    schoolRepo = {
      findOne: jest.fn().mockResolvedValue({ periodSystem: PeriodSystem.TRIMESTER }),
    };
    evaluationRepo = { count: jest.fn().mockResolvedValue(0) };
    absenceRepo = { count: jest.fn().mockResolvedValue(0) };
    audit = { record: jest.fn(), diff: jest.fn().mockReturnValue(null) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GradingPeriodsService,
        { provide: getRepositoryToken(GradingPeriod), useValue: periodRepo },
        { provide: getRepositoryToken(School), useValue: schoolRepo },
        { provide: getRepositoryToken(Evaluation), useValue: evaluationRepo },
        { provide: AuditService, useValue: audit },
        { provide: getRepositoryToken(Absence), useValue: absenceRepo },
      ],
    }).compile();

    service = module.get<GradingPeriodsService>(GradingPeriodsService);
  });

  describe('génération à l’ouverture d’une année', () => {
    it('crée trois trimestres pour une école au trimestre', async () => {
      const created = await service.generateForAcademicYear('year-1', 'school-1');

      expect(created.map((p) => p.label)).toEqual([
        '1er Trimestre',
        '2e Trimestre',
        '3e Trimestre',
      ]);
    });

    it('crée deux semestres pour une école au semestre', async () => {
      schoolRepo.findOne.mockResolvedValue({
        periodSystem: PeriodSystem.SEMESTER,
      });

      // Certaines écoles ivoiriennes fonctionnent au semestre, d'autres au
      // trimestre : le découpage suit l'établissement.
      const created = await service.generateForAcademicYear('year-1', 'school-1');
      expect(created.map((p) => p.label)).toEqual([
        '1er Semestre',
        '2e Semestre',
      ]);
    });

    it('numérote les périodes dans l’ordre', async () => {
      const created = await service.generateForAcademicYear('year-1', 'school-1');
      expect(created.map((p) => p.sequence)).toEqual([1, 2, 3]);
    });

    it('est idempotente : ne recrée rien si des périodes existent', async () => {
      const existing = [period()];
      periodRepo.find.mockResolvedValue(existing);

      await expect(
        service.generateForAcademicYear('year-1', 'school-1'),
      ).resolves.toBe(existing);
      expect(periodRepo.save).not.toHaveBeenCalled();
    });

    it('se rabat sur le trimestre pour une école sans découpage déclaré', async () => {
      schoolRepo.findOne.mockResolvedValue(null);

      const created = await service.generateForAcademicYear('year-1', 'school-1');
      expect(created).toHaveLength(3);
    });
  });

  describe('update', () => {
    it('ne recopie que les champs réellement fournis', async () => {
      const saved = await service.update(
        'period-1',
        { isClosed: true } as any,
        'school-1',
      );

      // `Object.assign` écrasait les autres champs avec `undefined` : l'écran
      // de gestion affichait une ligne vide après chaque clôture.
      expect(saved.label).toBe('1er Trimestre');
      expect(saved.startDate).toBe('2026-09-01');
      expect(saved.isClosed).toBe(true);
    });

    it('met la clôture en avant dans le journal', async () => {
      audit.diff.mockReturnValue({ isClosed: { before: false, after: true } });
      periodRepo.save.mockResolvedValue(period({ isClosed: true }));

      await service.update('period-1', { isClosed: true } as any, 'school-1');

      // C'est elle qui fige les bulletins et interdit toute saisie ultérieure.
      expect(audit.record.mock.calls[0][0].summary).toContain('cloturee');
    });

    it('signale aussi une réouverture', async () => {
      audit.diff.mockReturnValue({ isClosed: { before: true, after: false } });
      periodRepo.save.mockResolvedValue(period({ isClosed: false }));

      await service.update('period-1', { isClosed: false } as any, 'school-1');
      expect(audit.record.mock.calls[0][0].summary).toContain('rouverte');
    });

    it('n’écrit aucune ligne de journal quand rien n’a changé', async () => {
      audit.diff.mockReturnValue(null);

      await service.update('period-1', {} as any, 'school-1');
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('refuse une période d’un autre établissement', async () => {
      periodRepo.findOne.mockResolvedValue(null);

      await expect(
        service.update('period-x', {} as any, 'school-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('supprime une période sans évaluation', async () => {
      const result = await service.remove('period-1', 'school-1');

      expect(periodRepo.remove).toHaveBeenCalled();
      expect(result.message).toContain('1er Trimestre');
    });

    it('refuse de supprimer une période portant des évaluations', async () => {
      evaluationRepo.count.mockResolvedValue(5);

      // Les notes déjà saisies seraient emportées avec la période.
      await expect(service.remove('period-1', 'school-1')).rejects.toThrow(
        ConflictException,
      );
      expect(periodRepo.remove).not.toHaveBeenCalled();
    });
  });

  describe('lecture', () => {
    it('classe les périodes dans l’ordre de l’année', async () => {
      await service.findAllByYear('school-1', 'year-1');

      expect(periodRepo.find).toHaveBeenCalledWith({
        where: { schoolId: 'school-1', academicYearId: 'year-1' },
        order: { sequence: 'ASC' },
      });
    });

    it('exige un établissement résolu', async () => {
      await expect(service.findAllByYear('', 'year-1')).rejects.toThrow(
        ForbiddenException,
      );
      await expect(service.findOneOfSchool('period-1', '')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
  describe('regenerateForAcademicYear', () => {
    it('recrée les périodes quand l’année est vierge', async () => {
      // 1er appel : les périodes à supprimer. 2e appel, depuis
      // `generateForAcademicYear` : la table est vide, il peut recréer.
      periodRepo.find
        .mockResolvedValueOnce([{ id: 'p-1' }])
        .mockResolvedValue([]);
      schoolRepo.findOne.mockResolvedValue({
        periodSystem: PeriodSystem.SEMESTER,
      });

      await service.regenerateForAcademicYear('year-1', 'school-1');

      expect(periodRepo.remove).toHaveBeenCalled();
      // Deux semestres après la bascule, et non trois trimestres.
      expect(periodRepo.save).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ label: '1er Semestre' }),
          expect.objectContaining({ label: '2e Semestre' }),
        ]),
      );
    });

    it('refuse dès qu’une évaluation est rattachée', async () => {
      periodRepo.find.mockResolvedValue([{ id: 'p-1' }]);
      evaluationRepo.count.mockResolvedValue(4);

      // Supprimer une période emporterait en cascade les notes qui en dépendent.
      await expect(
        service.regenerateForAcademicYear('year-1', 'school-1'),
      ).rejects.toThrow(/déjà entamée/);
      expect(periodRepo.remove).not.toHaveBeenCalled();
    });

    it('refuse dès qu’une absence est rattachée', async () => {
      periodRepo.find.mockResolvedValue([{ id: 'p-1' }]);
      absenceRepo.count.mockResolvedValue(2);

      await expect(
        service.regenerateForAcademicYear('year-1', 'school-1'),
      ).rejects.toThrow(/déjà entamée/);
      expect(periodRepo.remove).not.toHaveBeenCalled();
    });

    it('exige un établissement résolu', async () => {
      await expect(
        service.regenerateForAcademicYear('year-1', ''),
      ).rejects.toThrow(ForbiddenException);
    });
  });

});
