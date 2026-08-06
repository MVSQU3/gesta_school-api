import { Injectable } from '@nestjs/common';

/** Fin de ligne imposée par la RFC 4180, et attendue par Excel sous Windows. */
const CRLF = '\r\n';

/** Une colonne du fichier : son en-tête et la façon d'en extraire la valeur. */
export interface CsvColumn<T> {
  header: string;
  value: (row: T) => string | number | Date | null | undefined;
}

/**
 * Génération de fichiers CSV destinés à être ouverts dans un tableur.
 *
 * Le format retenu vise Excel en configuration française, qui est ce qui est
 * installé dans les secrétariats :
 *
 *  - séparateur point-virgule, celui qu'attend Excel quand la virgule est le
 *    séparateur décimal ; avec une virgule, tout le fichier atterrit dans une
 *    seule colonne ;
 *  - BOM UTF-8 en tête, sans lequel Excel lit le fichier en ANSI et affiche
 *    « KouassiÃ© » au lieu de « Kouassié » ;
 *  - fins de ligne CRLF, comme le veut la RFC 4180.
 *
 * Un vrai .xlsx demanderait une bibliothèque tierce ; le CSV ainsi formé
 * s'ouvre d'un double-clic dans Excel comme dans LibreOffice, et reste
 * réimportable dans n'importe quel outil comptable.
 */
@Injectable()
export class CsvService {
  private readonly separator = ';';

  /**
   * Échappe une valeur pour le CSV.
   *
   * Les guillemets, le séparateur et les retours à la ligne imposent
   * l'encadrement par des guillemets — un motif d'annulation saisi sur deux
   * lignes décalerait sinon toutes les colonnes suivantes.
   */
  private escape(value: string): string {
    if (
      value.includes('"') ||
      value.includes(this.separator) ||
      value.includes('\n') ||
      value.includes('\r')
    ) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }

  /** `JJ/MM/AAAA HH:MM`, reconnu comme date par Excel en configuration française. */
  private formatDate(date: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return (
      `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ` +
      `${pad(date.getHours())}:${pad(date.getMinutes())}`
    );
  }

  private format(value: string | number | Date | null | undefined): string {
    if (value === null || value === undefined) return '';
    if (value instanceof Date) return this.formatDate(value);

    if (typeof value === 'number') {
      // Les montants en FCFA sont entiers en pratique : on les laisse sans
      // séparateur décimal, ce qui les rend lisibles comme nombres quelle que
      // soit la locale du tableur. La virgule n'apparaît que pour les rares
      // valeurs décimales (coefficients, moyennes).
      return Number.isInteger(value)
        ? String(value)
        : String(value).replace('.', ',');
    }

    return this.escape(value);
  }

  /** Assemble le contenu complet du fichier, BOM compris. */
  build<T>(columns: Array<CsvColumn<T>>, rows: T[]): string {
    const header = columns
      .map((c) => this.escape(c.header))
      .join(this.separator);
    const lines = rows.map((row) =>
      columns.map((c) => this.format(c.value(row))).join(this.separator),
    );

    // Le BOM est construit par son code plutôt qu'écrit en caractère : un
    // U+FEFF littéral est invisible dans le source, se perd au premier
    // copier-coller ou reformatage, et l'export repartirait alors en ANSI
    // sans que rien ne le signale — les accents cassés ne se voient qu'à
    // l'ouverture du fichier dans Excel.
    const bom = String.fromCharCode(0xfeff);

    return bom + [header, ...lines].join(CRLF) + CRLF;
  }

  /**
   * Nom de fichier horodaté : `journal-caisse-CMB-2026-08-03.csv`.
   * Les caractères refusés par Windows sont écartés.
   */
  filename(prefix: string, slug: string): string {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const safeSlug = slug.replace(/[^A-Za-z0-9_-]/g, '') || 'ECOLE';
    return `${prefix}-${safeSlug}-${day}.csv`;
  }
}
