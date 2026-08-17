import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ClassRoom } from '../classrooms/entities/classroom.entity';
import { Evaluation } from '../evaluations/entities/evaluation.entity';
import { ClassRoomSubject } from './entities/classroom-subject.entity';
import { Subject } from './entities/subject.entity';
import { SubjectsService } from './subjects.service';

describe('SubjectsService (matières et programme des classes)', () => {
  let service: SubjectsService;
  let repos: Record<string, any>;

  const subject = (overrides: any = {}) => ({
    id: 'subject-1',
    schoolId: 'school-1',
    name: 'Mathématiques',
    shortName: 'MATH',
    ...overrides,
  });

  const programEntry = (overrides: any = {}) => ({
    id: 'prog-1',
    schoolId: 'school-1',
    classRoomId: 'class-1',
    subjectId: 'subject-1',
    coefficient: 4,
    subject: subject(),
    classRoom: { id: 'class-1', name: '6ème A' },
    ...overrides,
  });

  beforeEach(async () => {
    repos = {
      subject: {
        find: jest.fn().mockResolvedValue([]),
        findOne: jest.fn().mockResolvedValue(null),
        create: jest.fn((d) => ({ ...d })),
        save: jest.fn((s) => Promise.resolve(s)),
        remove: jest.fn(),
      },
      program: {
        find: jest.fn().mockResolvedValue([]),
        findOne: jest.fn().mockResolvedValue(null),
        create: jest.fn((d) => ({ ...d })),
        save: jest.fn((e) => Promise.resolve({ ...e, id: 'prog-1' })),
        remove: jest.fn(),
      },
      classRoom: { findOne: jest.fn().mockResolvedValue({ id: 'class-1', name: '6ème A' }) },
      evaluation: { count: jest.fn().mockResolvedValue(0) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubjectsService,
        { provide: getRepositoryToken(Subject), useValue: repos.subject },
        { provide: getRepositoryToken(ClassRoomSubject), useValue: repos.program },
        { provide: getRepositoryToken(ClassRoom), useValue: repos.classRoom },
        { provide: getRepositoryToken(Evaluation), useValue: repos.evaluation },
      ],
    }).compile();

    service = module.get<SubjectsService>(SubjectsService);
  });

  describe('matières', () => {
    it('crée une matière', async () => {
      const created = await service.create(
        { name: 'Mathématiques', shortName: 'MATH' } as any,
        'school-1',
      );
      expect(created.name).toBe('Mathématiques');
    });

    it('supprime les espaces de bord du nom', async () => {
      const created = await service.create(
        { name: '  Anglais  ' } as any,
        'school-1',
      );
      expect(created.name).toBe('Anglais');
    });

    it('remplace une abréviation vide par null', async () => {
      const created = await service.create(
        { name: 'Anglais', shortName: '   ' } as any,
        'school-1',
      );
      expect(created.shortName).toBeNull();
    });

    it('refuse une matière déjà présente dans l’établissement', async () => {
      repos.subject.findOne.mockResolvedValue(subject());

      await expect(
        service.create({ name: 'Mathématiques' } as any, 'school-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('trie les matières par nom', async () => {
      await service.findAll('school-1');

      expect(repos.subject.find).toHaveBeenCalledWith({
        where: { schoolId: 'school-1' },
        order: { name: 'ASC' },
      });
    });

    it('refuse une matière d’un autre établissement', async () => {
      repos.subject.findOne.mockResolvedValue(null);

      await expect(
        service.findOneOfSchool('subject-x', 'school-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('exige un établissement résolu', async () => {
      await expect(service.findAll('')).rejects.toThrow(ForbiddenException);
      await expect(
        service.create({ name: 'X' } as any, ''),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('renommage', () => {
    it('renomme une matière', async () => {
      repos.subject.findOne
        .mockResolvedValueOnce(subject())
        .mockResolvedValueOnce(null);

      const saved = await service.update(
        'subject-1',
        { name: 'Maths' } as any,
        'school-1',
      );
      expect(saved.name).toBe('Maths');
    });

    it('refuse un nom déjà pris par une autre matière', async () => {
      repos.subject.findOne
        .mockResolvedValueOnce(subject())
        .mockResolvedValueOnce(subject({ id: 'autre', name: 'Anglais' }));

      await expect(
        service.update('subject-1', { name: 'Anglais' } as any, 'school-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('accepte de réenregistrer une matière sous son propre nom', async () => {
      repos.subject.findOne.mockResolvedValue(subject());

      // Le nom est inchangé : aucune recherche de collision n'a lieu.
      await expect(
        service.update(
          'subject-1',
          { name: 'Mathématiques' } as any,
          'school-1',
        ),
      ).resolves.toBeDefined();
    });
  });

  describe('suppression', () => {
    beforeEach(() => repos.subject.findOne.mockResolvedValue(subject()));

    it('supprime une matière sans évaluation', async () => {
      const result = await service.remove('subject-1', 'school-1');

      expect(repos.subject.remove).toHaveBeenCalled();
      expect(result.message).toContain('Mathématiques');
    });

    it('refuse de supprimer une matière portant des évaluations', async () => {
      repos.evaluation.count.mockResolvedValue(3);

      // Les notes déjà saisies seraient emportées avec la matière.
      await expect(service.remove('subject-1', 'school-1')).rejects.toThrow(
        /3 évaluation\(s\) y sont rattachées/,
      );
      expect(repos.subject.remove).not.toHaveBeenCalled();
    });
  });

  describe('programme d’une classe', () => {
    it('rattache une matière avec son coefficient', async () => {
      repos.subject.findOne.mockResolvedValue(subject());
      repos.program.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(programEntry());

      await expect(
        service.assignToClassRoom(
          'class-1',
          { subjectId: 'subject-1', coefficient: 4 } as any,
          'school-1',
        ),
      ).resolves.toMatchObject({ coefficient: 4 });
    });

    it('refuse une classe d’un autre établissement', async () => {
      repos.classRoom.findOne.mockResolvedValue(null);

      await expect(
        service.assignToClassRoom(
          'class-x',
          { subjectId: 'subject-1', coefficient: 4 } as any,
          'school-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('refuse une matière d’un autre établissement', async () => {
      repos.subject.findOne.mockResolvedValue(null);

      await expect(
        service.assignToClassRoom(
          'class-1',
          { subjectId: 'subject-etranger', coefficient: 4 } as any,
          'school-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('refuse une matière déjà au programme', async () => {
      repos.subject.findOne.mockResolvedValue(subject());
      repos.program.findOne.mockResolvedValue(programEntry());

      // Deux coefficients pour la même matière rendraient le bulletin
      // indéterminé.
      await expect(
        service.assignToClassRoom(
          'class-1',
          { subjectId: 'subject-1', coefficient: 4 } as any,
          'school-1',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('modifie un coefficient', async () => {
      repos.program.findOne.mockResolvedValue(programEntry());

      const saved = await service.updateCoefficient('prog-1', 6, 'school-1');
      expect(saved.coefficient).toBe(6);
    });

    it('refuse une entrée de programme inconnue', async () => {
      repos.program.findOne.mockResolvedValue(null);

      await expect(
        service.updateCoefficient('prog-x', 6, 'school-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('retire une matière du programme', async () => {
      repos.program.findOne.mockResolvedValue(programEntry());

      const result = await service.removeFromClassRoom('prog-1', 'school-1');
      expect(result.message).toContain('Mathématiques');
      expect(result.message).toContain('6ème A');
    });

    it('refuse de retirer une matière déjà évaluée dans cette classe', async () => {
      repos.program.findOne.mockResolvedValue(programEntry());
      repos.evaluation.count.mockResolvedValue(2);

      await expect(
        service.removeFromClassRoom('prog-1', 'school-1'),
      ).rejects.toThrow(/2 évaluation\(s\)/);
      expect(repos.program.remove).not.toHaveBeenCalled();
    });

    it('exige un établissement résolu', async () => {
      await expect(service.findClassRoomProgram('class-1', '')).rejects.toThrow(
        ForbiddenException,
      );
      await expect(service.removeFromClassRoom('prog-1', '')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});
