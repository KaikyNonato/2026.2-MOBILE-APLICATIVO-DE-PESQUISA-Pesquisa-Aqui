// Exportações do relatório da pesquisa: XLSX, JSON e PDF. O CSV continua em research-report.ts.
// Tudo recebe os dados já carregados e filtrados (os mesmos do painel), então os arquivos batem com a tela.

import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import {
  durationSeconds,
  formatAnswerForCsv,
  latestAnswers,
  type buildCharts,
  type buildPanel,
  type ReportAnswer,
  type ReportCollection,
  type ReportQuestion,
} from './research-report.js';
import { QUALITY_LABELS, type QualityItem, type summarizeQuality } from './research-quality.js';

export interface ExportData {
  research: { id: number; title: string; status: string; description?: string; objective?: string };
  filter: { from: string | null; to: string | null; researcherId: number | null };
  generatedAt: string;
  panel: ReturnType<typeof buildPanel>;
  charts: ReturnType<typeof buildCharts>;
  questions: ReportQuestion[];
  collections: ReportCollection[];
  answers: ReportAnswer[];
  names: Map<number, string>;
  quality: { items: QualityItem[]; summary: ReturnType<typeof summarizeQuality> };
}

const STATUS_LABEL: Record<string, string> = { DRAFT: 'Rascunho', PUBLISHED: 'Publicada', IN_FIELD: 'Em campo', CLOSED: 'Encerrada' };

/** Questões na ordem do questionário (seção e posição). */
const orderedQuestions = (questions: ReportQuestion[]) =>
  [...questions].sort((a, b) => a.sectionOrder - b.sectionOrder || a.order - b.order);

/** Coletas da mais antiga para a mais nova. */
const sortedCollections = (collections: ReportCollection[]) =>
  [...collections].sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime() || a.id - b.id);

/** Alertas de qualidade de uma coleta. */
const flagsOf = (data: ExportData, collectionId: number) => data.quality.items.find((i) => i.collectionId === collectionId)?.flags ?? [];

// JSON

/** Estrutura completa: cada coleta com as respostas (valor cru e texto legível) e os alertas de qualidade. */
export function buildJson(data: ExportData) {
  const ordered = orderedQuestions(data.questions);
  const latest = latestAnswers(data.answers, new Set(data.collections.map((c) => c.id)));

  return {
    research: { ...data.research, statusLabel: STATUS_LABEL[data.research.status] ?? data.research.status },
    filter: data.filter,
    generatedAt: data.generatedAt,
    summary: {
      totalCollections: data.panel.totalCollections,
      targetTotal: data.panel.targetTotal,
      goalPercent: data.panel.goalPercent,
      averageSeconds: data.panel.averageSeconds,
    },
    researchers: data.panel.researchers.map((r) => ({
      userId: r.userId, name: r.name, collected: r.collected, targetCount: r.targetCount, progress: r.progress, averageSeconds: r.averageSeconds,
    })),
    questions: ordered.map((q) => ({ id: q.id, statement: q.statement, type: q.type, options: q.options.map((o) => ({ id: o.id, text: o.text })) })),
    collections: sortedCollections(data.collections).map((c) => ({
      id: c.id,
      researcher: { id: c.researcherId, name: data.names.get(c.researcherId) ?? null },
      startedAt: c.startedAt,
      finishedAt: c.finishedAt,
      receivedAt: c.receivedAt,
      durationSeconds: durationSeconds(c),
      location:
        typeof c.startLatitude === 'number' && typeof c.startLongitude === 'number'
          ? { latitude: c.startLatitude, longitude: c.startLongitude, accuracy: c.locationAccuracy ?? null }
          : null,
      qualityFlags: flagsOf(data, c.id).map((f) => ({ code: f.code, severity: f.severity, message: f.message })),
      answers: ordered.flatMap((q) => {
        const raw = latest.get(`${c.id}:${q.id}`);
        return raw === undefined || raw.trim() === ''
          ? []
          : [{ questionId: q.id, statement: q.statement, type: q.type, value: raw, text: formatAnswerForCsv(q, raw) }];
      }),
    })),
    charts: data.charts,
    quality: data.quality.summary,
  };
}

// XLSX

/** Texto digitado em campo livre que começa com = + - @ viraria fórmula na planilha: neutraliza (igual ao CSV). */
const safe = (value: unknown) => {
  if (typeof value !== 'string') return value as ExcelJS.CellValue;
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
};

