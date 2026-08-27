import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { School } from './entities/school.entity';
import { SchoolsService } from './schools.service';
import { AuditService } from '../audit/audit.service';

describe('SchoolsService (établissements)', () => {
  let service: SchoolsService;
  let schoolRepo: any;

  const school = (overrides: any = {}) => ({
    id: 'school-1',
    name: 'Collège Moderne de Bingerville',
    slug: 'CMB',
    ...overrides,
  });

  beforeEach(async () => {
    schoolRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(school()),
      save: jest.fn((s) => Promise.resolve(s)),
      remove: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SchoolsService,
        { provide: getRepositoryToken(School), useValue: schoolRepo },
        { provide: AuditService, useValue: { record: jest.fn() } },
      ],
    }).compile();

    service = module.get<SchoolsService>(SchoolsService);
  });

  it('trie les établissements par nom', async () => {
    await service.findAll();
    expect(schoolRepo.find).toHaveBeenCalledWith({ order: { name: 'ASC' } });
  });

  it('signale un établissement inconnu', async () => {
    schoolRepo.findOne.mockResolvedValue(null);

    await expect(service.findOne('school-x')).rejects.toThrow(NotFoundException);
  });

  describe('update', () => {
    it('force le code établissement en majuscules', async () => {
      schoolRepo.findOne
        .mockResolvedValueOnce(school())
        .mockResolvedValueOnce(null);

      // Le slug sert à la connexion : « cmb » et « CMB » doivent désigner la
      // même école, pas deux.
      const saved = await service.update('school-1', { slug: 'lyc' } as any);
      expect(saved.slug).toBe('LYC');
    });

    it('refuse un code déjà utilisé par un autre établissement', async () => {
      schoolRepo.findOne
        .mockResolvedValueOnce(school())
        .mockResolvedValueOnce(school({ id: 'autre', slug: 'LYC' }));

      await expect(
        service.update('school-1', { slug: 'LYC' } as any),
      ).rejects.toThrow(ConflictException);
    });

    it('ne cherche pas de collision quand le code ne change pas', async () => {
      schoolRepo.findOne.mockResolvedValue(school());

      await service.update('school-1', { slug: 'cmb' } as any);
      expect(schoolRepo.findOne).toHaveBeenCalledTimes(1);
    });

    it('conserve le code existant quand il n’est pas fourni', async () => {
      const saved = await service.update(
        'school-1',
        { name: 'Nouveau nom' } as any,
      );
      expect(saved.slug).toBe('CMB');
      expect(saved.name).toBe('Nouveau nom');
    });
  });

  it('supprime un établissement et le confirme par son nom', async () => {
    const result = await service.remove('school-1');

    expect(schoolRepo.remove).toHaveBeenCalled();
    expect(result.message).toContain('Collège Moderne de Bingerville');
  });
});
