import { CsvService, CsvColumn } from './csv.service';

/**
 * Le CSV vise Excel en configuration française, qui est ce qui est installé
 * dans les secrétariats. Les trois choix qui le rendent lisible — séparateur
 * point-virgule, BOM UTF-8, fins de ligne CRLF — se cassent silencieusement :
 * rien n'échoue, le fichier s'ouvre simplement de travers.
 */
describe('CsvService (export tableur)', () => {
  let service: CsvService;

  const BOM = String.fromCharCode(0xfeff);

  const columns = (
    ...defs: Array<[string, (row: any) => any]>
  ): Array<CsvColumn<any>> => defs.map(([header, value]) => ({ header, value }));

  beforeEach(() => {
    service = new CsvService();
  });

  describe('structure du fichier', () => {
    it('place un BOM UTF-8 en tête', () => {
      const csv = service.build(columns(['Nom', (r) => r.nom]), []);

      // Sans lui, Excel lit le fichier en ANSI : « Kouassié » devient
      // « KouassiÃ© ».
      expect(csv.startsWith(BOM)).toBe(true);
    });

    it('sépare les colonnes par un point-virgule', () => {
      const csv = service.build(
        columns(['Nom', (r) => r.nom], ['Classe', (r) => r.classe]),
        [{ nom: 'Kone', classe: '6ème A' }],
      );

      // Avec une virgule, tout le fichier atterrit dans une seule colonne.
      expect(csv).toContain('Nom;Classe');
      expect(csv).toContain('Kone;6ème A');
    });

    it('termine chaque ligne par CRLF', () => {
      const csv = service.build(columns(['Nom', (r) => r.nom]), [{ nom: 'Kone' }]);

      expect(csv).toBe(`${BOM}Nom\r\nKone\r\n`);
    });

    it('produit un fichier d’en-têtes seuls quand il n’y a aucune ligne', () => {
      const csv = service.build(columns(['Nom', (r) => r.nom]), []);
      expect(csv).toBe(`${BOM}Nom\r\n`);
    });
  });

  describe('échappement', () => {
    const value = (v: any) =>
      service.build(columns(['C', () => v]), [{}]).split('\r\n')[1];

    it('encadre une valeur contenant le séparateur', () => {
      expect(value('Kone; Ama')).toBe('"Kone; Ama"');
    });

    it('double les guillemets internes', () => {
      expect(value('Le "grand" Kone')).toBe('"Le ""grand"" Kone"');
    });

    it('encadre une valeur contenant un retour à la ligne', () => {
      // Un motif d'annulation saisi sur deux lignes décalerait sinon toutes
      // les colonnes suivantes.
      expect(value('Ligne 1\nLigne 2')).toBe('"Ligne 1\nLigne 2"');
    });

    it('laisse une valeur ordinaire telle quelle', () => {
      expect(value('Kone Ama')).toBe('Kone Ama');
    });

    it('échappe aussi les en-têtes', () => {
      const csv = service.build(columns(['Montant; FCFA', () => '']), []);
      expect(csv).toContain('"Montant; FCFA"');
    });
  });

  describe('formatage des valeurs', () => {
    const value = (v: any) =>
      service.build(columns(['C', () => v]), [{}]).split('\r\n')[1];

    it('rend une cellule vide pour null et undefined', () => {
      expect(value(null)).toBe('');
      expect(value(undefined)).toBe('');
    });

    it('laisse un entier sans séparateur décimal', () => {
      // Les montants en FCFA restent lisibles comme nombres quelle que soit
      // la locale du tableur.
      expect(value(100000)).toBe('100000');
    });

    it('rend zéro plutôt qu’une cellule vide', () => {
      expect(value(0)).toBe('0');
    });

    it('utilise la virgule décimale pour les valeurs fractionnaires', () => {
      expect(value(14.29)).toBe('14,29');
    });

    it('formate une date en JJ/MM/AAAA HH:MM', () => {
      expect(value(new Date(2026, 7, 3, 9, 5))).toBe('03/08/2026 09:05');
    });

    it('complète les nombres à deux chiffres dans les dates', () => {
      expect(value(new Date(2026, 0, 1, 0, 0))).toBe('01/01/2026 00:00');
    });
  });

  describe('nom de fichier', () => {
    it('horodate le nom au jour près', () => {
      const name = service.filename('journal-caisse', 'CMB');

      expect(name).toMatch(/^journal-caisse-CMB-\d{4}-\d{2}-\d{2}\.csv$/);
    });

    it('écarte les caractères refusés par Windows', () => {
      const name = service.filename('export', 'C/M\\B:*?');
      expect(name).toContain('-CMB-');
    });

    it('se rabat sur ECOLE pour un slug entièrement invalide', () => {
      expect(service.filename('export', '///')).toContain('-ECOLE-');
    });
  });
});
