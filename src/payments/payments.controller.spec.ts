import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { Role } from '../common/enums/role.enum';
import { CsvService } from '../common/export/csv.service';
import { PdfService } from '../common/pdf/pdf.service';
import { PaymentMethod } from './entities/payment.entity';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

/**
 * Ce contrôleur résout lui-même l'établissement au lieu d'appeler
 * `resolveSchoolId`. Chaque route doit donc être vérifiée séparément : un
 * `?schoolId=` honoré pour un caissier ouvrirait la caisse d'une autre école.
 */
describe('PaymentsController (caisse)', () => {
  let controller: PaymentsController;
  let service: any;
  let csv: any;
  let pdf: any;
  let res: any;

  const ACCOUNTANT = {
    id: 'acc-1',
    roles: [Role.ACCOUNTANT],
    schoolId: 'school-1',
    slug: 'CMB',
  } as AuthUser;
  const ADMIN = {
    id: 'admin-1',
    roles: [Role.SUPER_ADMIN],
    schoolId: null,
    slug: null,
  } as unknown as AuthUser;

  const payment = {
    id: 'pay-1',
    receiptNumber: 'REC-CMB-26-0001',
    amount: '40000',
    method: PaymentMethod.CASH,
    paidAt: new Date(2026, 7, 3, 9, 5),
    cancelledAt: null,
    cancellationType: null,
    cancellationReason: null,
    enrollment: {
      reference: 'INS-CMB-26-0001',
      student: { lastName: 'Kone', firstName: 'Ama' },
      classRoom: { name: '6ème A' },
      academicYear: { label: '2026-2027' },
    },
    receivedByUser: { email: 'caisse@ecole.ci' },
    cancelledByUser: null,
  };

  beforeEach(async () => {
    service = {
      processPayment: jest.fn().mockResolvedValue(payment),
      findJournal: jest.fn().mockResolvedValue({ items: [] }),
      findJournalForExport: jest.fn().mockResolvedValue([payment]),
      findByReceiptNumber: jest.fn().mockResolvedValue(payment),
      findByEnrollment: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(payment),
      findOneById: jest.fn().mockResolvedValue(payment),
      cancel: jest.fn().mockResolvedValue(payment),
    };
    csv = new CsvService();
    jest.spyOn(csv, 'build');
    pdf = { render: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4')) };
    res = {
      setHeader: jest.fn(),
      set: jest.fn(),
      send: jest.fn(),
      end: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PaymentsController],
      providers: [
        { provide: PaymentsService, useValue: service },
        { provide: PdfService, useValue: pdf },
        { provide: CsvService, useValue: csv },
      ],
    }).compile();

    controller = module.get<PaymentsController>(PaymentsController);
  });

  describe('cloisonnement', () => {
    it('ignore le schoolId en query pour un caissier', async () => {
      await controller.processPayment({} as any, ACCOUNTANT, 'school-voisine');

      expect(service.processPayment).toHaveBeenCalledWith(
        {},
        'school-1',
        'CMB',
        'acc-1',
        // L'acteur complet accompagne l'encaissement, pour le journal d'audit.
        ACCOUNTANT,
      );
    });

    it('laisse le SUPER_ADMIN désigner l’établissement', async () => {
      await controller.processPayment({} as any, ADMIN, 'school-2');

      expect(service.processPayment.mock.calls[0][1]).toBe('school-2');
    });

    it('refuse un SUPER_ADMIN qui ne désigne aucun établissement', async () => {
      await expect(
        controller.processPayment({} as any, ADMIN),
      ).rejects.toThrow(ForbiddenException);
    });

    it('applique la même règle au journal', async () => {
      await controller.findJournal({} as any, ACCOUNTANT, 'school-voisine');
      expect(service.findJournal).toHaveBeenCalledWith('school-1', {});
    });

    it('applique la même règle à la réimpression d’un reçu', async () => {
      await controller.findByReceiptNumber('REC-1', ACCOUNTANT, 'school-voisine');
      expect(service.findByReceiptNumber).toHaveBeenCalledWith('REC-1', 'school-1');
    });

    it('applique la même règle à l’annulation', async () => {
      await controller.cancel('pay-1', {} as any, ACCOUNTANT, 'school-voisine');
      expect(service.cancel).toHaveBeenCalledWith(
        'pay-1',
        {},
        'school-1',
        'acc-1',
        ACCOUNTANT,
      );
    });

    it('applique la même règle à l’échéancier', async () => {
      await controller.findByEnrollment('enr-1', ACCOUNTANT, 'school-voisine');
      expect(service.findByEnrollment).toHaveBeenCalledWith('enr-1', 'school-1');
    });
  });

  describe('consultation d’un reçu', () => {
    it('cantonne un caissier à son établissement', async () => {
      await controller.findOne('pay-1', ACCOUNTANT, 'school-voisine');

      expect(service.findOne).toHaveBeenCalledWith('pay-1', 'school-1');
      expect(service.findOneById).not.toHaveBeenCalled();
    });

    it('laisse le SUPER_ADMIN lire un reçu sans désigner d’école', async () => {
      await controller.findOne('pay-1', ADMIN);

      // Il administre la plateforme : lui imposer de retrouver l'école du
      // reçu avant de pouvoir le lire n'aurait pas de sens.
      expect(service.findOneById).toHaveBeenCalledWith('pay-1');
    });
  });

  describe('export du journal', () => {
    it('produit un fichier téléchargeable', async () => {
      await controller.exportJournal({} as any, res, ACCOUNTANT);

      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'text/csv; charset=utf-8',
      );
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        expect.stringContaining('journal-caisse-CMB-'),
      );
      expect(res.send).toHaveBeenCalled();
    });

    it('fait figurer les versements annulés avec leur motif', async () => {
      await controller.exportJournal({} as any, res, ACCOUNTANT);

      // C'est ce qu'un contrôle vient vérifier : un journal sans les
      // annulations ne prouve rien.
      const headers = csv.build.mock.calls[0][0].map((c: any) => c.header);
      expect(headers).toContain('Annulé');
      expect(headers).toContain("Motif d'annulation");
      expect(headers).toContain('Annulé par');
    });

    it('exporte le montant en nombre et non en texte', async () => {
      await controller.exportJournal({} as any, res, ACCOUNTANT);

      const montant = csv.build.mock.calls[0][0].find(
        (c: any) => c.header === 'Montant (FCFA)',
      );
      expect(montant.value(payment)).toBe(40000);
    });

    it('marque OUI ou NON dans la colonne d’annulation', async () => {
      await controller.exportJournal({} as any, res, ACCOUNTANT);

      const annule = csv.build.mock.calls[0][0].find(
        (c: any) => c.header === 'Annulé',
      );
      expect(annule.value(payment)).toBe('NON');
      expect(annule.value({ ...payment, cancelledAt: new Date() })).toBe('OUI');
    });

    it('se rabat sur ECOLE quand l’utilisateur n’a pas de code établissement', async () => {
      await controller.exportJournal({} as any, res, ADMIN, 'school-2');

      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        expect.stringContaining('-ECOLE-'),
      );
    });
  });

  describe('reçu PDF', () => {
    it('renvoie le PDF en affichage direct', async () => {
      await controller.receiptPdf('REC-CMB-26-0001', ACCOUNTANT, res);

      expect(res.set).toHaveBeenCalledWith(
        expect.objectContaining({
          'Content-Type': 'application/pdf',
          'Content-Disposition': expect.stringContaining(
            'recu-REC-CMB-26-0001.pdf',
          ),
        }),
      );
      expect(res.end).toHaveBeenCalled();
    });

    it('cantonne le PDF à l’établissement du demandeur', async () => {
      await controller.receiptPdf('REC-1', ACCOUNTANT, res, 'school-voisine');
      expect(service.findByReceiptNumber).toHaveBeenCalledWith('REC-1', 'school-1');
    });
  });
});