/** Estiliza a primeira linha da planilha (cabeçalho em destaque e congelado). */
function styleHeader(sheet: ExcelJS.Worksheet) {
  const row = sheet.getRow(1);
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3A2E' } };
  row.alignment = { vertical: 'middle', wrapText: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
}

/** Gera a planilha Excel com resumo, coletas, respostas e alertas de qualidade. */
export async function buildXlsx(data: ExportData): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Pesquisa Aqui';
  workbook.created = new Date(data.generatedAt);

  // Resumo
  const summary = workbook.addWorksheet('Resumo');
  summary.columns = [{ width: 28 }, { width: 60 }];
  const period = data.filter.from || data.filter.to ? `${data.filter.from ?? '…'} a ${data.filter.to ?? '…'}` : 'Todo o período';
  const rows: [string, unknown][] = [
    ['Pesquisa', data.research.title],
    ['Situação', STATUS_LABEL[data.research.status] ?? data.research.status],
    ['Período', period],
    ['Gerado em', data.generatedAt],
    ['Total de coletas', data.panel.totalCollections],
    ['Meta total', data.panel.targetTotal ?? ''],
    ['Meta atingida (%)', data.panel.goalPercent ?? ''],
    ['Tempo médio de coleta (s)', data.panel.averageSeconds ?? ''],
    ['Coletas com alerta de qualidade', data.quality.summary.flaggedCollections],
  ];
  for (const [label, value] of rows) summary.addRow([label, safe(value)]).getCell(1).font = { bold: true };

  // Coletas
  const ordered = orderedQuestions(data.questions);
  const latest = latestAnswers(data.answers, new Set(data.collections.map((c) => c.id)));
  const sheet = workbook.addWorksheet('Coletas');
  sheet.addRow([
    'Coleta', 'Pesquisador', 'Início', 'Fim', 'Duração (s)', 'Recebida em', 'Latitude', 'Longitude', 'Alertas',
    ...ordered.map((q) => q.statement),
  ].map(safe));
  for (const c of sortedCollections(data.collections)) {
    sheet.addRow([
      c.id,
      safe(data.names.get(c.researcherId) ?? ''),
      new Date(c.startedAt),
      new Date(c.finishedAt),
      durationSeconds(c) ?? '',
      new Date(c.receivedAt),
      c.startLatitude ?? '',
      c.startLongitude ?? '',
      flagsOf(data, c.id).map((f) => QUALITY_LABELS[f.code]).join(' | '),
      ...ordered.map((q) => safe(formatAnswerForCsv(q, latest.get(`${c.id}:${q.id}`)))),
    ]);
  }
  styleHeader(sheet);
  sheet.columns.forEach((col, i) => { col.width = i < 9 ? 18 : 28; });
  for (const col of [3, 4, 6]) sheet.getColumn(col).numFmt = 'dd/mm/yyyy hh:mm';
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columnCount } };

  // Painel por pesquisador
  const panel = workbook.addWorksheet('Pesquisadores');
  panel.addRow(['Pesquisador', 'Coletas', 'Meta', 'Progresso (%)', 'Tempo médio (s)', 'Última coleta', 'Última sincronização']);
  for (const r of data.panel.researchers) {
    panel.addRow([safe(r.name), r.collected, r.targetCount ?? '', r.progress ?? '', r.averageSeconds ?? '', r.lastCollectionAt ?? '', r.lastSyncAt ?? '']);
  }
  styleHeader(panel);
  panel.columns.forEach((col, i) => { col.width = i === 0 ? 30 : 18; });

  // Gráficos (contagem por opção)
  const charts = workbook.addWorksheet('Respostas por questão');
  charts.addRow(['Questão', 'Opção', 'Respostas', '%']);
  for (const q of data.charts) for (const d of q.data) charts.addRow([safe(q.statement), safe(d.label), d.count, d.percent]);
  styleHeader(charts);
  charts.columns = [{ width: 60 }, { width: 30 }, { width: 12 }, { width: 10 }];

  // Qualidade
  const quality = workbook.addWorksheet('Qualidade');
  quality.addRow(['Coleta', 'Pesquisador', 'Alerta', 'Gravidade', 'Detalhe']);
  for (const item of data.quality.items) {
    const c = data.collections.find((x) => x.id === item.collectionId);
    for (const f of item.flags) {
      quality.addRow([item.collectionId, safe(c ? (data.names.get(c.researcherId) ?? '') : ''), QUALITY_LABELS[f.code], f.severity === 'warning' ? 'Atenção' : 'Informação', f.message]);
    }
  }
  styleHeader(quality);
  quality.columns = [{ width: 10 }, { width: 28 }, { width: 24 }, { width: 14 }, { width: 90 }];

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

// PDF

/** A fonte padrão do PDF (Helvetica) cobre o alfabeto latino com acentos; o resto vira "?". */
const latin = (text: unknown) => String(text ?? '').replace(/[^ -ÿ]/g, '?');
/** Formata segundos como "X min Y s"; devolve `-` quando não há valor. */
const fmtSeconds = (s: number | null) => (s === null ? '-' : s >= 60 ? `${Math.floor(s / 60)} min ${Math.round(s % 60)} s` : `${Math.round(s)} s`);
/** Formata uma data ISO como dd/mm/aaaa, no fuso de São Paulo. */
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '-');

