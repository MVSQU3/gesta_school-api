import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Role } from '../common/enums/role.enum';
import { User } from '../users/entities/user.entity';
import { TeachingAssignment } from './entities/teaching-assignment.entity';
import { TeachingService } from './teaching.service';

/**
 * L'affectation est le pivot du module de notation : c'est elle qui autorise
 * un enseignant à créer une évaluation et à saisir des notes. C'est aussi elle
 * que l'emploi du temps place dans la grille.
 */
describe('TeachingService (affectations des enseignants)', () => {
  let service: TeachingService;
  let assignmentRepo: any;
  let userRepo: any;

  const ASSIGNMENT = {
    id: 'assign-1',
    schoolId: 'school-1',
    teacher: { email: 'kone@ecole.ci' },
    subject: { name: 'Mathématiques' },
    classRoom: { name: '6ème A' },
  };

  const dto = {
    teacherId: 'teacher-1',
    classRoomId: 'class-1',
    subjectId: 'subject-1',
    academicYearId: 'year-1',
  };

  const teacher = (roles: Role[] = [Role.TEACHER]) => ({
    id: 'teacher-1',
    email: 'kone@ecole.ci',
    schoolId: 'school-1',
    roles,
  });

  beforeEach(async () => {
    assignmentRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(ASSIGNMENT),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn((d) => ({ ...d })),
      save: jest.fn((a) => Promise.resolve({ ...a, id: 'assign-1' })),
      remove: jest.fn(),
    };
    userRepo = { findOne: jest.fn().mockResolvedValue(teacher()) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TeachingService,
        {
          provide: getRepositoryToken(TeachingAssignment),
          useValue: assignmentRepo,
        },
        { provide: getRepositoryToken(User), useValue: userRepo },
      ],
    }).compile();

    service = module.get<TeachingService>(TeachingService);
  });

  describe('create', () => {
    it('crée une affectation valide', async () => {
      assignmentRepo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(ASSIGNMENT);

      await expect(service.create(dto as any, 'school-1')).resolves.toBeDefined();
    });

    it('refuse un employé d’un autre établissement', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(service.create(dto as any, 'school-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('refuse un employé sans le rôle Enseignant', async () => {
      userRepo.findOne.mockResolvedValue(teacher([Role.SECRETARY]));

      // Sans ce contrôle, un secrétaire affecté à une classe pourrait saisir
      // des notes, l'affectation étant le seul droit vérifié en aval.
      await expect(service.create(dto as any, 'school-1')).rejects.toThrow(
        /rôle Enseignant/,
      );
    });

    it('refuse une affectation en double', async () => {
      assignmentRepo.findOne.mockResolvedValue(ASSIGNMENT);

      await expect(service.create(dto as any, 'school-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('exige un établissement résolu', async () => {
      await expect(service.create(dto as any, '')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('findAll', () => {
    it('retire les filtres non renseignés', async () => {
      await service.findAll('school-1', {
        teacherId: undefined,
        classRoomId: 'class-1',
      });

      // TypeORM rejette une valeur `undefined` dans un `where` au lieu de
      // l'ignorer : la requête échouerait.
      expect(assignmentRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { schoolId: 'school-1', classRoomId: 'class-1' },
        }),
      );
    });

    it('n’applique aucun filtre quand aucun n’est fourni', async () => {
      await service.findAll('school-1');

      expect(assignmentRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { schoolId: 'school-1' } }),
      );
    });

    it('exige un établissement résolu', async () => {
      await expect(service.findAll('')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('isAssigned', () => {
    it('confirme une affectation existante', async () => {
      assignmentRepo.count.mockResolvedValue(1);

      await expect(
        service.isAssigned('teacher-1', 'class-1', 'subject-1', 'year-1'),
      ).resolves.toBe(true);
    });

    it('refuse quand aucune affectation ne correspond', async () => {
      assignmentRepo.count.mockResolvedValue(0);

      await expect(
        service.isAssigned('teacher-1', 'class-1', 'subject-1', 'year-1'),
      ).resolves.toBe(false);
    });

    it('exige les quatre critères simultanément', async () => {
      await service.isAssigned('teacher-1', 'class-1', 'subject-1', 'year-1');

      // Une affectation vaut pour une matière, une classe et une année
      // précises : l'enseignant de maths en 6ème A ne note pas l'anglais.
      expect(assignmentRepo.count).toHaveBeenCalledWith({
        where: {
          teacherId: 'teacher-1',
          classRoomId: 'class-1',
          subjectId: 'subject-1',
          academicYearId: 'year-1',
        },
      });
    });
  });

  describe('remove', () => {
    it('retire une affectation et le dit lisiblement', async () => {
      const result = await service.remove('assign-1', 'school-1');

      expect(assignmentRepo.remove).toHaveBeenCalledWith(ASSIGNMENT);
      expect(result.message).toBe(
        "kone@ecole.ci n'enseigne plus Mathématiques en 6ème A.",
      );
    });

    it('refuse une affectation d’un autre établissement', async () => {
      assignmentRepo.findOne.mockResolvedValue(null);

      await expect(service.remove('assign-x', 'school-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
