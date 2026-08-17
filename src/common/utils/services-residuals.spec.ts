import { ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AcademicYear } from '../../academic-years/entities/academic-year.entity';
import { AuditService } from '../../audit/audit.service';
import { Enrollment } from '../../enrollments/entities/enrollment.entity';
import { Evaluation } from '../../evaluations/entities/evaluation.entity';
import { EvaluationsService } from '../../evaluations/evaluations.service';
import { Grade } from '../../evaluations/entities/grade.entity';
import { GradingPeriod } from '../../grading-periods/entities/grading-period.entity';
import { Student } from '../../students/entities/student.entity';
import { StudentsService } from '../../students/students.service';
import { ClassRoomSubject } from '../../subjects/entities/classroom-subject.entity';
import { TeachingService } from '../../teaching/teaching.service';
import { AuthUser } from '../decorators/current-user.decorator';
import { Role } from '../enums/role.enum';

/**
 * Derniers chemins non couverts : la liste filtrée des évaluations, dont la
 * restriction propre aux enseignants, et la lecture des élèves d'une année.
 */
describe('EvaluationsService (liste filtrée)', () => {
  let service: EvaluationsService;
  let qb: any;

  const DIRECTOR = { id: 'dir-1', roles: [Role.DIRECTOR] } as AuthUser;
  const TEACHER = { id: 'teach-1', roles: [Role.TEACHER] } as AuthUser;

  beforeEach(async () => {
    qb = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };

    const module = await Test.createTestingModule({
      providers: [
        EvaluationsService,
        {
          provide: getRepositoryToken(Evaluation),
          useValue: {
            createQueryBuilder: jest.fn().mockReturnValue(qb),
            findOne: jest.fn().mockResolvedValue(null),
          },
        },
        { provide: getRepositoryToken(Grade), useValue: {} },
        { provide: getRepositoryToken(GradingPeriod), useValue: {} },
        { provide: getRepositoryToken(ClassRoomSubject), useValue: {} },
        { provide: getRepositoryToken(Enrollment), useValue: {} },
        { provide: TeachingService, useValue: {} },
      ],
    }).compile();

    service = module.get(EvaluationsService);
  });

  it('exige un établissement résolu', async () => {
    await expect(service.findAll('', {}, DIRECTOR)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('cloisonne la liste par établissement', async () => {
    await service.findAll('school-1', {}, DIRECTOR);

    expect(qb.where).toHaveBeenCalledWith('evaluation.schoolId = :schoolId', {
      schoolId: 'school-1',
    });
  });

  it('n’applique aucun filtre superflu pour la direction', async () => {
    await service.findAll('school-1', {}, DIRECTOR);
    expect(qb.andWhere).not.toHaveBeenCalled();
  });

  it('applique les filtres classe, matière et période', async () => {
    await service.findAll(
      'school-1',
      { classRoomId: 'c1', subjectId: 's1', gradingPeriodId: 'p1' },
      DIRECTOR,
    );

    expect(qb.andWhere).toHaveBeenCalledTimes(3);
  });

  it('restreint un enseignant à ses propres affectations', async () => {
    await service.findAll('school-1', {}, TEACHER);

    const clause = qb.andWhere.mock.calls[0][0];
    expect(clause).toContain('teaching_assignments');
    // Les alias sont quotés : sans guillemets, PostgreSQL les replie en
    // minuscules et ne retrouve plus « gradingPeriod ».
    expect(clause).toContain('"gradingPeriod"."academicYearId"');
    expect(qb.andWhere.mock.calls[0][1]).toEqual({ teacherId: 'teach-1' });
  });

  it('ne restreint ni le secrétariat ni la direction', async () => {
    await service.findAll(
      'school-1',
      {},
      { id: 'sec-1', roles: [Role.SECRETARY] } as AuthUser,
    );

    expect(qb.andWhere).not.toHaveBeenCalled();
  });

  it('refuse une évaluation d’un autre établissement', async () => {
    await expect(service.findOneOfSchool('ev-1', '')).rejects.toThrow(
      ForbiddenException,
    );
  });
});

describe('StudentsService (élèves d’une année)', () => {
  let service: StudentsService;
  let studentRepo: any;
  let yearRepo: any;
  let qb: any;

  beforeEach(async () => {
    qb = {
      innerJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(null),
      getMany: jest.fn().mockResolvedValue([]),
    };
    studentRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      createQueryBuilder: jest.fn().mockReturnValue(qb),
    };
    yearRepo = {
      findOne: jest.fn().mockResolvedValue({ id: 'year-active' }),
    };

    const module = await Test.createTestingModule({
      providers: [
        StudentsService,
        { provide: getRepositoryToken(Student), useValue: studentRepo },
        { provide: getRepositoryToken(AcademicYear), useValue: yearRepo },
        {
          provide: AuditService,
          useValue: { record: jest.fn(), diff: jest.fn().mockReturnValue(null) },
        },
      ],
    }).compile();

    service = module.get(StudentsService);
  });

  it('retient l’année active par défaut', async () => {
    await service.findAllBySchool('school-1');

    expect(yearRepo.findOne).toHaveBeenCalledWith({
      where: { schoolId: 'school-1', isActive: true },
    });
    expect(qb.innerJoin.mock.calls[0][3]).toEqual({
      schoolId: 'school-1',
      resolvedYearId: 'year-active',
    });
  });

  it('retient l’année demandée sans interroger l’année active', async () => {
    await service.findAllBySchool('school-1', 'year-past');

    expect(yearRepo.findOne).not.toHaveBeenCalled();
    expect(qb.innerJoin.mock.calls[0][3].resolvedYearId).toBe('year-past');
  });

  it('explique l’absence d’année active plutôt que d’échouer sèchement', async () => {
    yearRepo.findOne.mockResolvedValue(null);

    await expect(service.findAllBySchool('school-1')).rejects.toThrow(
      /Aucune année scolaire active/,
    );
  });

  it('ne liste que les élèves effectivement inscrits cette année-là', async () => {
    await service.findAllBySchool('school-1');

    // La jointure sur les inscriptions est ce qui distingue « les élèves de
    // l'école » de « les élèves inscrits cette année ».
    const [relation, alias, condition] = qb.innerJoin.mock.calls[0];
    expect(relation).toBe('student.enrollments');
    expect(alias).toBe('enrollment');
    expect(condition).toContain('enrollment.academicYearId');
  });

  it('refuse un établissement vide ou absent', async () => {
    await expect(service.findAllBySchool('   ')).rejects.toThrow(
      UnauthorizedException,
    );
    await expect(
      service.findAllBySchool(undefined as unknown as string),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('refuse un identifiant d’élève vide', async () => {
    await expect(service.findOneBySchool('  ', 'school-1')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('signale un élève non inscrit sur l’année demandée', async () => {
    qb.getOne.mockResolvedValue(null);

    await expect(
      service.findOneBySchool('st-1', 'school-1', 'year-1'),
    ).rejects.toThrow(NotFoundException);
  });
});
