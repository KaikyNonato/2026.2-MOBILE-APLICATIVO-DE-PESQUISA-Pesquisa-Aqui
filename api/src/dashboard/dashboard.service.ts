import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import type { UserPayLoad } from '../auth/current-user.type.js';

// Painel inicial do administrador: o servidor calcula os totais, os gráficos e as listas curtas e devolve só
// o resultado (alguns KB), em vez de o navegador baixar todas as pesquisas, pesquisadores e coletas da empresa.

const DAY_MS = 24 * 60 * 60 * 1000;
/** Um pesquisador conta como "em campo" se terminou uma coleta nesta janela. */
const IN_FIELD_WINDOW_MS = 2 * 60 * 60 * 1000;
const HEAT_WINDOW_DAYS = 28;
const HEAT_FIRST_HOUR = 8;
const HEAT_HOURS = 12;
const EDIT_THRESHOLD_MS = 2000;
const MAX_PINS = 8;
const MAX_TEAM_ROWS = 50;
const ACTIVITY_LIMIT = 10;
const ACTIVE_STATUSES = ['PUBLISHED', 'IN_FIELD'];

export interface ActivityItem {
  id: string;
  kind: 'company' | 'admin' | 'research' | 'researcher';
  message: string;
  date: string;
}

const RESEARCH_UPDATE_MESSAGES: Record<string, string> = {
  DRAFT: 'atualizada',
  PUBLISHED: 'publicada',
  IN_FIELD: 'colocada em campo',
  CLOSED: 'encerrada',
};

/** Converte um texto em data. Devolve `null` se estiver vazio ou for inválido. */
const toDate = (raw: string | null | undefined) => {
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
};

/** Diz se o registro foi alterado depois de criado (diferença maior que `EDIT_THRESHOLD_MS`). */
const wasEdited = (created: Date | null, updated: Date | null) =>
  !!created && !!updated && updated.getTime() - created.getTime() > EDIT_THRESHOLD_MS;

/**
 * Ordena as atividades da mais nova para a mais antiga, corta no limite e converte a data para
 * texto ISO.
 */
export const recentActivities = (items: (Omit<ActivityItem, 'date'> & { at: Date })[], limit = ACTIVITY_LIMIT): ActivityItem[] =>
  items
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, limit)
    .map(({ at, ...item }) => ({ ...item, date: at.toISOString() }));

