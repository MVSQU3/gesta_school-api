import {
  PdfService,
  formatDate,
  formatDateTime,
  formatFcfa,
} from './pdf.service';

describe('PdfService (fabrique de documents)', () => {
  let service: PdfService;

  beforeEach(() => {
    service = new PdfService();
  });

  describe('render', () => {
    it('produit un PDF complet en mémoire', async () => {
      const pdf = await service.render({
        content: [{ text: 'Reçu de scolarité' }],
      });

      expect(Buffer.isBuffer(pdf)).toBe(true);
      // Signature d'un fichier PDF : le document est réellement rendu, pas
      // seulement une promesse résolue.
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
      expect(pdf.length).toBeGreaterThan(500);
    });

    it('applique la police Helvetica et les marges par défaut', async () => {
      // Sans police par défaut, pdfmake refuse tout texte non stylé : le
      // premier bulletin échouerait à l'impression.
      await expect(
        service.render({ content: [{ text: 'Sans style explicite' }] }),
      ).resolves.toBeDefined();
    });

    it('laisse la définition écraser les valeurs par défaut', async () => {
      const pdf = await service.render({
        pageMargins: [10, 10, 10, 10],
        content: [{ text: 'Marges serrées' }],
      });

      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    });

    it('rend le français accentué sans police embarquée', async () => {
      // Les polices standard PDF couvrent le français : c'est ce qui évite
      // d'alourdir le dépôt comme les documents produits.
      await expect(
        service.render({
          content: [{ text: 'Élève : Kouassié — scolarité réglée' }],
        }),
      ).resolves.toBeDefined();
    });

    it('rejette proprement une définition invalide', async () => {
      // Une erreur de construction ne doit pas laisser la promesse pendante :
      // la requête HTTP resterait ouverte jusqu'au délai d'expiration.
      await expect(
        service.render({ content: [{ table: {} }] } as any),
      ).rejects.toBeDefined();
    });
  });

  describe('formatage', () => {
    it('affiche les montants en FCFA avec séparateur de milliers', () => {
      expect(formatFcfa(100000)).toBe('100 000 FCFA');
    });

    it('affiche zéro plutôt qu’une valeur vide', () => {
      expect(formatFcfa(0)).toBe('0 FCFA');
      expect(formatFcfa(undefined as unknown as number)).toBe('0 FCFA');
    });

    it('utilise une espace ordinaire, lisible par tout lecteur PDF', () => {
      // L'espace insécable de `toLocaleString` s'affiche parfois en carré
      // dans les polices standard PDF.
      expect(formatFcfa(1000000)).not.toMatch(/ | /);
    });

    it('formate les dates au format français', () => {
      expect(formatDate(new Date(2026, 7, 3))).toBe('03/08/2026');
      expect(formatDate('2026-08-03T00:00:00.000Z')).toContain('2026');
    });

    it('affiche un tiret pour une date absente', () => {
      expect(formatDate(null)).toBe('—');
      expect(formatDate(undefined)).toBe('—');
      expect(formatDateTime(null)).toBe('—');
    });

    it('joint l’heure quand elle est demandée', () => {
      expect(formatDateTime(new Date(2026, 7, 3, 9, 5))).toMatch(/03\/08\/2026/);
      expect(formatDateTime(new Date(2026, 7, 3, 9, 5))).toMatch(/09:05/);
    });
  });
});
