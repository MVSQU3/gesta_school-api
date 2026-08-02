import type { TDocumentDefinitions } from 'pdfmake/interfaces';
import { formatDate } from '../common/pdf/pdf.service';
import type { GradingPeriod } from '../grading-periods/entities/grading-period.entity';
import type { StudentBulletin } from './bulletins.service';

/**
 * Mention d'après la moyenne générale. Barème usuel en Côte d'Ivoire ; il n'est
 * pas configurable pour l'instant, les seuils sont à ajuster ici si votre
 * établissement en applique d'autres.
 */
function mentionFor(average: number | null): string {
  if (average === null) return '—';
  if (average >= 16) return 'Excellent';
  if (average >= 14) return 'Très bien';
  if (average >= 12) return 'Bien';
  if (average >= 10) return 'Assez bien';
  if (average >= 8) return 'Insuffisant';
  return 'Très insuffisant';
}

const num = (v: number | null): string =>
  v === null || v === undefined ? '—' : v.toFixed(2);

interface Context {
  period: GradingPeriod;
  schoolName?: string;
  academicYearLabel?: string;
  className?: string;
}

/** Encadré de synthèse (moyenne, rang, mention, absences). */
const summaryBox = (label: string, value: string, strong = false) => ({
  table: {
    widths: ['*'],
    body: [
      [
        {
          stack: [
            { text: label, fontSize: 6.5, color: '#64748b', alignment: 'center' },
            {
              text: value,
              fontSize: strong ? 13 : 9,
              bold: true,
              alignment: 'center',
              margin: [0, 2, 0, 0],
            },
          ],
          margin: [0, 5, 0, 5],
        },
      ],
    ],
  },
  layout: {
    hLineWidth: () => (strong ? 1.5 : 0.5),
    vLineWidth: () => (strong ? 1.5 : 0.5),
    hLineColor: () => (strong ? '#0f172a' : '#cbd5e1'),
    vLineColor: () => (strong ? '#0f172a' : '#cbd5e1'),
  },
});

