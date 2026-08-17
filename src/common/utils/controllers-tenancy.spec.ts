import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AcademicYearsController } from '../../academic-years/academic-years.controller';
import { AcademicYearsService } from '../../academic-years/academic-years.service';
import { GradingPeriodsController } from '../../grading-periods/grading-periods.controller';
import { GradingPeriodsService } from '../../grading-periods/grading-periods.service';
import { SubjectsController } from '../../subjects/subjects.controller';
import { SubjectsService } from '../../subjects/subjects.service';
import { TeachingController } from '../../teaching/teaching.controller';
import { TeachingService } from '../../teaching/teaching.service';
import { TransfersController } from '../../transfers/transfers.controller';
import { TransfersService } from '../../transfers/transfers.service';
import { AuthUser } from '../decorators/current-user.decorator';
import { Role } from '../enums/role.enum';

/**
 * Ces contrôleurs délèguent tous à `resolveSchoolId`. Ce qui doit être vérifié
 * route par route n'est pas la logique — elle est testée avec les services —
 * mais que **chaque** route passe bien par la résolution : une seule qui
 * prendrait le `schoolId` de la requête ouvrirait les données d'une école au
 * personnel d'une autre.
 */
const DIRECTOR = {
  id: 'dir-1',
  roles: [Role.DIRECTOR],
  schoolId: 'school-1',
  slug: 'CMB',
} as AuthUser;

const ADMIN = {
  id: 'admin-1',
  roles: [Role.SUPER_ADMIN],
  schoolId: null,
  slug: null,
} as unknown as AuthUser;

/** Mock où chaque méthode nommée renvoie une valeur neutre. */
const serviceMock = (...methods: string[]) =>
  Object.fromEntries(
    methods.map((m) => [m, jest.fn().mockResolvedValue([])]),
  ) as Record<string, jest.Mock>;

/**
 * Vérifie qu'une route ignore le `schoolId` de la requête pour un directeur,
 * l'honore pour un SUPER_ADMIN, et refuse ce dernier s'il n'en désigne aucun.
 */
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

describe('SubjectsController (matières)', () => {
  let controller: SubjectsController;
  let service: Record<string, jest.Mock>;

  beforeEach(async () => {
    service = serviceMock(
      'findAll',
      'create',
      'update',
      'remove',
      'findClassRoomProgram',
      'assignToClassRoom',
      'updateCoefficient',
      'removeFromClassRoom',
    );
    const module = await Test.createTestingModule({
      controllers: [SubjectsController],
      providers: [{ provide: SubjectsService, useValue: service }],
    }).compile();
    controller = module.get(SubjectsController);
  });

  it('cantonne la liste des matières', () =>
    expectTenantScoped((u, s) => controller.findAll(u, s), service.findAll));

  it('cantonne la création', () =>
    expectTenantScoped(
      (u, s) => controller.create({} as any, u, s),
      service.create,
    ));

  it('cantonne la modification', () =>
    expectTenantScoped(
      (u, s) => controller.update('s1', {} as any, u, s),
      service.update,
    ));

  it('cantonne la suppression', () =>
    expectTenantScoped((u, s) => controller.remove('s1', u, s), service.remove));

  it('cantonne le programme d’une classe', () =>
    expectTenantScoped(
      (u, s) => controller.findProgram('c1', u, s),
      service.findClassRoomProgram,
    ));

  it('cantonne le rattachement d’une matière', () =>
    expectTenantScoped(
      (u, s) => controller.assign('c1', {} as any, u, s),
      service.assignToClassRoom,
    ));

  it('cantonne la modification d’un coefficient', () =>
    expectTenantScoped(
      (u, s) => controller.updateCoefficient('p1', { coefficient: 4 } as any, u, s),
      service.updateCoefficient,
    ));

  it('cantonne le retrait du programme', () =>
    expectTenantScoped(
      (u, s) => controller.removeFromProgram('p1', u, s),
      service.removeFromClassRoom,
    ));
});

