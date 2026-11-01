import { auditCollections, distanceKm, summarizeQuality, QUALITY_LIMITS } from './research-quality';
import type { ReportAnswer, ReportCollection, ReportQuestion } from './research-report';

const questions: ReportQuestion[] = Array.from({ length: 8 }, (_, i) => ({
  id: i + 1, statement: `Q${i + 1}`, type: i < 7 ? 'SCALE_1_5' : 'FREE_TEXT', sectionOrder: 1, order: i + 1, options: [],
}));

const start = new Date('2026-05-04T12:00:00Z').getTime();
const collection = (id: number, seconds: number, extra: Partial<ReportCollection> = {}): ReportCollection => ({
  id, researcherId: 1,
  startedAt: new Date(start + id * 1e6).toISOString(),
  finishedAt: new Date(start + id * 1e6 + seconds * 1000).toISOString(),
  receivedAt: new Date(start + id * 1e6 + seconds * 1000).toISOString(),
  consentGiven: false,
  ...extra,
});
let answerId = 0;
const answersFor = (collectionId: number, values: (string | null)[]): ReportAnswer[] =>
  values.flatMap((value, i) => (value === null ? [] : [{ id: ++answerId, collectionId, questionId: i + 1, value }]));

const codes = (items: ReturnType<typeof auditCollections>, id: number) => (items.find((i) => i.collectionId === id)?.flags ?? []).map((f) => f.code);
const normal = ['1', '3', '2', '5', '4', '2', '3', 'ok'];

describe('auditoria de qualidade', () => {
  const options = { recordInterview: false, area: null };

  it('não alerta uma coleta normal', () => {
    expect(auditCollections(questions, [collection(1, 300)], answersFor(1, normal), options)).toEqual([]);
  });

  it('alerta coleta rápida demais para o número de respostas', () => {
    const items = auditCollections(questions, [collection(1, 8)], answersFor(1, normal), options);
    expect(codes(items, 1)).toEqual(['TOO_FAST']);
  });

  it('alerta coleta muito abaixo da mediana, só com coletas suficientes', () => {
    const many = Array.from({ length: QUALITY_LIMITS.medianMinCollections }, (_, i) => collection(i + 1, 400));
    const fast = collection(99, 100); // 100 s < 35% de 400 s e acima do piso absoluto
    const all = [...many, fast];
    const answers = all.flatMap((c) => answersFor(c.id, normal));
    expect(codes(auditCollections(questions, all, answers, options), 99)).toEqual(['TOO_FAST']);

    // Com poucas coletas, a mediana não vale.
    const few = [collection(1, 400), fast];
    const fewAnswers = few.flatMap((c) => answersFor(c.id, normal));
    expect(auditCollections(questions, few, fewAnswers, options)).toEqual([]);
  });

  it('alerta respostas de escolha iguais em sequência e textos idênticos', () => {
    const same = ['3', '3', '3', '3', '3', '3', '3', 'ok'];
    expect(codes(auditCollections(questions, [collection(1, 300)], answersFor(1, same), options), 1)).toEqual(['REPEATED_ANSWERS']);

    const fewSame = ['3', '3', '3', '3', '3', '1', '1', 'ok']; // sequência de 5 < 6
    expect(auditCollections(questions, [collection(1, 300)], answersFor(1, fewSame), options)).toEqual([]);

    const textQuestions: ReportQuestion[] = [1, 2, 3].map((i) => ({ id: i, statement: `T${i}`, type: 'FREE_TEXT', sectionOrder: 1, order: i, options: [] }));
    const items = auditCollections(textQuestions, [collection(1, 300)], answersFor(1, ['Não sei', 'não sei', 'NÃO SEI']), options);
    expect(codes(items, 1)).toEqual(['REPEATED_ANSWERS']);
  });

  it('alerta localização fora da área e avisa quando não há localização', () => {
    const area = { latitude: -8.05, longitude: -34.9, radiusKm: 5 }; // Recife
    const inside = collection(1, 300, { startLatitude: -8.06, startLongitude: -34.89 });
    const outside = collection(2, 300, { startLatitude: -8.28, startLongitude: -35.97 }); // Caruaru
    const none = collection(3, 300);
    const all = [inside, outside, none];
    const items = auditCollections(questions, all, all.flatMap((c) => answersFor(c.id, normal)), { recordInterview: false, area });
    expect(codes(items, 1)).toEqual([]);
    expect(codes(items, 2)).toEqual(['OUT_OF_AREA']);
    expect(codes(items, 3)).toEqual(['NO_LOCATION']);
    expect(items.find((i) => i.collectionId === 3)!.flags[0].severity).toBe('info');
  });

  it('sem área definida, localização não gera alerta nenhum', () => {
    expect(auditCollections(questions, [collection(1, 300)], answersFor(1, normal), options)).toEqual([]);
  });

  it('alerta áudio ausente só quando a pesquisa grava, houve consentimento e não há áudio', () => {
    const rec = { recordInterview: true, area: null };
    const noAudio = collection(1, 300, { consentGiven: true, audioPath: null });
    const withAudio = collection(2, 300, { consentGiven: true, audioPath: 'x/y.m4a' });
    const noConsent = collection(3, 300, { consentGiven: false });
    const all = [noAudio, withAudio, noConsent];
    const items = auditCollections(questions, all, all.flatMap((c) => answersFor(c.id, normal)), rec);
    expect(codes(items, 1)).toEqual(['MISSING_AUDIO']);
    expect(codes(items, 2)).toEqual([]);
    expect(codes(items, 3)).toEqual([]);
    // Pesquisa que não grava nunca alerta.
    expect(auditCollections(questions, [noAudio], answersFor(1, normal), options)).toEqual([]);
  });

  it('resume por tipo e por pesquisador (informativos não contam como atenção)', () => {
    const area = { latitude: 0, longitude: 0, radiusKm: 1 };
    const all = [collection(1, 3, { researcherId: 1 }), collection(2, 300, { researcherId: 2 })];
    const items = auditCollections(questions, all, all.flatMap((c) => answersFor(c.id, normal)), { recordInterview: false, area });
    const summary = summarizeQuality(items, all);
    expect(summary.byCode.TOO_FAST).toBe(1);
    expect(summary.byCode.NO_LOCATION).toBe(2);
    expect(summary.collectionsWithWarning).toBe(1);
    expect(summary.flaggedByResearcher).toEqual([{ researcherId: 1, flagged: 1 }]);
  });
});

describe('distanceKm', () => {
  it('calcula distâncias conhecidas', () => {
    expect(distanceKm(0, 0, 0, 0)).toBe(0);
    expect(distanceKm(-8.0476, -34.877, -8.2829, -35.9739)).toBeGreaterThan(110); // Recife - Caruaru, ~ 120 km
    expect(distanceKm(-8.0476, -34.877, -8.2829, -35.9739)).toBeLessThan(135);
  });
});
