import { Injectable } from '@nestjs/common';
import type { TDocumentDefinitions } from 'pdfmake/interfaces';

/**
 * `@types/pdfmake` décrit la version navigateur, qui n'expose pas le
 * constructeur serveur. On le charge donc en CommonJS avec un typage local
 * réduit à ce que nous utilisons.
 */
interface PdfKitDocument {
  on(event: 'data', listener: (chunk: Buffer) => void): void;
  on(event: 'end', listener: () => void): void;
  on(event: 'error', listener: (error: Error) => void): void;
  end(): void;
}

interface PdfPrinterInstance {
  createPdfKitDocument(definition: TDocumentDefinitions): PdfKitDocument;
}

type PdfPrinterConstructor = new (
  fonts: Record<string, Record<string, string>>,
) => PdfPrinterInstance;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const PdfPrinter: PdfPrinterConstructor = require('pdfmake');

/**
 * Fabrique de documents PDF.
 *
 * Les polices standard PDF (Helvetica) sont utilisées plutôt que des fichiers
 * embarqués : elles sont présentes dans tout lecteur, couvrent le français
 * accentué, et évitent d'alourdir le dépôt comme les documents produits.
 */
@Injectable()
export class PdfService {
  private readonly printer = new PdfPrinter({
    Helvetica: {
      normal: 'Helvetica',
      bold: 'Helvetica-Bold',
      italics: 'Helvetica-Oblique',
      bolditalics: 'Helvetica-BoldOblique',
    },
  });

  /**
   * Rend une définition de document en PDF complet, en mémoire.
   *
   * Les documents produits ici — un reçu, un bulletin, au plus une classe de
   * bulletins — pèsent quelques dizaines de kilo-octets : les accumuler en
   * mémoire reste sans risque et simplifie l'envoi comme la gestion d'erreur.
   */
  render(definition: TDocumentDefinitions): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const doc = this.printer.createPdfKitDocument({
          defaultStyle: { font: 'Helvetica', fontSize: 9 },
          pageMargins: [40, 40, 40, 40],
          ...definition,
        });

        const chunks: Buffer[] = [];
        doc.on('data', (chunk: Buffer) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }
}

/** Montant en FCFA, avec séparateur de milliers insécable. */
export const formatFcfa = (value: number): string =>
  `${Number(value || 0).toLocaleString('fr-FR').replace(/ | /g, ' ')} FCFA`;

export const formatDate = (value: Date | string | null | undefined): string =>
  value ? new Date(value).toLocaleDateString('fr-FR') : '—';

export const formatDateTime = (value: Date | string | null | undefined): string =>
  value ? new Date(value).toLocaleString('fr-FR') : '—';
