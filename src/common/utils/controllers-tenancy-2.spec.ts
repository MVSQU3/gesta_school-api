import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AbsencesController } from '../../absences/absences.controller';
import { AbsencesService } from '../../absences/absences.service';
import { ClassRoomsController } from '../../classrooms/classrooms.controller';
import { ClassRoomsService } from '../../classrooms/classrooms.service';
import { EvaluationsController } from '../../evaluations/evaluations.controller';
import { EvaluationsService } from '../../evaluations/evaluations.service';
import { SchoolsController } from '../../schools/schools.controller';
import { SchoolsService } from '../../schools/schools.service';
import { UsersController } from '../../users/users.controller';
import { UsersService } from '../../users/users.service';
import { AuthUser } from '../decorators/current-user.decorator';
import { Role } from '../enums/role.enum';

const DIRECTOR = {
  id: 'dir-1',
  roles: [Role.DIRECTOR],
  schoolId: 'school-1',
  slug: 'CMB',
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
  slug: null,
} as unknown as AuthUser;

const serviceMock = (...methods: string[]) =>
  Object.fromEntries(
    methods.map((m) => [m, jest.fn().mockResolvedValue([])]),
  ) as Record<string, jest.Mock>;

const expectTenantScoped = async (
  call: (user: AuthUser, querySchoolId?: string) => Promise<unknown>,
  spy: jest.Mock,
) => {
  spy.mockClear();
  await call(DIRECTOR, 'school-voisine');
  expect(spy.mock.calls[0]).toContain('school-1');
  expect(spy.mock.calls[0]).not.toContain('school-voisine');

  spy.mockClear();
  await call(ADMIN, 'school-2');
  expect(spy.mock.calls[0]).toContain('school-2');

  await expect(call(ADMIN, undefined)).rejects.toThrow(ForbiddenException);
};

describe('UsersController (personnel)', () => {
  let controller: UsersController;
  let service: Record<string, jest.Mock>;

  beforeEach(async () => {
    service = serviceMock(
      'createStaff',
      'findAllBySchool',
      'update',
      'setActive',
      'resetPassword',
      'remove',
    );
    const module = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: service }],
    }).compile();
    controller = module.get(UsersController);
  });

  it('cantonne la création d’un compte', () =>
    expectTenantScoped(
      (u, s) => controller.createStaff({} as any, u, s),
      service.createStaff,
    ));

  it('cantonne la liste du personnel', () =>
    expectTenantScoped(
      (u, s) => controller.findAll(u, s),
      service.findAllBySchool,
    ));

  it('cantonne la modification', () =>
    expectTenantScoped(
      (u, s) => controller.update('u1', {} as any, u, s),
      service.update,
    ));

  it('cantonne l’activation', () =>
    expectTenantScoped(
      (u, s) => controller.setStatus('u1', { isActive: false } as any, u, s),
      service.setActive,
    ));

  it('cantonne la réinitialisation de mot de passe', () =>
    expectTenantScoped(
      (u, s) => controller.resetPassword('u1', {} as any, u, s),
      service.resetPassword,
    ));

  it('cantonne la suppression', () =>
    expectTenantScoped((u, s) => controller.remove('u1', u, s), service.remove));

  it('transmet l’auteur pour empêcher les actions sur soi-même', async () => {
    await controller.remove('u1', DIRECTOR);

    // Le service refuse qu'un directeur supprime son propre compte : encore
    // faut-il qu'il sache qui fait la demande.
    expect(service.remove.mock.calls[0]).toContain('dir-1');
  });
});

describe('AbsencesController (appel)', () => {
  let controller: AbsencesController;
  let service: Record<string, jest.Mock>;

  beforeEach(async () => {
    service = serviceMock(
      'record',
      'getRollCall',
      'findByClassRoomAndDate',
      'findByEnrollment',
      'update',
      'remove',
    );
    const module = await Test.createTestingModule({
      controllers: [AbsencesController],
      providers: [{ provide: AbsencesService, useValue: service }],
    }).compile();
    controller = module.get(AbsencesController);
  });

  it('cantonne l’enregistrement de l’appel', () =>
    expectTenantScoped(
      (u, s) => controller.record({} as any, u, s),
      service.record,
    ));

  it('cantonne la feuille d’appel', () =>
    expectTenantScoped(
      (u, s) => controller.getRollCall('c1', 'y1', '2026-10-05', u, s),
      service.getRollCall,
    ));

  it('cantonne la relecture par date', () =>
    expectTenantScoped(
      (u, s) => controller.findByDate('c1', 'y1', '2026-10-05', u, s),
      service.findByClassRoomAndDate,
    ));

  it('cantonne l’historique d’un élève', () =>
    expectTenantScoped(
      (u, s) => controller.findByEnrollment('e1', u, s),
      service.findByEnrollment,
    ));

  it('cantonne la justification', () =>
    expectTenantScoped(
      (u, s) => controller.update('a1', {} as any, u, s),
      service.update,
    ));

  it('cantonne la suppression', () =>
    expectTenantScoped((u, s) => controller.remove('a1', u, s), service.remove));

  it('transmet l’utilisateur, dont dépend le droit d’intervenir sur la classe', async () => {
    await controller.record({} as any, TEACHER);

    // Le service vérifie que l'enseignant intervient bien dans cette classe.
    expect(service.record.mock.calls[0]).toContain(TEACHER);
  });
});

