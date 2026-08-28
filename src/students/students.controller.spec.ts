import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { Role } from '../common/enums/role.enum';
import { StudentHistoryService } from './student-history.service';
import { StudentsController } from './students.controller';
import { StudentsService } from './students.service';

describe('StudentsController (fiches élèves)', () => {
  let controller: StudentsController;
  let students: any;
  let history: any;

  const SECRETARY = {
    id: 'sec-1',
    roles: [Role.SECRETARY],
    schoolId: 'school-1',
  } as AuthUser;
  const ADMIN = {
    id: 'admin-1',
    roles: [Role.SUPER_ADMIN],
    schoolId: null,
  } as unknown as AuthUser;

  beforeEach(async () => {
    students = {
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      search: jest.fn().mockResolvedValue([]),
      findAllBySchool: jest.fn().mockResolvedValue([]),
      findOneBySchool: jest.fn().mockResolvedValue({}),
    };
    history = { getHistory: jest.fn().mockResolvedValue({}) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [StudentsController],
      providers: [
        { provide: StudentsService, useValue: students },
        { provide: StudentHistoryService, useValue: history },
      ],
    }).compile();

    controller = module.get<StudentsController>(StudentsController);
  });

  describe('cloisonnement', () => {
    it('ignore le schoolId en query à la création', async () => {
      await controller.create({} as any, SECRETARY, 'school-voisine');
      expect(students.create).toHaveBeenCalledWith({}, 'school-1');
    });

    it('ignore le schoolId en query à la correction', async () => {
      await controller.update('st-1', {} as any, SECRETARY, 'school-voisine');
      expect(students.update).toHaveBeenCalledWith(
        'st-1',
        {},
        'school-1',
        SECRETARY,
      );
    });

    it('ignore le schoolId en query à la recherche', async () => {
      await controller.search('Kone', SECRETARY, 'school-voisine');
      expect(students.search).toHaveBeenCalledWith('school-1', 'Kone');
    });

    it('laisse le SUPER_ADMIN désigner l’établissement', async () => {
      await controller.create({} as any, ADMIN, 'school-2');
      expect(students.create).toHaveBeenCalledWith({}, 'school-2');
    });

    it('refuse un SUPER_ADMIN sans établissement désigné', () => {
      // Ces routes ne sont pas `async` : elles lèvent de façon synchrone.
      expect(() => controller.create({} as any, ADMIN)).toThrow(
        ForbiddenException,
      );
      expect(() => controller.search('Kone', ADMIN)).toThrow(ForbiddenException);
      expect(() => controller.history('st-1', ADMIN)).toThrow(
        ForbiddenException,
      );
    });
  });

  describe('dossier élève', () => {
    it('charge l’année active par défaut', async () => {
      await controller.history('st-1', SECRETARY);

      // Sans paramètre d'année, c'est au serveur de retenir l'année active.
      expect(history.getHistory).toHaveBeenCalledWith(
        'st-1',
        'school-1',
        undefined,
      );
    });

    it('transmet l’année demandée', async () => {
      await controller.history('st-1', SECRETARY, 'year-past');
      expect(history.getHistory).toHaveBeenCalledWith(
        'st-1',
        'school-1',
        'year-past',
      );
    });

    it('ignore le schoolId en query', async () => {
      await controller.history('st-1', SECRETARY, undefined, 'school-voisine');
      expect(history.getHistory.mock.calls[0][1]).toBe('school-1');
    });
  });

  describe('recherche', () => {
    it('transmet une chaîne vide plutôt qu’undefined', async () => {
      await controller.search(undefined as any, SECRETARY);

      // Le service attend une chaîne : `undefined.trim()` échouerait.
      expect(students.search).toHaveBeenCalledWith('school-1', '');
    });
  });

  describe('lecture directe', () => {
    it('utilise toujours l’école du jeton', async () => {
      const pagination = { page: 1, limit: 25 };
      await controller.findAll(pagination, SECRETARY, 'year-1');
      expect(students.findAllBySchool).toHaveBeenCalledWith(
        'school-1',
        'year-1',
        pagination,
      );

      await controller.findOneBySchool('st-1', SECRETARY);
      expect(students.findOneBySchool).toHaveBeenCalledWith(
        'st-1',
        'school-1',
        undefined,
      );
    });
  });
});
