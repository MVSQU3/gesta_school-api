import {
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AcademicYear } from '../academic-years/entities/academic-year.entity';
import { AuditService } from '../audit/audit.service';
import { Student } from './entities/student.entity';
import { StudentsService } from './students.service';

describe('StudentsService (fiches élèves)', () => {
  let service: StudentsService;
  let studentRepo: any;
  let yearRepo: any;
  let audit: any;
  let queryBuilder: any;

  const student = (overrides: any = {}) => ({
    id: 'student-1',
    schoolId: 'school-1',
    firstName: 'Ama',
    lastName: 'Kone',
    birthDay: new Date(2011, 2, 5),
    parentPhone: '+2250700000001',
    ...overrides,
  });

  beforeEach(async () => {
    queryBuilder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      // La liste est paginée : `skip`/`take` puis `getManyAndCount`.
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(null),
      getMany: jest.fn().mockResolvedValue([]),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    };

    studentRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((d) => ({ ...d })),
      save: jest.fn((s) => Promise.resolve(s)),
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    };
    yearRepo = { findOne: jest.fn() };
    audit = { record: jest.fn(), diff: jest.fn().mockReturnValue(null) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StudentsService,
        { provide: getRepositoryToken(Student), useValue: studentRepo },
        { provide: getRepositoryToken(AcademicYear), useValue: yearRepo },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    service = module.get<StudentsService>(StudentsService);
  });

  describe('création', () => {
    const dto = (overrides: any = {}) => ({
      firstName: 'Ama',
      lastName: 'Kone',
      birthDay: '05-03-2011',
      parentPhone: '+2250700000001',
      ...overrides,
    });

    it('convertit la date locale JJ-MM-AAAA', async () => {
      const created = await service.create(dto() as any, 'school-1');

      // Un 05-03 lu comme un 3 mai décalerait toutes les dates de naissance.
      expect(created.birthDay.getFullYear()).toBe(2011);
      expect(created.birthDay.getMonth()).toBe(2);
      expect(created.birthDay.getDate()).toBe(5);
    });

    it('accepte aussi le séparateur slash', async () => {
      const created = await service.create(
        dto({ birthDay: '05/03/2011' }) as any,
        'school-1',
      );
      expect(created.birthDay.getDate()).toBe(5);
    });

    it('supprime les espaces de bord du nom', async () => {
      const created = await service.create(
        dto({ firstName: '  Ama ', lastName: ' Kone  ' }) as any,
        'school-1',
      );
      expect(created.firstName).toBe('Ama');
      expect(created.lastName).toBe('Kone');
    });

    it('rattache la fiche à l’établissement résolu', async () => {
      const created = await service.create(dto() as any, 'school-1');
      expect(created.schoolId).toBe('school-1');
    });

    it('refuse sans établissement résolu', async () => {
      await expect(service.create(dto() as any, '')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('recherche de doublon', () => {
    it('compare sans tenir compte de la casse ni des espaces', async () => {
      await service.findDuplicate('school-1', '  AMA ', 'Kone', '05-03-2011');

      const clauses = queryBuilder.andWhere.mock.calls;
      expect(clauses[0][0]).toContain('LOWER(TRIM(');
      expect(clauses[0][1]).toEqual({ firstName: 'ama' });
    });

    it('reste cantonnée à l’établissement', async () => {
      await service.findDuplicate('school-1', 'Ama', 'Kone', '05-03-2011');

      expect(queryBuilder.where).toHaveBeenCalledWith(
        'student.schoolId = :schoolId',
        { schoolId: 'school-1' },
      );
    });
  });

  describe('recherche libre', () => {
    it('n’interroge pas la base en deçà de 2 caractères', async () => {
      await expect(service.search('school-1', 'a')).resolves.toEqual([]);
      expect(studentRepo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('ignore une requête vide ou faite d’espaces', async () => {
      await expect(service.search('school-1', '   ')).resolves.toEqual([]);
      await expect(service.search('school-1', '')).resolves.toEqual([]);
    });

    it('cherche sur nom, prénom et téléphone du parent', async () => {
      await service.search('school-1', 'Kone');

      const [sql, params] = queryBuilder.andWhere.mock.calls[0];
      expect(sql).toContain('firstName');
      expect(sql).toContain('lastName');
      expect(sql).toContain('parentPhone');
      expect(params).toEqual({ term: '%kone%' });
    });

    it('borne le nombre de résultats', async () => {
      await service.search('school-1', 'Kone');
      expect(queryBuilder.limit).toHaveBeenCalledWith(20);
    });

    it('refuse sans établissement résolu', async () => {
      await expect(service.search('', 'Kone')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('correction d’une fiche', () => {
    beforeEach(() => studentRepo.findOne.mockResolvedValue(student()));

    it('refuse un élève d’un autre établissement', async () => {
      studentRepo.findOne.mockResolvedValue(null);

      await expect(
        service.update('student-x', {} as any, 'school-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('corrige l’orthographe du nom', async () => {
      const saved = await service.update(
        'student-1',
        { lastName: 'Koné' } as any,
        'school-1',
      );
      expect(saved.lastName).toBe('Koné');
    });

    it('ne contrôle pas les doublons quand seul le téléphone change', async () => {
      await service.update(
        'student-1',
        { parentPhone: '+2250700000099' } as any,
        'school-1',
      );

      // L'identité n'a pas bougé : inutile d'aller chercher un homonyme.
      expect(studentRepo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('refuse une correction qui créerait un homonyme exact', async () => {
      queryBuilder.getOne.mockResolvedValue(student({ id: 'autre' }));

      await expect(
        service.update('student-1', { firstName: 'Yao' } as any, 'school-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('s’exclut lui-même de la recherche d’homonyme', async () => {
      await service.update('student-1', { firstName: 'Yao' } as any, 'school-1');

      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'student.id != :studentId',
        { studentId: 'student-1' },
      );
    });

    it('ne modifie jamais l’établissement de rattachement', async () => {
      const saved = await service.update(
        'student-1',
        { schoolId: 'school-2' } as any,
        'school-1',
      );

      // Déplacer la fiche emporterait ses inscriptions, notes et absences hors
      // du cloisonnement de l'école d'origine.
      expect(saved.schoolId).toBe('school-1');
    });

    it('journalise l’état d’avant correction', async () => {
      audit.diff.mockReturnValue({
        lastName: { before: 'Kone', after: 'Koné' },
      });

      await service.update('student-1', { lastName: 'Koné' } as any, 'school-1');

      expect(audit.diff).toHaveBeenCalledWith(
        expect.objectContaining({ lastName: 'Kone', firstName: 'Ama' }),
        expect.anything(),
      );
      expect(audit.record).toHaveBeenCalled();
    });

    it('ne journalise rien quand rien n’a changé', async () => {
      audit.diff.mockReturnValue(null);

      await service.update('student-1', {} as any, 'school-1');
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('refuse sans établissement résolu', async () => {
      await expect(
        service.update('student-1', {} as any, ''),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('lecture', () => {
    it('exige l’appartenance à l’établissement', async () => {
      await service.findOneOfSchool('student-1', 'school-1');

      expect(studentRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'student-1', schoolId: 'school-1' },
        }),
      );
    });

    it('refuse sans établissement résolu', async () => {
      await expect(service.findOneOfSchool('student-1', '')).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(service.findAllBySchool('')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });
});