/** Contenu d'un bulletin, sans enveloppe de document. */
export function buildBulletinContent(
  bulletin: StudentBulletin,
  ctx: Context,
): any[] {
  const totalAbsences =
    bulletin.absences.justified + bulletin.absences.unjustified;

  const subjectRows = bulletin.subjects.map((s) => {
    const notGraded = s.average === null;
    const color = notGraded ? '#94a3b8' : undefined;
    return [
      {
        text: s.name + (notGraded ? '  (non évaluée)' : ''),
        color,
        fontSize: 8,
      },
      { text: String(s.coefficient), alignment: 'center', color, fontSize: 8 },
      {
        text: num(s.average),
        alignment: 'center',
        bold: !notGraded,
        color,
        fontSize: 8,
      },
      { text: num(s.points), alignment: 'center', color, fontSize: 8 },
      { text: num(s.classAverage), alignment: 'center', color: '#64748b', fontSize: 8 },
      { text: num(s.classMin), alignment: 'center', color: '#64748b', fontSize: 8 },
      { text: num(s.classMax), alignment: 'center', color: '#64748b', fontSize: 8 },
    ];
  });

  const content: any[] = [
    {
      text: ctx.schoolName ?? 'Établissement scolaire',
      alignment: 'center',
      bold: true,
      fontSize: 13,
    },
    {
      text: `Bulletin de notes — ${ctx.period.label}`,
      alignment: 'center',
      bold: true,
      fontSize: 10,
      margin: [0, 3, 0, 0],
    },
    ...(ctx.academicYearLabel
      ? [
          {
            text: `Année scolaire ${ctx.academicYearLabel}`,
            alignment: 'center',
            fontSize: 8,
            color: '#475569',
          },
        ]
      : []),
    {
      canvas: [
        { type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 1.5, lineColor: '#0f172a' },
      ],
      margin: [0, 6, 0, 10],
    },
    {
      columns: [
        {
          width: '*',
          stack: [
            { text: 'ÉLÈVE', fontSize: 6.5, color: '#64748b' },
            {
              text: `${bulletin.lastName} ${bulletin.firstName}`,
              bold: true,
              fontSize: 11,
            },
          ],
        },
        {
          width: 'auto',
          stack: [
            { text: 'CLASSE', fontSize: 6.5, color: '#64748b' },
            { text: ctx.className ?? '—', bold: true, fontSize: 11 },
          ],
        },
      ],
      margin: [0, 0, 0, 10],
    },
    {
      table: {
        headerRows: 1,
        widths: ['*', 32, 38, 38, 38, 32, 32],
        body: [
          [
            { text: 'Matière', bold: true, fontSize: 7.5, fillColor: '#e2e8f0' },
            { text: 'Coef.', bold: true, fontSize: 7.5, alignment: 'center', fillColor: '#e2e8f0' },
            { text: 'Moy.', bold: true, fontSize: 7.5, alignment: 'center', fillColor: '#e2e8f0' },
            { text: 'Points', bold: true, fontSize: 7.5, alignment: 'center', fillColor: '#e2e8f0' },
            { text: 'Moy. cl.', bold: true, fontSize: 7.5, alignment: 'center', fillColor: '#e2e8f0' },
            { text: 'Min', bold: true, fontSize: 7.5, alignment: 'center', fillColor: '#e2e8f0' },
            { text: 'Max', bold: true, fontSize: 7.5, alignment: 'center', fillColor: '#e2e8f0' },
          ],
          ...subjectRows,
          [
            { text: 'Totaux', bold: true, alignment: 'right', fontSize: 8, fillColor: '#f1f5f9' },
            {
              text: String(bulletin.totalCoefficients),
              bold: true,
              alignment: 'center',
              fontSize: 8,
              fillColor: '#f1f5f9',
            },
            { text: '', fillColor: '#f1f5f9' },
            {
              text: bulletin.totalPoints.toFixed(2),
              bold: true,
              alignment: 'center',
              fontSize: 8,
              fillColor: '#f1f5f9',
            },
            { text: '', fillColor: '#f1f5f9' },
            { text: '', fillColor: '#f1f5f9' },
            { text: '', fillColor: '#f1f5f9' },
          ],
        ],
      },
      layout: {
        hLineWidth: () => 0.5,
        vLineWidth: () => 0.5,
        hLineColor: () => '#cbd5e1',
        vLineColor: () => '#cbd5e1',
        paddingTop: () => 3,
        paddingBottom: () => 3,
      },
      margin: [0, 0, 0, 12],
    },
    {
      columns: [
        summaryBox(
          'MOYENNE GÉNÉRALE',
          bulletin.average !== null ? `${bulletin.average.toFixed(2)}/20` : '—',
          true,
        ),
        summaryBox(
          'RANG',
          bulletin.rank !== null
            ? `${bulletin.rank}${bulletin.rank === 1 ? 'er' : 'e'} / ${bulletin.classSize}`
            : 'Non classé',
        ),
        summaryBox('MENTION', mentionFor(bulletin.average)),
        summaryBox(
          'ABSENCES',
          `${totalAbsences} ½ j.  (${bulletin.absences.justified} just.)`,
        ),
      ],
      columnGap: 6,
      margin: [0, 0, 0, 12],
    },
  ];

  if (bulletin.average === null) {
    content.push({
      text: "Aucune note n'a été saisie pour cet élève sur cette période : il n'est pas classé.",
      italics: true,
      fontSize: 8,
      color: '#64748b',
      margin: [0, 0, 0, 10],
    });
  }

  content.push(
    {
      columns: [
        {
          table: {
            widths: ['*'],
            heights: [55],
            body: [
              [
                {
                  text: 'Appréciation du conseil de classe',
                  fontSize: 6.5,
                  color: '#64748b',
                },
              ],
            ],
          },
          layout: { hLineColor: () => '#cbd5e1', vLineColor: () => '#cbd5e1' },
        },
        {
          table: {
            widths: ['*'],
            heights: [55],
            body: [
              [{ text: 'Visa de la direction', fontSize: 6.5, color: '#64748b' }],
            ],
          },
          layout: { hLineColor: () => '#cbd5e1', vLineColor: () => '#cbd5e1' },
        },
      ],
      columnGap: 10,
    },
    {
      text: `Document édité le ${formatDate(new Date())} — Gesta School`,
      alignment: 'center',
      fontSize: 6.5,
      color: '#94a3b8',
      margin: [0, 8, 0, 0],
    },
  );

  return content;
}

/** Bulletin d'un seul élève. */
export function buildBulletinPdf(
  bulletin: StudentBulletin,
  ctx: Context,
): TDocumentDefinitions {
  return {
    info: {
      title: `Bulletin ${bulletin.lastName} ${bulletin.firstName} — ${ctx.period.label}`,
      author: ctx.schoolName ?? 'Gesta School',
    },
    pageSize: 'A4',
    pageMargins: [40, 35, 40, 35],
    content: buildBulletinContent(bulletin, ctx),
  };
}

/**
 * Bulletins d'une classe entière, un élève par page.
 *
 * `pageBreak: 'before'` à partir du deuxième élève : la pile sort dans l'ordre
 * de l'appel, prête à être distribuée.
 */
export function buildClassBulletinsPdf(
  bulletins: StudentBulletin[],
  ctx: Context,
): TDocumentDefinitions {
  const content = bulletins.flatMap((bulletin, index) => {
    const parts = buildBulletinContent(bulletin, ctx);
    if (index > 0) {
      parts[0] = { ...parts[0], pageBreak: 'before' };
    }
    return parts;
  });

  return {
    info: {
      title: `Bulletins ${ctx.className ?? ''} — ${ctx.period.label}`,
      author: ctx.schoolName ?? 'Gesta School',
    },
    pageSize: 'A4',
    pageMargins: [40, 35, 40, 35],
    content,
  };
}
