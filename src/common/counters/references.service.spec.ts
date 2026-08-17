import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Counter, CounterScope } from './counter.entity';
import { ReferencesService } from './references.service';

describe('ReferencesService (génération des références)', () => {
  let service: ReferencesService;
  let manager: any;

  /** Fait répondre l'UPSERT avec le numéro réservé. */
  const givenSequence = (lastValue: number) =>
    manager.query.mockResolvedValue([{ lastValue }]);

  beforeEach(async () => {
    manager = { query: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReferencesService,
        { provide: getRepositoryToken(Counter), useValue: { manager } },
      ],
    }).compile();

    service = module.get<ReferencesService>(ReferencesService);
  });

  describe('nextSequence', () => {
    it('réserve le numéro en un seul UPSERT atomique', async () => {
      givenSequence(1);
      await service.nextSequence('school-1', CounterScope.ENROLLMENT, 2026);

      const [sql, params] = manager.query.mock.calls[0];
      // C'est ce `ON CONFLICT DO UPDATE ... RETURNING` qui empêche deux
      // inscriptions simultanées d'obtenir la même référence. Un SELECT puis
      // UPDATE en deux temps rouvrirait la collision.
      expect(sql).toContain('ON CONFLICT');
      expect(sql).toContain('DO UPDATE');
      expect(sql).toContain('RETURNING');
      expect(params).toEqual(['school-1', CounterScope.ENROLLMENT, 2026]);
    });

    it('convertit en nombre la valeur renvoyée par PostgreSQL', async () => {
      manager.query.mockResolvedValue([{ lastValue: '42' as unknown as number }]);

      await expect(
        service.nextSequence('school-1', CounterScope.RECEIPT, 2026),
      ).resolves.toBe(42);
    });

    it('cloisonne les compteurs par école, par type et par année', async () => {
      givenSequence(1);
      await service.nextSequence('school-A', CounterScope.RECEIPT, 2026);
      await service.nextSequence('school-B', CounterScope.RECEIPT, 2026);

      expect(manager.query.mock.calls[0][1]).toEqual([
        'school-A',
        CounterScope.RECEIPT,
        2026,
      ]);
      expect(manager.query.mock.calls[1][1]).toEqual([
        'school-B',
        CounterScope.RECEIPT,
        2026,
      ]);
    });

    it('utilise le manager de la transaction quand il est fourni', async () => {
      const txManager: any = { query: jest.fn().mockResolvedValue([{ lastValue: 7 }]) };

      // Réserver hors transaction consommerait un numéro même si l'inscription
      // échoue ensuite, laissant un trou dans la séquence.
      await expect(
        service.nextSequence('school-1', CounterScope.ENROLLMENT, 2026, txManager),
      ).resolves.toBe(7);
      expect(txManager.query).toHaveBeenCalled();
      expect(manager.query).not.toHaveBeenCalled();
    });
  });

  describe('formatage', () => {
    const currentYear = new Date().getFullYear();
    const yy = currentYear.toString().slice(-2);

    it('produit une référence d’inscription INS-SLUG-AA-XXXX', async () => {
      givenSequence(1);

      await expect(
        service.nextEnrollmentReference('school-1', 'cmb'),
      ).resolves.toBe(`INS-CMB-${yy}-0001`);
    });

    it('produit un numéro de reçu REC-SLUG-AA-XXXX', async () => {
      givenSequence(1);

      await expect(
        service.nextReceiptNumber('school-1', 'CMB'),
      ).resolves.toBe(`REC-CMB-${yy}-0001`);
    });

    it('force le slug en majuscules', async () => {
      givenSequence(12);

      await expect(
        service.nextEnrollmentReference('school-1', 'sainte-marie'),
      ).resolves.toBe(`INS-SAINTE-MARIE-${yy}-0012`);
    });

    it('complète la séquence à quatre chiffres', async () => {
      givenSequence(7);
      await expect(service.nextReceiptNumber('s', 'CMB')).resolves.toBe(
        `REC-CMB-${yy}-0007`,
      );

      givenSequence(999);
      await expect(service.nextReceiptNumber('s', 'CMB')).resolves.toBe(
        `REC-CMB-${yy}-0999`,
      );
    });

    it('ne tronque pas au-delà de 9999', async () => {
      givenSequence(10000);

      // Une école qui dépasse 9999 reçus doit continuer à obtenir des numéros
      // uniques, quitte à ce que la référence s'allonge.
      await expect(service.nextReceiptNumber('s', 'CMB')).resolves.toBe(
        `REC-CMB-${yy}-10000`,
      );
    });

    it('utilise des compteurs distincts pour inscriptions et reçus', async () => {
      givenSequence(1);
      await service.nextEnrollmentReference('school-1', 'CMB');
      await service.nextReceiptNumber('school-1', 'CMB');

      expect(manager.query.mock.calls[0][1][1]).toBe(CounterScope.ENROLLMENT);
      expect(manager.query.mock.calls[1][1][1]).toBe(CounterScope.RECEIPT);
    });
  });
});
