import ExcelJS from 'exceljs';
import { buildCharts, buildPanel, type ReportAnswer, type ReportCollection, type ReportQuestion } from './research-report';
import { auditCollections, summarizeQuality } from './research-quality';
import { buildJson, buildPdf, buildXlsx, type ExportData } from './research-export';

const questions: ReportQuestion[] = [
  { id: 1, statement: 'Gosta do serviço?', type: 'YES_NO', sectionOrder: 1, order: 1, options: [] },
  { id: 2, statement: 'Cor preferida', type: 'SINGLE_CHOICE', sectionOrder: 1, order: 2, options: [{ id: 21, text: 'Azul', order: 1 }, { id: 22, text: 'Verde', order: 2 }] },
  { id: 3, statement: 'Comentário', type: 'FREE_TEXT', sectionOrder: 1, order: 3, options: [] },
];
const collections: ReportCollection[] = [
  { id: 1, researcherId: 1, startedAt: '2026-05-04T12:00:00.000Z', finishedAt: '2026-05-04T12:00:05.000Z', receivedAt: '2026-05-04T13:00:00.000Z', startLatitude: -8.05, startLongitude: -34.9 },
  { id: 2, researcherId: 2, startedAt: '2026-05-04T14:00:00.000Z', finishedAt: '2026-05-04T14:05:00.000Z', receivedAt: '2026-05-04T15:00:00.000Z' },
];
const answers: ReportAnswer[] = [
  { id: 1, collectionId: 1, questionId: 1, value: 'YES' },
  { id: 2, collectionId: 1, questionId: 2, value: '21' },
  { id: 3, collectionId: 1, questionId: 3, value: '=HYPERLINK("http://x")' },
  { id: 4, collectionId: 2, questionId: 1, value: 'NO' },
  { id: 5, collectionId: 2, questionId: 2, value: '22' },
];
const researchers = [
  { userId: 1, name: 'Ana', username: 'ana', targetCount: 10, linked: true, lastSyncAt: null },
  { userId: 2, name: 'Bruno ação', username: 'bruno', targetCount: null, linked: true, lastSyncAt: null },
];

function data(): ExportData {
  const items = auditCollections(questions, collections, answers, { recordInterview: false, area: null });
  return {
    research: { id: 7, title: 'Pesquisa de teste', status: 'IN_FIELD', objective: 'Testar' },
    filter: { from: null, to: null, researcherId: null },
    generatedAt: '2026-05-05T10:00:00.000Z',
    panel: buildPanel(researchers, collections),
    charts: buildCharts(questions, collections, answers),
    questions, collections, answers,
    names: new Map(researchers.map((r) => [r.userId, r.name])),
    quality: { items, summary: summarizeQuality(items, collections) },
  };
}

describe('exportações', () => {
  it('JSON: coletas com respostas legíveis, local e alertas', () => {
    const json = buildJson(data());
    expect(json.collections).toHaveLength(2);
    const first = json.collections[0];
    expect(first.location).toEqual({ latitude: -8.05, longitude: -34.9, accuracy: null });
    expect(first.answers.map((a) => a.text)).toEqual(['Sim', 'Azul', '=HYPERLINK("http://x")']);
    expect(first.qualityFlags.map((f) => f.code)).toEqual(['TOO_FAST']);
    expect(json.collections[1].location).toBeNull();
    expect(json.summary.totalCollections).toBe(2);
    expect(() => JSON.stringify(json)).not.toThrow();
  });

  it('XLSX: abre de volta, tem as planilhas e neutraliza fórmula digitada', async () => {
    const buffer = await buildXlsx(data());
    expect(buffer.subarray(0, 2).toString()).toBe('PK');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Resumo', 'Coletas', 'Pesquisadores', 'Respostas por questão', 'Qualidade']);

    const sheet = wb.getWorksheet('Coletas')!;
    expect(sheet.rowCount).toBe(3);
    const header = (sheet.getRow(1).values as unknown[]).slice(1);
    expect(header.slice(0, 3)).toEqual(['Coleta', 'Pesquisador', 'Início']);
    const comment = String(sheet.getRow(2).getCell(9 + 3).value);
    expect(comment.startsWith("'=")).toBe(true);
    expect(wb.getWorksheet('Qualidade')!.rowCount).toBeGreaterThan(1);
  });

  it('PDF: gera um arquivo PDF válido com acentos', async () => {
    const buffer = await buildPdf(data());
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buffer.length).toBeGreaterThan(1500);
  });

  it('PDF e XLSX funcionam sem nenhuma coleta', async () => {
    const empty: ExportData = { ...data(), collections: [], answers: [], panel: buildPanel(researchers, []), charts: buildCharts(questions, [], []), quality: { items: [], summary: summarizeQuality([], []) } };
    expect((await buildPdf(empty)).subarray(0, 5).toString()).toBe('%PDF-');
    expect((await buildXlsx(empty)).subarray(0, 2).toString()).toBe('PK');
  });
});