describe('EvaluationsController (évaluations)', () => {
  let controller: EvaluationsController;
  let service: Record<string, jest.Mock>;

  beforeEach(async () => {
    service = serviceMock(
      'findAll',
      'create',
      'update',
      'remove',
      'getGradeSheet',
      'saveGrades',
    );
    const module = await Test.createTestingModule({
      controllers: [EvaluationsController],
      providers: [{ provide: EvaluationsService, useValue: service }],
    }).compile();
    controller = module.get(EvaluationsController);
  });

  it('cantonne la création', () =>
    expectTenantScoped(
      (u, s) => controller.create({} as any, u, s),
      service.create,
    ));

  it('cantonne la modification', () =>
    expectTenantScoped(
      (u, s) => controller.update('ev1', {} as any, u, s),
      service.update,
    ));

  it('cantonne la suppression', () =>
    expectTenantScoped(
      (u, s) => controller.remove('ev1', u, s),
      service.remove,
    ));

  it('cantonne la feuille de notes', () =>
    expectTenantScoped(
      (u, s) => controller.getGradeSheet('ev1', u, s),
      service.getGradeSheet,
    ));

  it('cantonne l’enregistrement des notes', () =>
    expectTenantScoped(
      (u, s) => controller.saveGrades('ev1', {} as any, u, s),
      service.saveGrades,
    ));

  it('transmet l’enseignant, dont dépend le droit de noter', async () => {
    await controller.saveGrades('ev1', {} as any, TEACHER);

    // Sans affectation, le service refuse la saisie.
    expect(service.saveGrades.mock.calls[0]).toContain(TEACHER);
  });
});

describe('ClassRoomsController (classes)', () => {
  let controller: ClassRoomsController;
  let service: Record<string, jest.Mock>;

  beforeEach(async () => {
    service = serviceMock(
      'create',
      'findAll',
      'findAllBySchool',
      'findOne',
      'update',
      'remove',
    );
    const module = await Test.createTestingModule({
      controllers: [ClassRoomsController],
      providers: [{ provide: ClassRoomsService, useValue: service }],
    }).compile();
    controller = module.get(ClassRoomsController);
  });

  it('crée toujours dans l’école du jeton', async () => {
    // Cette route n'accepte pas de `schoolId` en query, contrairement aux
    // autres : elle prend celui du jeton, sans échappatoire possible.
    await controller.create({} as any, DIRECTOR);
    expect(service.create).toHaveBeenCalledWith({}, 'school-1', DIRECTOR);
  });

  it('cantonne la modification', () =>
    expectTenantScoped(
      (u, s) => controller.update('c1', {} as any, u, s),
      service.update,
    ));

  it('cantonne la suppression', () =>
    expectTenantScoped((u, s) => controller.remove('c1', u, s), service.remove));

  it('cantonne la liste à l’école du directeur', async () => {
    await controller.findAll(DIRECTOR, 'school-voisine');
    expect(service.findAllBySchool).toHaveBeenCalledWith('school-1');
  });

  it('permet au SUPER_ADMIN de balayer toutes les écoles', async () => {
    await controller.findAll(ADMIN);
    expect(service.findAll).toHaveBeenCalled();
  });
});

describe('SchoolsController (établissements)', () => {
  let controller: SchoolsController;
  let service: Record<string, jest.Mock>;

  beforeEach(async () => {
    service = serviceMock('findAll', 'findOne', 'update', 'remove');
    const module = await Test.createTestingModule({
      controllers: [SchoolsController],
      providers: [{ provide: SchoolsService, useValue: service }],
    }).compile();
    controller = module.get(SchoolsController);
  });

  it('délègue la liste au service', async () => {
    await controller.findAll(ADMIN);
    expect(service.findAll).toHaveBeenCalled();
  });

  it('délègue la suppression au service', async () => {
    await controller.remove('school-1', ADMIN as any);
    // L'acteur accompagne la suppression : elle est journalisée.
    expect(service.remove).toHaveBeenCalledWith('school-1', ADMIN);
  });
});
