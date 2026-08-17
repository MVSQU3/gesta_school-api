import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AcademicYear } from '../academic-years/entities/academic-year.entity';
import { TeachingAssignment } from '../teaching/entities/teaching-assignment.entity';
import { ScheduleEntry } from './entities/schedule-entry.entity';
import { TimeSlot } from './entities/time-slot.entity';
import { ScheduleService } from './schedule.service';

/** Erreur telle que la remonte le pilote PostgreSQL sur violation d'unicité. */
const uniqueViolation = () => Object.assign(new Error('duplicate'), { code: '23505' });

describe('ScheduleService (emploi du temps)', () => {
  let service: ScheduleService;
  let repos: Record<string, any>;

  /**
   * Fabriques et non constantes : le service modifie l'objet qu'il reçoit
   * (`Object.assign(slot, dto)`). Un objet partagé entre les tests garderait
   * la mutation du précédent.
   */
  const slot = () => ({
    id: 'slot-1',
    schoolId: 'school-1',
    label: '1ère heure',
    startTime: '07:30:00',
    endTime: '08:25:00',
    sequence: 1,
    isBreak: false,
  });

  const breakSlot = () => ({
    ...slot(),
    id: 'slot-rec',
    label: 'Récréation',
    isBreak: true,
  });

  const ASSIGNMENT = {
    id: 'assign-1',
    schoolId: 'school-1',
    academicYearId: 'year-1',
    classRoomId: 'class-1',
    teacherId: 'teacher-1',
  };

  const YEAR = { id: 'year-1', schoolId: 'school-1', label: '2026-2027', isActive: true };

  beforeEach(async () => {
    repos = {
      slot: {
        find: jest.fn().mockResolvedValue([]),
        findOne: jest.fn(),
        save: jest.fn((s) => Promise.resolve(s)),
        create: jest.fn((d) => ({ ...d })),
        remove: jest.fn(),
      },
      entry: {
        find: jest.fn().mockResolvedValue([]),
        findOne: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        save: jest.fn((e) => Promise.resolve(e)),
        create: jest.fn((d) => ({ ...d })),
        remove: jest.fn(),
        createQueryBuilder: jest.fn(),
      },
      assignment: { find: jest.fn().mockResolvedValue([]), findOne: jest.fn() },
      year: { findOne: jest.fn().mockResolvedValue(YEAR) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScheduleService,
        { provide: getRepositoryToken(TimeSlot), useValue: repos.slot },
        { provide: getRepositoryToken(ScheduleEntry), useValue: repos.entry },
        { provide: getRepositoryToken(TeachingAssignment), useValue: repos.assignment },
        { provide: getRepositoryToken(AcademicYear), useValue: repos.year },
      ],
    }).compile();

    service = module.get<ScheduleService>(ScheduleService);
  });

  describe('grille horaire', () => {
    const newSlot = (startTime: string, endTime: string, sequence = 9) => ({
      label: 'Test',
      startTime,
      endTime,
      sequence,
    });

    it('crée un créneau valide', async () => {
      const created = await service.createSlot('school-1', newSlot('07:30', '08:25'));
      expect(created.label).toBe('Test');
    });

    it('normalise les heures en HH:MM:SS à l’écriture', async () => {
      const created = await service.createSlot('school-1', newSlot('07:30', '08:25'));

      // La saisie envoie HH:MM, PostgreSQL rend HH:MM:SS. Mélanger les deux
      // formes fait passer « 08:25 » pour antérieur à « 08:25:00 ».
      expect(created.startTime).toBe('07:30:00');
      expect(created.endTime).toBe('08:25:00');
    });

    it('accepte un créneau qui commence là où le précédent finit', async () => {
      repos.slot.find.mockResolvedValue([slot()]);

      // Le cas qui a réellement cassé : contiguïté n'est pas chevauchement.
      await expect(
        service.createSlot('school-1', newSlot('08:25', '09:20')),
      ).resolves.toBeDefined();
    });

    it('refuse un créneau qui en chevauche un autre', async () => {
      repos.slot.find.mockResolvedValue([slot()]);

      await expect(
        service.createSlot('school-1', newSlot('08:00', '08:45')),
      ).rejects.toThrow(ConflictException);
    });

    it('refuse un créneau entièrement contenu dans un autre', async () => {
      repos.slot.find.mockResolvedValue([slot()]);

      await expect(
        service.createSlot('school-1', newSlot('07:45', '08:00')),
      ).rejects.toThrow(ConflictException);
    });

    it('refuse une heure de fin antérieure au début', async () => {
      await expect(
        service.createSlot('school-1', newSlot('11:00', '10:00')),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuse un créneau de durée nulle', async () => {
      await expect(
        service.createSlot('school-1', newSlot('10:00', '10:00')),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuse deux créneaux au même rang', async () => {
      repos.slot.findOne.mockResolvedValue(slot());

      await expect(
        service.createSlot('school-1', newSlot('11:00', '11:55', 1)),
      ).rejects.toThrow(ConflictException);
    });

    it('s’exclut lui-même du contrôle de chevauchement en modification', async () => {
      repos.slot.findOne.mockResolvedValue(slot());
      repos.slot.find.mockResolvedValue([]);

      await service.updateSlot('slot-1', 'school-1', { label: 'Renommée' });

      // Sans l'exclusion, un créneau se déclarerait en conflit avec lui-même.
      expect(repos.slot.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ schoolId: 'school-1' }) }),
      );
    });

    it('refuse de transformer en pause un créneau occupé', async () => {
      repos.slot.findOne.mockResolvedValue(slot());
      repos.entry.count.mockResolvedValue(3);

      // Sinon la grille afficherait des cours pendant la récréation.
      await expect(
        service.updateSlot('slot-1', 'school-1', { isBreak: true }),
      ).rejects.toThrow(ConflictException);
    });

    it('accepte de transformer en pause un créneau libre', async () => {
      repos.slot.findOne.mockResolvedValue(slot());
      repos.entry.count.mockResolvedValue(0);

      await expect(
        service.updateSlot('slot-1', 'school-1', { isBreak: true }),
      ).resolves.toBeDefined();
    });

    it('refuse de supprimer un créneau occupé', async () => {
      repos.slot.findOne.mockResolvedValue(slot());
      repos.entry.count.mockResolvedValue(2);

      // La cascade en base viderait silencieusement une colonne d'emploi du temps.
      await expect(service.removeSlot('slot-1', 'school-1')).rejects.toThrow(
        ConflictException,
      );
      expect(repos.slot.remove).not.toHaveBeenCalled();
    });

    it('supprime un créneau libre', async () => {
      repos.slot.findOne.mockResolvedValue(slot());
      repos.entry.count.mockResolvedValue(0);

      await service.removeSlot('slot-1', 'school-1');
      expect(repos.slot.remove).toHaveBeenCalledWith(slot());
    });

    it('refuse un créneau d’un autre établissement', async () => {
      repos.slot.findOne.mockResolvedValue(null);

      await expect(service.removeSlot('slot-x', 'school-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('liste les créneaux par rang croissant', async () => {
      await service.findSlots('school-1');

      expect(repos.slot.find).toHaveBeenCalledWith({
        where: { schoolId: 'school-1' },
        order: { sequence: 'ASC' },
      });
    });
  });

  describe('pose d’une séance', () => {
    beforeEach(() => {
      repos.assignment.findOne.mockResolvedValue(ASSIGNMENT);
      repos.slot.findOne.mockResolvedValue(slot());
    });

    it('recopie année, classe et enseignant depuis l’affectation', async () => {
      const entry = await service.createEntry('school-1', {
        teachingAssignmentId: 'assign-1',
        dayOfWeek: 1,
        timeSlotId: 'slot-1',
      });

      // Rien ne vient de la requête : c'est ce qui interdit de programmer un
      // enseignant sur une matière ou une classe qui ne sont pas les siennes.
      expect(entry.academicYearId).toBe('year-1');
      expect(entry.classRoomId).toBe('class-1');
      expect(entry.teacherId).toBe('teacher-1');
    });

    it('refuse une affectation inconnue', async () => {
      repos.assignment.findOne.mockResolvedValue(null);

      await expect(
        service.createEntry('school-1', {
          teachingAssignmentId: 'inconnue',
          dayOfWeek: 1,
          timeSlotId: 'slot-1',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('refuse un créneau inconnu', async () => {
      repos.slot.findOne.mockResolvedValue(null);

      await expect(
        service.createEntry('school-1', {
          teachingAssignmentId: 'assign-1',
          dayOfWeek: 1,
          timeSlotId: 'inconnu',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('refuse de placer un cours pendant une pause', async () => {
      repos.slot.findOne.mockResolvedValue(breakSlot());

      await expect(
        service.createEntry('school-1', {
          teachingAssignmentId: 'assign-1',
          dayOfWeek: 1,
          timeSlotId: 'slot-rec',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('conflits', () => {
    beforeEach(() => {
      repos.assignment.findOne.mockResolvedValue(ASSIGNMENT);
      repos.slot.findOne.mockResolvedValue(slot());
      repos.entry.save.mockRejectedValue(uniqueViolation());
    });

    it('nomme la classe et la matière déjà en place', async () => {
      repos.entry.findOne.mockResolvedValue({
        classRoomId: 'class-1',
        classRoom: { name: '6ème A' },
        teachingAssignment: { subject: { name: 'Mathématiques' } },
      });

      await expect(
        service.createEntry('school-1', {
          teachingAssignmentId: 'assign-1',
          dayOfWeek: 1,
          timeSlotId: 'slot-1',
        }),
      ).rejects.toThrow(/6ème A.*Mathématiques/);
    });

    it('signale un enseignant déjà occupé ailleurs', async () => {
      repos.entry.findOne.mockResolvedValue({
        classRoomId: 'class-2',
        classRoom: { name: '6ème B' },
        teachingAssignment: { subject: { name: 'Mathématiques' } },
      });

      await expect(
        service.createEntry('school-1', {
          teachingAssignmentId: 'assign-1',
          dayOfWeek: 1,
          timeSlotId: 'slot-1',
        }),
      ).rejects.toThrow(/enseignant est déjà en cours avec la 6ème B/);
    });

    it('reste explicite même si la séance en conflit est introuvable', async () => {
      repos.entry.findOne.mockResolvedValue(null);

      await expect(
        service.createEntry('school-1', {
          teachingAssignmentId: 'assign-1',
          dayOfWeek: 1,
          timeSlotId: 'slot-1',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('laisse remonter une erreur qui n’est pas un conflit d’unicité', async () => {
      repos.entry.save.mockRejectedValue(new Error('connexion perdue'));

      // Masquer une panne de base derrière « créneau occupé » enverrait le
      // directeur chercher un conflit qui n'existe pas.
      await expect(
        service.createEntry('school-1', {
          teachingAssignmentId: 'assign-1',
          dayOfWeek: 1,
          timeSlotId: 'slot-1',
        }),
      ).rejects.toThrow('connexion perdue');
    });
  });

  describe('déplacement et retrait', () => {
    it('déplace une séance vers un autre jour', async () => {
      repos.entry.findOne.mockResolvedValue({
        id: 'entry-1',
        academicYearId: 'year-1',
        dayOfWeek: 1,
        timeSlotId: 'slot-1',
        teachingAssignment: ASSIGNMENT,
      });
      repos.slot.findOne.mockResolvedValue(slot());

      const moved = await service.moveEntry('entry-1', 'school-1', {
        dayOfWeek: 3,
        timeSlotId: 'slot-2',
      });
      expect(moved.dayOfWeek).toBe(3);
      expect(moved.timeSlotId).toBe('slot-2');
    });

    it('refuse un déplacement vers une pause', async () => {
      repos.entry.findOne.mockResolvedValue({
        id: 'entry-1',
        teachingAssignment: ASSIGNMENT,
      });
      repos.slot.findOne.mockResolvedValue(breakSlot());

      await expect(
        service.moveEntry('entry-1', 'school-1', {
          dayOfWeek: 3,
          timeSlotId: 'slot-rec',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuse un déplacement vers une case occupée', async () => {
      repos.entry.findOne
        .mockResolvedValueOnce({
          id: 'entry-1',
          academicYearId: 'year-1',
          teachingAssignment: ASSIGNMENT,
        })
        .mockResolvedValueOnce({
          classRoomId: 'class-1',
          classRoom: { name: '6ème A' },
          teachingAssignment: { subject: { name: 'Anglais' } },
        });
      repos.slot.findOne.mockResolvedValue(slot());
      repos.entry.save.mockRejectedValue(uniqueViolation());

      await expect(
        service.moveEntry('entry-1', 'school-1', {
          dayOfWeek: 2,
          timeSlotId: 'slot-1',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('refuse une séance d’un autre établissement', async () => {
      repos.entry.findOne.mockResolvedValue(null);

      await expect(service.removeEntry('entry-x', 'school-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('retire une séance', async () => {
      const entry = { id: 'entry-1' };
      repos.entry.findOne.mockResolvedValue(entry);

      await service.removeEntry('entry-1', 'school-1');
      expect(repos.entry.remove).toHaveBeenCalledWith(entry);
    });
  });

  describe('consultation', () => {
    const CELL = {
      id: 'entry-1',
      dayOfWeek: 1,
      timeSlotId: 'slot-1',
      teachingAssignmentId: 'assign-1',
      teachingAssignment: {
        subject: { id: 's1', name: 'Mathématiques', shortName: 'MATH' },
      },
      teacher: { id: 'teacher-1', email: 'kone@ecole.ci' },
      classRoom: { id: 'class-1', name: '6ème A' },
    };

    it('retient l’année active par défaut', async () => {
      await service.getClassSchedule('school-1', 'class-1');

      expect(repos.year.findOne).toHaveBeenCalledWith({
        where: { schoolId: 'school-1', isActive: true },
      });
    });

    it('retient l’année demandée quand elle est fournie', async () => {
      await service.getClassSchedule('school-1', 'class-1', 'year-2');

      expect(repos.year.findOne).toHaveBeenCalledWith({
        where: { id: 'year-2', schoolId: 'school-1' },
      });
    });

    it('explique l’absence d’année active plutôt que d’échouer sèchement', async () => {
      repos.year.findOne.mockResolvedValue(null);

      await expect(
        service.getClassSchedule('school-1', 'class-1'),
      ).rejects.toThrow(/Activez une année/);
    });

    it('signale une année demandée inconnue', async () => {
      repos.year.findOne.mockResolvedValue(null);

      await expect(
        service.getClassSchedule('school-1', 'class-1', 'year-x'),
      ).rejects.toThrow(NotFoundException);
    });

    it('aplatit chaque séance en matière, enseignant et classe', async () => {
      repos.entry.find.mockResolvedValue([CELL]);

      const grid = await service.getClassSchedule('school-1', 'class-1');
      expect(grid.entries[0]).toEqual({
        id: 'entry-1',
        dayOfWeek: 1,
        timeSlotId: 'slot-1',
        subject: { id: 's1', name: 'Mathématiques', shortName: 'MATH' },
        teacher: { id: 'teacher-1', email: 'kone@ecole.ci' },
        classRoom: { id: 'class-1', name: '6ème A' },
        teachingAssignmentId: 'assign-1',
      });
    });

    it('filtre la grille d’un enseignant sur lui seul', async () => {
      await service.getTeacherSchedule('school-1', 'teacher-1');

      expect(repos.entry.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ teacherId: 'teacher-1' }),
        }),
      );
    });
  });

  describe('palette de saisie', () => {
    it('compte les séances déjà posées par affectation', async () => {
      repos.assignment.find.mockResolvedValue([
        {
          id: 'assign-1',
          subject: { id: 's1', name: 'Maths', shortName: 'M' },
          teacher: { id: 't1', email: 'kone@ecole.ci' },
          classRoom: { id: 'class-1', name: '6ème A' },
        },
        {
          id: 'assign-2',
          subject: { id: 's2', name: 'Anglais', shortName: 'A' },
          teacher: { id: 't2', email: 'diallo@ecole.ci' },
          classRoom: { id: 'class-1', name: '6ème A' },
        },
      ]);
      repos.entry.createQueryBuilder.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest
          .fn()
          .mockResolvedValue([{ assignmentId: 'assign-1', total: '4' }]),
      });

      const palette = await service.getClassAssignments('school-1', 'class-1');
      expect(palette[0].scheduledCount).toBe(4);
      // Une affectation jamais posée doit apparaître à zéro, pas disparaître.
      expect(palette[1].scheduledCount).toBe(0);
    });
  });
});
