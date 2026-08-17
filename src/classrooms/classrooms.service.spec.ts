import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuditService } from '../audit/audit.service';
import { Enrollment } from '../enrollments/entities/enrollment.entity';
import { ClassRoom } from './entities/classroom.entity';
import { ClassRoomsService } from './classrooms.service';

describe('ClassRoomsService (classes et tarifs)', () => {
  let service: ClassRoomsService;
  let classRoomRepo: any;
  let enrollmentRepo: any;
  let audit: any;

  const classRoom = (overrides: any = {}) => ({
    id: 'class-1',
    schoolId: 'school-1',
    name: '6ème A',
    level: 'COLLEGE',
    tuitionFee: 100000,
    ...overrides,
  });

  beforeEach(async () => {
    classRoomRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(classRoom()),
      create: jest.fn((d) => ({ ...d })),
      save: jest.fn((c) => Promise.resolve(c)),
      remove: jest.fn(),
    };
    enrollmentRepo = { count: jest.fn().mockResolvedValue(0) };
    audit = { record: jest.fn(), diff: jest.fn().mockReturnValue(null) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClassRoomsService,
        { provide: getRepositoryToken(ClassRoom), useValue: classRoomRepo },
        { provide: getRepositoryToken(Enrollment), useValue: enrollmentRepo },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    service = module.get<ClassRoomsService>(ClassRoomsService);
  });

  describe('create', () => {
    it('crée une classe rattachée à l’établissement', async () => {
      const created = await service.create(
        { name: '6ème A', level: 'COLLEGE', tuitionFee: 100000 } as any,
        'school-1',
      );
      expect(created.schoolId).toBe('school-1');
    });

    it('journalise le tarif en FCFA lisible', async () => {
      await service.create(
        { name: '6ème A', level: 'COLLEGE', tuitionFee: 100000 } as any,
        'school-1',
      );

      expect(audit.record.mock.calls[0][0].summary).toContain('FCFA');
    });
  });

  describe('update', () => {
    it('modifie le tarif', async () => {
      const saved = await service.update(
        'class-1',
        { tuitionFee: 120000 } as any,
        'school-1',
      );
      expect(saved.tuitionFee).toBe(120000);
    });

    it('met le changement de tarif en avant dans le journal', async () => {
      audit.diff.mockReturnValue({
        tuitionFee: { before: 100000, after: 120000 },
      });

      await service.update('class-1', { tuitionFee: 120000 } as any, 'school-1');

      // C'est la modification qui engage de l'argent, et celle qu'on vient
      // chercher dans le journal.
      // `toLocaleString('fr-FR')` sépare les milliers par une espace
      // insécable : on normalise avant de comparer.
      const summary = audit.record.mock.calls[0][0].summary.replace(/\s/g, ' ');
      expect(summary).toContain('Tarif');
      expect(summary).toContain('100 000 FCFA');
      expect(summary).toContain('120 000 FCFA');
    });

    it('n’écrit aucune ligne de journal quand rien n’a changé', async () => {
      audit.diff.mockReturnValue(null);

      await service.update('class-1', {} as any, 'school-1');

      // Un journal qui consigne les enregistrements à blanc noie les vraies
      // modifications.
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('compare les tarifs en nombre malgré le type decimal', async () => {
      classRoomRepo.findOne.mockResolvedValue(classRoom({ tuitionFee: '100000' }));
      classRoomRepo.save.mockImplementation((c: any) =>
        Promise.resolve({ ...c, tuitionFee: '100000' }),
      );

      await service.update('class-1', {} as any, 'school-1');

      // PostgreSQL rend les `decimal` en chaîne : comparer sans convertir
      // signalerait un changement à chaque enregistrement.
      expect(audit.diff).toHaveBeenCalledWith(
        expect.objectContaining({ tuitionFee: 100000 }),
        expect.objectContaining({ tuitionFee: 100000 }),
      );
    });

    it('refuse une classe d’un autre établissement', async () => {
      classRoomRepo.findOne.mockResolvedValue(null);

      await expect(
        service.update('class-x', {} as any, 'school-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('exige un établissement résolu', async () => {
      await expect(
        service.update('class-1', {} as any, ''),
      ).rejects.toThrow(ForbiddenException);
      await expect(service.findAllBySchool('')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('remove', () => {
    it('supprime une classe sans inscription', async () => {
      const result = await service.remove('class-1', 'school-1');

      expect(classRoomRepo.remove).toHaveBeenCalled();
      expect(result.message).toContain('6ème A');
    });

    it('refuse de supprimer une classe portant des inscriptions', async () => {
      enrollmentRepo.count.mockResolvedValue(28);

      // Supprimer la classe effacerait la trace de ce qui a été facturé aux
      // familles ; la base le refuse déjà en ON DELETE RESTRICT.
      await expect(service.remove('class-1', 'school-1')).rejects.toThrow(
        /28 inscription\(s\)/,
      );
      expect(classRoomRepo.remove).not.toHaveBeenCalled();
    });

    it('suggère de renommer plutôt que de supprimer', async () => {
      enrollmentRepo.count.mockResolvedValue(1);

      await expect(service.remove('class-1', 'school-1')).rejects.toThrow(
        /modifier le nom ou le tarif/,
      );
    });
  });

  describe('lecture', () => {
    it('trie les classes par nom', async () => {
      await service.findAllBySchool('school-1');

      expect(classRoomRepo.find).toHaveBeenCalledWith({
        where: { schoolId: 'school-1' },
        order: { name: 'ASC' },
      });
    });

    it('signale une classe inconnue', async () => {
      classRoomRepo.findOne.mockResolvedValue(null);

      await expect(service.findOne('class-x')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
