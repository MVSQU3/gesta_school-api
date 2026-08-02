import type { TDocumentDefinitions } from 'pdfmake/interfaces';
import {
  formatDateTime,
  formatFcfa,
} from '../common/pdf/pdf.service';
import { CancellationType, PaymentMethod } from './entities/payment.entity';
import type { PaymentResult } from './dto/payment-summary.dto';

const METHOD_LABELS: Record<PaymentMethod, string> = {
  [PaymentMethod.CASH]: 'Espèces',
  [PaymentMethod.MOBILE_MONEY]: 'Mobile Money',
  [PaymentMethod.BANK_TRANSFER]: 'Virement bancaire',
};

const CANCELLATION_LABELS: Record<CancellationType, string> = {
  [CancellationType.ERROR]: 'Erreur de saisie',
  [CancellationType.REFUND]: 'Remboursement',
};

/** Ligne « libellé : valeur » du corps du reçu. */
const row = (label: string, value: string) => [
  { text: label, color: '#64748b', fontSize: 8 },
  { text: value, alignment: 'right' as const, bold: true },
];

/**
 * Reçu de caisse.
 *
 * Format A5 : c'est un justificatif remis à la famille, pas un document
 * d'archive. Il tient sur une demi-page et s'imprime aussi bien sur une
 * feuille A4 pliée.
 */
export function buildReceiptPdf(payment: PaymentResult): TDocumentDefinitions {
  const enrollment = payment.enrollment;
  const student = enrollment?.student;
  const school = enrollment?.school;
  const balance = payment.balanceAfter;
  const isCancelled = !!payment.cancelledAt;

  const content: any[] = [];

  // Un reçu annulé ne doit pas pouvoir être présenté comme un justificatif
  if (isCancelled) {
    content.push({
      table: {
        widths: ['*'],
        body: [
          [
            {
              stack: [
                {
                  text: `REÇU ANNULÉ — ${payment.cancellationType ? CANCELLATION_LABELS[payment.cancellationType] : 'annulation'}`,
                  bold: true,
                  color: '#b91c1c',
                  fontSize: 11,
                },
                {
                  text: `Motif : ${payment.cancellationReason ?? '—'}`,
                  fontSize: 8,
                  color: '#7f1d1d',
                  margin: [0, 3, 0, 0],
                },
                {
                  text: `Annulé le ${formatDateTime(payment.cancelledAt)}${
                    payment.cancelledByUser?.email
                      ? ` par ${payment.cancelledByUser.email}`
                      : ''
                  }. Ce document ne vaut plus justificatif de paiement.`,
                  fontSize: 7,
                  color: '#7f1d1d',
                  margin: [0, 2, 0, 0],
                },
              ],
              fillColor: '#fef2f2',
              margin: [8, 8, 8, 8],
            },
          ],
        ],
      },
      layout: {
        hLineColor: () => '#fca5a5',
        vLineColor: () => '#fca5a5',
      },
      margin: [0, 0, 0, 12],
    });
  }

  content.push(
    {
      text: school?.name ?? 'Établissement scolaire',
      alignment: 'center',
      bold: true,
      fontSize: 13,
    },
    {
      text: 'REÇU DE PAIEMENT',
      alignment: 'center',
      bold: true,
      fontSize: 11,
      margin: [0, 4, 0, 0],
    },
    {
      text: `N° ${payment.receiptNumber}`,
      alignment: 'center',
      fontSize: 9,
      color: '#475569',
      margin: [0, 2, 0, 10],
    },
    {
      canvas: [
        { type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 1, lineColor: '#0f172a' },
      ],
      margin: [0, 0, 0, 10],
    },
    {
      table: {
        widths: ['auto', '*'],
        body: [
          row('Référence inscription', enrollment?.reference ?? '—'),
          row(
            'Élève',
            `${student?.lastName ?? ''} ${student?.firstName ?? ''}`.trim() || '—',
          ),
          row('Classe', enrollment?.classRoom?.name ?? '—'),
          row('Année scolaire', enrollment?.academicYear?.label ?? '—'),
          row('Téléphone parent', student?.parentPhone ?? '—'),
          row('Date et heure', formatDateTime(payment.paidAt)),
          row('Mode de règlement', METHOD_LABELS[payment.method] ?? payment.method),
          ...(payment.receivedByUser?.email
            ? [row('Encaissé par', payment.receivedByUser.email)]
            : []),
        ],
      },
      layout: 'noBorders',
      margin: [0, 0, 0, 12],
    },
    {
      table: {
        widths: ['*'],
        body: [
          [
            {
              stack: [
                {
                  text: isCancelled ? 'MONTANT ANNULÉ' : 'MONTANT ENCAISSÉ',
                  fontSize: 8,
                  color: '#ffffff',
                  alignment: 'center',
                },
                {
                  text: formatFcfa(payment.amount),
                  fontSize: 18,
                  bold: true,
                  color: '#ffffff',
                  alignment: 'center',
                  decoration: isCancelled ? 'lineThrough' : undefined,
                  margin: [0, 2, 0, 0],
                },
              ],
              fillColor: isCancelled ? '#64748b' : '#059669',
              margin: [0, 10, 0, 10],
            },
          ],
        ],
      },
      layout: 'noBorders',
      margin: [0, 0, 0, 12],
    },
  );

  // Situation du dossier : sans elle, la famille ne sait pas ce qu'il reste dû
  if (balance && balance.totalDue > 0 && !isCancelled) {
    content.push({
      table: {
        widths: ['*', 'auto'],
        body: [
          [
            { text: 'Total scolarité', fontSize: 8, color: '#475569' },
            { text: formatFcfa(balance.totalDue), alignment: 'right' },
          ],
          [
            { text: 'Cumul versé à ce jour', fontSize: 8, color: '#475569' },
            { text: formatFcfa(balance.amountPaid), alignment: 'right' },
          ],
          [
            {
              text: balance.balance > 0 ? 'RESTE À PAYER' : 'SOLDE SOLDÉ',
              bold: true,
              fontSize: 9,
              color: balance.balance > 0 ? '#b91c1c' : '#047857',
            },
            {
              text: formatFcfa(balance.balance),
              alignment: 'right',
              bold: true,
              fontSize: 11,
              color: balance.balance > 0 ? '#b91c1c' : '#047857',
            },
          ],
        ],
      },
      layout: {
        hLineWidth: (i: number, node: any) =>
          i === 0 || i === node.table.body.length ? 1 : 0.5,
        hLineColor: () => '#cbd5e1',
        vLineWidth: () => 0,
        paddingTop: () => 5,
        paddingBottom: () => 5,
      },
      margin: [0, 0, 0, 14],
    });
  }

  content.push({
    text: `Document édité le ${formatDateTime(new Date())} — Gesta School`,
    alignment: 'center',
    fontSize: 7,
    color: '#94a3b8',
  });

  return {
    info: {
      title: `Reçu ${payment.receiptNumber}`,
      author: school?.name ?? 'Gesta School',
    },
    pageSize: 'A5',
    pageOrientation: 'portrait',
    pageMargins: [30, 30, 30, 30],
    content,
  };
}