describe('TransfersController (transfert de dossier)', () => {
  let controller: TransfersController;
  let service: Record<string, jest.Mock>;

  beforeEach(async () => {
    service = serviceMock(
      'searchAcrossSchools',
      'create',
      'findOutgoing',
      'findIncoming',
      'approve',
      'reject',
      'revoke',
      'getSharedFile',
    );
    const module = await Test.createTestingModule({
      controllers: [TransfersController],
      providers: [{ provide: TransfersService, useValue: service }],
    }).compile();
    controller = module.get(TransfersController);
  });

  it('cantonne la recherche inter-écoles à l’école demandeuse', () =>
    expectTenantScoped(
      (u, s) => controller.search(u, {} as any, s),
      service.searchAcrossSchools,
    ));

  it('cantonne l’émission d’une demande', () =>
    expectTenantScoped(
      (u, s) => controller.create(u, {} as any, s),
      service.create,
    ));

  it('cantonne les demandes émises', () =>
    expectTenantScoped(
      (u, s) => controller.outgoing(u, s),
      service.findOutgoing,
    ));

  it('cantonne les demandes reçues', () =>
    expectTenantScoped(
      (u, s) => controller.incoming(u, s),
      service.findIncoming,
    ));

  it('cantonne l’acceptation', () =>
    expectTenantScoped(
      (u, s) => controller.approve('r1', u, {} as any, s),
      service.approve,
    ));

  it('cantonne le refus', () =>
    expectTenantScoped(
      (u, s) => controller.reject('r1', u, {} as any, s),
      service.reject,
    ));

  it('cantonne la révocation', () =>
    expectTenantScoped(
      (u, s) => controller.revoke('r1', u, {} as any, s),
      service.revoke,
    ));

  it('cantonne la lecture du dossier partagé', () =>
    expectTenantScoped(
      (u, s) => controller.file('r1', u, s),
      service.getSharedFile,
    ));

  it('transmet l’identifiant de l’auteur de la demande', async () => {
    await controller.create(DIRECTOR, {} as any);
    expect(service.create).toHaveBeenCalledWith('school-1', 'dir-1', {});
  });

  it('transmet le motif facultatif d’une révocation', async () => {
    await controller.revoke('r1', DIRECTOR, { reason: 'Demande du parent' });
    expect(service.revoke).toHaveBeenCalledWith(
      'r1',
      'school-1',
      'dir-1',
      'Demande du parent',
    );
  });

  it('tolère une révocation sans corps de requête', async () => {
    await controller.revoke('r1', DIRECTOR, undefined as any);
    expect(service.revoke).toHaveBeenCalledWith(
      'r1',
      'school-1',
      'dir-1',
      undefined,
    );
  });
});

describe('TeachingController (affectations)', () => {
  let controller: TeachingController;
  let service: Record<string, jest.Mock>;

  beforeEach(async () => {
    service = serviceMock('findAll', 'create', 'remove');
    const module = await Test.createTestingModule({
      controllers: [TeachingController],
      providers: [{ provide: TeachingService, useValue: service }],
    }).compile();
    controller = module.get(TeachingController);
  });

  it('cantonne la création', () =>
    expectTenantScoped(
      (u, s) => controller.create({} as any, u, s),
      service.create,
    ));

  it('cantonne le retrait', () =>
    expectTenantScoped((u, s) => controller.remove('a1', u, s), service.remove));

  it('transmet les filtres de recherche', async () => {
    await controller.findAll(DIRECTOR, 'teach-1', 'class-1', 'year-1');

    expect(service.findAll).toHaveBeenCalledWith('school-1', {
      teacherId: 'teach-1',
      classRoomId: 'class-1',
      academicYearId: 'year-1',
    });
  });
});

describe('GradingPeriodsController (périodes de notation)', () => {
  let controller: GradingPeriodsController;
  let service: Record<string, jest.Mock>;

  beforeEach(async () => {
    service = serviceMock('findAllByYear', 'update', 'remove');
    const module = await Test.createTestingModule({
      controllers: [GradingPeriodsController],
      providers: [{ provide: GradingPeriodsService, useValue: service }],
    }).compile();
    controller = module.get(GradingPeriodsController);
  });

  it('cantonne la liste des périodes', () =>
    expectTenantScoped(
      (u, s) => controller.findAll('year-1', u, s),
      service.findAllByYear,
    ));

  it('cantonne la modification', () =>
    expectTenantScoped(
      (u, s) => controller.update('p1', {} as any, u, s),
      service.update,
    ));

  it('cantonne la suppression', () =>
    expectTenantScoped((u, s) => controller.remove('p1', u, s), service.remove));
});

describe('AcademicYearsController (années scolaires)', () => {
  let controller: AcademicYearsController;
  let service: Record<string, jest.Mock>;

  beforeEach(async () => {
    service = serviceMock('findAll', 'findAllBySchool', 'create', 'update', 'remove');
    const module = await Test.createTestingModule({
      controllers: [AcademicYearsController],
      providers: [{ provide: AcademicYearsService, useValue: service }],
    }).compile();
    controller = module.get(AcademicYearsController);
  });

  it('cantonne la création', () =>
    expectTenantScoped(
      (u, s) => controller.create({} as any, u, s),
      service.create,
    ));

  it('cantonne la modification', () =>
    expectTenantScoped(
      (u, s) => controller.update('y1', {} as any, u, s),
      service.update,
    ));

  it('cantonne la suppression', () =>
    expectTenantScoped((u, s) => controller.remove('y1', u, s), service.remove));

  it('cantonne la liste à l’école du directeur', async () => {
    await controller.findAll(DIRECTOR, 'school-voisine');
    expect(service.findAllBySchool).toHaveBeenCalledWith('school-1');
  });

  it('permet au SUPER_ADMIN de balayer toutes les écoles', async () => {
    await controller.findAll(ADMIN);
    expect(service.findAll).toHaveBeenCalled();
  });
});
