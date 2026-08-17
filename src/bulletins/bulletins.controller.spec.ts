import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AcademicYear } from '../academic-years/entities/academic-year.entity';
import { ClassRoom } from '../classrooms/entities/classroom.entity';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { Role } from '../common/enums/role.enum';
import { PdfService } from '../common/pdf/pdf.service';
import { Enrollment } from '../enrollments/entities/enrollment.entity';
import { School } from '../schools/entities/school.entity';
import { BulletinsController } from './bulletins.controller';
import { BulletinsService } from './bulletins.service';

describe('BulletinsController (bulletins et PDF)', () => {
  let controller: BulletinsController;
  let service: any;
  let pdf: any;
  let repos: Record<string, any>;
  let res: any;

  const DIRECTOR = {
    id: 'dir-1',
    roles: [Role.DIRECTOR],
    schoolId: 'school-1',
  } as AuthUser;
  const ADMIN = {
    id: 'admin-1',
    roles: [Role.SUPER_ADMIN],
    schoolId: null,
  } as unknown as AuthUser;

  const period = {
    id: 'period-1',
    label: '1er Trimestre',
    academicYearId: 'year-1',
  };

  /**
   * Bulletin complet : le générateur PDF lit toutes ces clés sans garde. Un
   * objet partiel ferait échouer le rendu plutôt que l'assertion, et masquerait
   * ce qu'on cherche à vérifier.
   */
  const bulletin = {
    enrollmentId: 'enr-1',
    studentId: 'st-1',
    lastName: 'Kone',
    firstName: 'Ama',
    subjects: [
      {
        subjectId: 's1',
        name: 'Mathématiques',
        shortName: 'MATH',
        coefficient: 4,
        average: 15,
        points: 60,
        evaluationCount: 2,
        classAverage: 12,
        classMin: 6,
        classMax: 18,
      },
    ],
    totalPoints: 60,
    totalCoefficients: 4,
    average: 15,
    rank: 3,
    classSize: 40,
    absences: { justified: 1, unjustified: 2 },
  };

  beforeEach(async () => {
    service = {
      getClassBulletins: jest
        .fn()
        .mockResolvedValue({ period, bulletins: [bulletin] }),
      getStudentBulletin: jest.fn().mockResolvedValue({ period, bulletin }),
    };
    pdf = { render: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4')) };
    repos = {
      school: {
        findOne: jest.fn().mockResolvedValue({ id: 'school-1', name: 'Collège CMB' }),
      },
      classRoom: {
        findOne: jest.fn().mockResolvedValue({ id: 'class-1', name: '6ème A' }),
      },
      year: {
        findOne: jest.fn().mockResolvedValue({ id: 'year-1', label: '2026-2027' }),
      },
      enrollment: {
        findOne: jest.fn().mockResolvedValue({ id: 'enr-1', classRoomId: 'class-1' }),
      },
    };
    res = { set: jest.fn(), end: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [BulletinsController],
      providers: [
        { provide: BulletinsService, useValue: service },
        { provide: PdfService, useValue: pdf },
        { provide: getRepositoryToken(School), useValue: repos.school },
        { provide: getRepositoryToken(ClassRoom), useValue: repos.classRoom },
        { provide: getRepositoryToken(AcademicYear), useValue: repos.year },
        { provide: getRepositoryToken(Enrollment), useValue: repos.enrollment },
      ],
    }).compile();

    controller = module.get<BulletinsController>(BulletinsController);
  });

  describe('cloisonnement', () => {
    it('ignore le schoolId en query pour un directeur', async () => {
      await controller.getClassBulletins(
        'class-1',
        'period-1',
        DIRECTOR,
        'school-voisine',
      );

      expect(service.getClassBulletins).toHaveBeenCalledWith(
        'school-1',
        'class-1',
        'period-1',
      );
    });

    it('laisse le SUPER_ADMIN désigner l’établissement', async () => {
      await controller.getClassBulletins('class-1', 'period-1', ADMIN, 'school-2');
      expect(service.getClassBulletins.mock.calls[0][0]).toBe('school-2');
    });

    it('refuse un SUPER_ADMIN sans établissement désigné', async () => {
      await expect(
        controller.getClassBulletins('class-1', 'period-1', ADMIN),
      ).rejects.toThrow(ForbiddenException);
    });

    it('applique la même règle au bulletin d’un élève', async () => {
      await controller.getStudentBulletin(
        'enr-1',
        'period-1',
        DIRECTOR,
        'school-voisine',
      );
      expect(service.getStudentBulletin.mock.calls[0][0]).toBe('school-1');
    });
  });

  describe('PDF de classe', () => {
    it('renvoie le PDF en affichage direct', async () => {
      await controller.classBulletinsPdf('class-1', 'period-1', DIRECTOR, res);

      expect(res.set).toHaveBeenCalledWith(
        expect.objectContaining({ 'Content-Type': 'application/pdf' }),
      );
      expect(res.end).toHaveBeenCalled();
    });

    it('nomme le fichier d’après la classe et la période', async () => {
      await controller.classBulletinsPdf('class-1', 'period-1', DIRECTOR, res);

      const disposition = res.set.mock.calls[0][0]['Content-Disposition'];
      // Les espaces sont remplacés : un nom de fichier avec espaces se coupe
      // dans certains navigateurs.
      expect(disposition).toContain('bulletins-6ème-A-1er-Trimestre.pdf');
    });

    it('déclare la taille du document', async () => {
      await controller.classBulletinsPdf('class-1', 'period-1', DIRECTOR, res);

      const length = res.set.mock.calls[0][0]['Content-Length'];
      expect(Number(length)).toBeGreaterThan(0);
    });

    it('se rabat sur « classe » quand la classe est introuvable', async () => {
      repos.classRoom.findOne.mockResolvedValue(null);

      await controller.classBulletinsPdf('class-x', 'period-1', DIRECTOR, res);
      expect(res.set.mock.calls[0][0]['Content-Disposition']).toContain(
        'bulletins-classe-',
      );
    });

    it('joint l’en-tête de l’établissement au document', async () => {
      await controller.classBulletinsPdf('class-1', 'period-1', DIRECTOR, res);

      expect(repos.school.findOne).toHaveBeenCalledWith({
        where: { id: 'school-1' },
      });
      expect(repos.year.findOne).toHaveBeenCalledWith({
        where: { id: 'year-1' },
      });
      expect(pdf.render).toHaveBeenCalled();
    });
  });

  describe('PDF d’un élève', () => {
    it('nomme le fichier d’après l’élève', async () => {
      await controller.studentBulletinPdf('enr-1', 'period-1', DIRECTOR, res);

      expect(res.set.mock.calls[0][0]['Content-Disposition']).toContain(
        'bulletin-Kone-Ama.pdf',
      );
    });

    it('retrouve la classe depuis le dossier de l’élève', async () => {
      await controller.studentBulletinPdf('enr-1', 'period-1', DIRECTOR, res);

      expect(repos.classRoom.findOne).toHaveBeenCalledWith({
        where: { id: 'class-1' },
      });
    });

    it('produit le document même si le dossier a disparu', async () => {
      repos.enrollment.findOne.mockResolvedValue(null);

      await controller.studentBulletinPdf('enr-1', 'period-1', DIRECTOR, res);

      // Sans classe, l'en-tête est incomplet mais le bulletin reste éditable.
      expect(repos.classRoom.findOne).not.toHaveBeenCalled();
      expect(res.end).toHaveBeenCalled();
    });

    it('cantonne le PDF à l’établissement du demandeur', async () => {
      await controller.studentBulletinPdf(
        'enr-1',
        'period-1',
        DIRECTOR,
        res,
        'school-voisine',
      );
      expect(service.getStudentBulletin.mock.calls[0][0]).toBe('school-1');
    });
  });
});