/** Gera o relatório da pesquisa em PDF. */
export function buildPdf(data: ExportData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: latin(`Relatório - ${data.research.title}`), Author: 'Pesquisa Aqui' } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;
    const ensure = (height: number) => {
      if (doc.y + height > doc.page.height - doc.page.margins.bottom) doc.addPage();
    };
    const heading = (text: string) => {
      ensure(40);
      doc.moveDown(0.8).font('Helvetica-Bold').fontSize(13).fillColor('#1f3a2e').text(latin(text), left).moveDown(0.3);
      doc.font('Helvetica').fontSize(10).fillColor('#222222');
    };

    doc.font('Helvetica-Bold').fontSize(20).fillColor('#1f3a2e').text(latin(data.research.title), left, doc.y, { width });
    doc.font('Helvetica').fontSize(10).fillColor('#555555')
      .text(latin(`Relatório da pesquisa - ${STATUS_LABEL[data.research.status] ?? data.research.status}`))
      .text(latin(`Período: ${data.filter.from || data.filter.to ? `${fmtDate(data.filter.from)} a ${fmtDate(data.filter.to)}` : 'todo o período'}`))
      .text(latin(`Gerado em ${new Date(data.generatedAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`));
    if (data.research.objective) doc.moveDown(0.4).fillColor('#222222').text(latin(`Objetivo: ${data.research.objective}`), { width });

    // Números principais
    heading('Resumo');
    const facts: [string, string][] = [
      ['Coletas', String(data.panel.totalCollections)],
      ['Meta', data.panel.targetTotal ? `${data.panel.targetTotal} (${data.panel.goalPercent ?? 0}% atingido)` : 'sem meta'],
      ['Tempo médio', fmtSeconds(data.panel.averageSeconds)],
      ['Com alerta de qualidade', String(data.quality.summary.collectionsWithWarning)],
    ];
    for (const [label, value] of facts) doc.font('Helvetica-Bold').text(`${label}: `, { continued: true }).font('Helvetica').text(latin(value));

    // Pesquisadores
    heading('Pesquisadores');
    const cols = [width * 0.42, width * 0.14, width * 0.14, width * 0.3];
    const drawRow = (cells: string[], bold = false) => {
      ensure(16);
      const y = doc.y;
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9.5);
      let x = left;
      cells.forEach((cell, i) => { doc.text(latin(cell), x, y, { width: cols[i] - 6, lineBreak: false, ellipsis: true }); x += cols[i]; });
      doc.y = y + 15;
    };
    drawRow(['Pesquisador', 'Coletas', 'Meta', 'Tempo médio'], true);
    for (const r of data.panel.researchers) drawRow([r.name, String(r.collected), r.targetCount ? `${r.progress ?? 0}%` : '-', fmtSeconds(r.averageSeconds)]);
    doc.x = left;

    // Gráficos
    if (data.charts.length > 0) heading('Respostas por questão');
    for (const q of data.charts) {
      ensure(30 + q.data.length * 16);
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#222222').text(latin(q.statement), left, doc.y, { width });
      doc.font('Helvetica').fontSize(8.5).fillColor('#666666').text(latin(`${q.answered} de ${q.totalCollections} coletas responderam`)).moveDown(0.2);
      const max = Math.max(1, ...q.data.map((d) => d.percent));
      for (const d of q.data) {
        ensure(16);
        const y = doc.y;
        doc.font('Helvetica').fontSize(9).fillColor('#222222').text(latin(d.label), left, y, { width: width * 0.32, lineBreak: false, ellipsis: true });
        const barX = left + width * 0.34;
        const barW = (width * 0.5 * d.percent) / max;
        doc.rect(barX, y + 1, Math.max(barW, d.count > 0 ? 1 : 0), 9).fill('#2f7d5b');
        doc.fillColor('#222222').text(`${d.count} (${d.percent}%)`, barX + width * 0.5 + 6, y, { width: width * 0.16, lineBreak: false });
        doc.y = y + 15;
      }
      doc.moveDown(0.5);
      doc.x = left;
    }

    // Qualidade
    heading('Auditoria de qualidade');
    const s = data.quality.summary;
    doc.fillColor('#222222').text(latin(`${s.collectionsWithWarning} de ${s.totalCollections} coleta(s) com alerta de atenção.`), left, doc.y, { width });
    for (const [code, label] of Object.entries(QUALITY_LABELS)) {
      const n = s.byCode[code as keyof typeof s.byCode];
      if (n > 0) doc.text(latin(`- ${label}: ${n}`));
    }
    for (const item of data.quality.items.slice(0, 40)) {
      const c = data.collections.find((x) => x.id === item.collectionId);
      ensure(28);
      doc.moveDown(0.3).font('Helvetica-Bold').fontSize(9).text(latin(`Coleta ${item.collectionId} - ${c ? (data.names.get(c.researcherId) ?? '') : ''}`), left, doc.y, { width });
      doc.font('Helvetica').fontSize(9).fillColor('#444444');
      for (const f of item.flags) doc.text(latin(`  ${QUALITY_LABELS[f.code]}: ${f.message}`), { width });
      doc.fillColor('#222222');
    }
    if (data.quality.items.length > 40) doc.moveDown(0.3).text(latin(`... e mais ${data.quality.items.length - 40} coleta(s). Veja todas no XLSX ou no JSON.`));

    doc.end();
  });
}
