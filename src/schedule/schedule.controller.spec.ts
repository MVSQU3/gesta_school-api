import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { Role } from '../common/enums/role.enum';
import { ScheduleController } from './schedule.controller';
import { ScheduleService } from './schedule.service';

describe('ScheduleController (emploi du temps)', () => {
  let controller: ScheduleController;
  let service: any;

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
  const ADMIN = {
    id: 'admin-1',
    roles: [Role.SUPER_ADMIN],
    schoolId: null,
  } as unknown as AuthUser;

  beforeEach(async () => {
    service = {
      findSlots: jest.fn().mockResolvedValue([]),
      createSlot: jest.fn().mockResolvedValue({}),
      updateSlot: jest.fn().mockResolvedValue({}),
      removeSlot: jest.fn().mockResolvedValue(undefined),
      getClassSchedule: jest.fn().mockResolvedValue({}),
      getTeacherSchedule: jest.fn().mockResolvedValue({}),
      getClassAssignments: jest.fn().mockResolvedValue([]),
      createEntry: jest.fn().mockResolvedValue({}),
      moveEntry: jest.fn().mockResolvedValue({}),
      removeEntry: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ScheduleController],
      providers: [{ provide: ScheduleService, useValue: service }],
    }).compile();

    controller = module.get<ScheduleController>(ScheduleController);
  });

  describe('cloisonnement', () => {
    it.each([
      ['findSlots', () => controller.findSlots(DIRECTOR, 'x')],
      ['createSlot', () => controller.createSlot(DIRECTOR, {} as any, 'x')],
      ['updateSlot', () => controller.updateSlot('s1', DIRECTOR, {} as any, 'x')],
      ['removeSlot', () => controller.removeSlot('s1', DIRECTOR, 'x')],
      ['createEntry', () => controller.createEntry(DIRECTOR, {} as any, 'x')],
      ['moveEntry', () => controller.moveEntry('e1', DIRECTOR, {} as any, 'x')],
      ['removeEntry', () => controller.removeEntry('e1', DIRECTOR, 'x')],
    ])('ignore le schoolId en query sur %s', async (method, call) => {
      await call();

      const args = service[method].mock.calls[0];
      expect(args).toContain('school-1');
      expect(args).not.toContain('x');
    });

    it('laisse le SUPER_ADMIN désigner l’établissement', async () => {
      await controller.findSlots(ADMIN, 'school-2');
      expect(service.findSlots).toHaveBeenCalledWith('school-2');
    });

    it('refuse un SUPER_ADMIN sans établissement désigné', async () => {
      await expect(controller.findSlots(ADMIN)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('consultation', () => {
    it('sert à l’enseignant son propre emploi du temps', async () => {
      await controller.mine(TEACHER);

      // L'identifiant vient du jeton : un enseignant ne peut pas demander la
      // grille d'un collègue par cette route.
      expect(service.getTeacherSchedule).toHaveBeenCalledWith(
        'school-1',
        'teach-1',
        undefined,
      );
    });

    it('transmet l’année demandée', async () => {
      await controller.mine(TEACHER, 'year-past');
      expect(service.getTeacherSchedule.mock.calls[0][2]).toBe('year-past');
    });

    it('permet à la direction de consulter la grille d’un enseignant', async () => {
      await controller.teacherSchedule('teach-9', DIRECTOR);
      expect(service.getTeacherSchedule).toHaveBeenCalledWith(
        'school-1',
        'teach-9',
        undefined,
      );
    });

    it('charge la grille d’une classe', async () => {
      await controller.classSchedule('class-1', DIRECTOR, 'year-1');
      expect(service.getClassSchedule).toHaveBeenCalledWith(
        'school-1',
        'class-1',
        'year-1',
      );
    });

    it('charge la palette d’affectations d’une classe', async () => {
      await controller.classAssignments('class-1', DIRECTOR);
      expect(service.getClassAssignments).toHaveBeenCalledWith(
        'school-1',
        'class-1',
        undefined,
      );
    });
  });

  describe('confirmations', () => {
    it('confirme la suppression d’un créneau', async () => {
      await expect(controller.removeSlot('s1', DIRECTOR)).resolves.toEqual({
        message: 'Créneau supprimé.',
      });
    });

    it('confirme le retrait d’une séance', async () => {
      const result = await controller.removeEntry('e1', DIRECTOR);
      expect(result.message).toContain('retirée');
    });
  });
});