/** Calcula os números do painel do administrador da empresa. */
@Injectable()
export class DashboardService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) { }

  /**
   * `tzOffset` = minutos de diferença do navegador para o UTC (`new Date().getTimezoneOffset()`): o mapa de
   * calor e "coletas de hoje" dependem do fuso de quem olha, não do fuso do servidor.
   */
  async admin(currentUser: UserPayLoad, tzOffset = 0) {
    if (currentUser.profile !== 'ADMINISTRATOR') throw new ForbiddenException('Only administrators have a company dashboard.');
    if (!currentUser.companyId) throw new ForbiddenException('User has no associated company');

    const orm = this.prisma.client.orm.public;
    const companyId = currentUser.companyId;
    const now = Date.now();
    const local = (ms: number) => new Date(ms - tzOffset * 60_000); // use os métodos getUTC* nesta data

    const researches = [...(await orm.Research.where({ companyId }).all())];
    const researchers = [...(await orm.User.where({ profile: 'RESEARCHER', companyId }).all())];

    // ---- Pesquisas
    const today = local(now);
    const year = today.getUTCFullYear();
    const month = today.getUTCMonth() + 1;

    const activeIn = (m: number, y: number) => {
      const monthStart = new Date(y, m - 1, 1);
      const monthEnd = new Date(y, m, 0);
      return researches.filter((r) => ACTIVE_STATUSES.includes(r.status) && new Date(r.startDate) <= monthEnd && new Date(r.endDate) >= monthStart);
    };
    const activeThisMonth = activeIn(month, year);
    const activePrevMonth = activeIn(month === 1 ? 12 : month - 1, month === 1 ? year - 1 : year);
    const activeByMonth = Array.from({ length: 12 }, (_, i) => activeIn(i + 1, year).length);

    const byStatus = { DRAFT: 0, PUBLISHED: 0, IN_FIELD: 0, CLOSED: 0 } as Record<string, number>;
    for (const r of researches) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;

    const pins = [...activeThisMonth]
      .sort((a, b) => new Date(a.endDate).getTime() - new Date(b.endDate).getTime())
      .slice(0, MAX_PINS)
      .map((r) => ({ id: r.id, title: r.title, endDate: r.endDate }));

    // ---- Pesquisadores
    const researchersByMonth = Array.from({ length: 12 }, () => 0);
    for (const u of researchers) {
      const created = toDate(u.createdAt);
      if (created && local(created.getTime()).getUTCFullYear() === year) researchersByMonth[local(created.getTime()).getUTCMonth()] += 1;
    }

    // ---- Coletas das últimas semanas (mapa de calor, equipe e "em campo")
    const since = new Date(now - HEAT_WINDOW_DAYS * DAY_MS).toISOString();
    const fieldIds = researches.filter((r) => r.status !== 'DRAFT').map((r) => r.id);
    const recent =
      fieldIds.length === 0
        ? []
        : [...(await orm.Collection.where((c) => c.researchId.in(fieldIds)).where((c) => c.finishedAt.gte(since)).all())];

    const byUser = new Map<number, { today: number; last: number | null }>();
    const cells = Array.from({ length: 7 }, () => new Array<number>(HEAT_HOURS).fill(0));
    let heatTotal = 0;
    let heatOutside = 0;
    const todayKey = `${today.getUTCFullYear()}-${today.getUTCMonth()}-${today.getUTCDate()}`;

    for (const c of recent) {
      const at = (toDate(c.finishedAt) ?? toDate(c.startedAt))?.getTime();
      if (at === undefined || Number.isNaN(at)) continue;

      const entry = byUser.get(c.researcherId) ?? { today: 0, last: null };
      const d = local(at);
      if (`${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}` === todayKey) entry.today += 1;
      if (entry.last === null || at > entry.last) entry.last = at;
      byUser.set(c.researcherId, entry);

      if (at > now + 60_000) continue;
      heatTotal += 1;
      const day = (d.getUTCDay() + 6) % 7; // 0 = segunda
      const col = d.getUTCHours() - HEAT_FIRST_HOUR;
      if (col < 0 || col >= HEAT_HOURS) {
        heatOutside += 1;
        continue;
      }
      cells[day][col] += 1;
    }

    let peak: { day: number; hour: number; count: number } | null = null;
    cells.forEach((row, day) =>
      row.forEach((count, col) => {
        if (count > 0 && (!peak || count > peak.count)) peak = { day, hour: col + HEAT_FIRST_HOUR, count };
      }),
    );
    const max = (peak as { count: number } | null)?.count ?? 0;
    const levels = cells.map((row) => row.map((count) => (count === 0 || max === 0 ? 0 : Math.ceil((count / max) * 4))));

    const teamRows = researchers
      .map((u) => {
        const entry = byUser.get(u.id);
        const last = entry?.last ?? null;
        return {
          id: u.id,
          name: u.name,
          username: u.username,
          avatarUrl: u.avatarUrl ?? null,
          collectionsToday: entry?.today ?? 0,
          lastAt: last === null ? null : new Date(last).toISOString(),
          inField: last !== null && now - last <= IN_FIELD_WINDOW_MS && last <= now + 60_000,
        };
      })
      .sort((a, b) => Number(b.inField) - Number(a.inField) || b.collectionsToday - a.collectionsToday || a.name.localeCompare(b.name, 'pt-BR'));

    // ---- Atividade recente (só as 10 mais novas)
    const items: (Omit<ActivityItem, 'date'> & { at: Date })[] = [];
    for (const r of researches) {
      const created = toDate(r.createdAt);
      const updated = toDate(r.updatedAt);
      if (created) items.push({ id: `research-${r.id}-created`, kind: 'research', message: `Pesquisa “${r.title}” criada`, at: created });
      if (updated && wasEdited(created, updated)) {
        items.push({ id: `research-${r.id}-updated`, kind: 'research', message: `Pesquisa “${r.title}” ${RESEARCH_UPDATE_MESSAGES[r.status] ?? 'atualizada'}`, at: updated });
      }
    }
    for (const u of researchers) {
      const created = toDate(u.createdAt);
      if (created) items.push({ id: `researcher-${u.id}-created`, kind: 'researcher', message: `Pesquisador “${u.name}” cadastrado`, at: created });
    }

    return {
      generatedAt: now,
      year,
      month,
      totals: { researches: researches.length, researchers: researchers.length, inField: teamRows.filter((r) => r.inField).length },
      byStatus,
      activeThisMonth: activeThisMonth.length,
      activePrevMonth: activePrevMonth.length,
      activeByMonth,
      researchersByMonth,
      pins,
      team: { total: teamRows.length, rows: teamRows.slice(0, MAX_TEAM_ROWS) },
      heatmap: { cells, levels, total: heatTotal, outside: heatOutside, peak },
      activities: recentActivities(items),
    };
  }
}
