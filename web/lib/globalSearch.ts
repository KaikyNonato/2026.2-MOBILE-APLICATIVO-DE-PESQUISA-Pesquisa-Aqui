import { getCollectionsPage, type CollectionSummary } from "./collection";
import { getCompaniesPage, type CompanyItem } from "./company";
import type { Page } from "./pagination";
import { getResearchesPage, type Research, type ResearchListItem } from "./research";
import { getAdminsPage, getResearchersPage, type UserItem } from "./user";

/**
 * Buscador global: reúne em uma lista única as páginas do painel e os registros
 * que o perfil logado pode ver (pesquisas, pesquisadores, empresas, administradores)
 * Os registros vêm do servidor já filtrados pelo texto digitado, em páginas de até 100 (todas as
 * páginas são buscadas, então nenhum resultado fica de fora); o navegador só ordena e destaca, sem acento e sem diferenciar maiúsculas.
 */

export type SearchProfile = "SUPERADMINISTRATOR" | "ADMINISTRATOR" | "RESEARCHER";

export type SearchKind = "page" | "research" | "collection" | "researcher" | "company" | "admin";

export interface SearchEntry {
    /** Identificador único (ex.: "research:12"). */
    key: string;
    kind: SearchKind;
    title: string;
    /** Linha menor abaixo do título. */
    subtitle?: string;
    /** Texto adicional que também é pesquisado, mas não aparece. */
    extra?: string;
    /** Número que, digitado por inteiro (ex.: "12" ou "#12"), põe o resultado no topo. */
    code?: string;
    href: string;
    /** Rótulo da situação (ex.: "Em campo"), mostrado como selo. */
    badge?: string;
    badgeTone?: "live" | "draft" | "closed" | "off";
}

export const KIND_LABELS: Record<SearchKind, string> = {
    page: "Páginas",
    research: "Pesquisas",
    collection: "Coletas",
    researcher: "Pesquisadores",
    company: "Empresas",
    admin: "Administradores",
};

/** Ordem em que os grupos aparecem nos resultados. */
export const KIND_ORDER: SearchKind[] = ["page", "research", "collection", "researcher", "company", "admin"];

const STATUS_LABELS: Record<Research["status"], { label: string; tone: SearchEntry["badgeTone"] }> = {
    DRAFT: { label: "Rascunho", tone: "draft" },
    PUBLISHED: { label: "Publicada", tone: "live" },
    IN_FIELD: { label: "Em campo", tone: "live" },
    CLOSED: { label: "Encerrada", tone: "closed" },
};

/* ------------------------------------------------------------------
   Carregamento dos registros
   ------------------------------------------------------------------ */

const CACHE_TTL_MS = 60_000;
/** Tamanho de cada requisição (o máximo que a API aceita): os resultados vêm em páginas até acabarem. */
const FETCH_PAGE_SIZE = 100;
/** Trava de segurança: no máximo 50 páginas (5.000 registros) por fonte em uma busca. */
const MAX_PAGES = 50;
/** Quantas pesquisas têm as coletas consultadas ao mesmo tempo. */
const COLLECTION_CONCURRENCY = 4;

/** Junta TODAS as páginas de uma consulta paginada (a API entrega no máximo 100 por vez). */
async function fetchAllPages<T>(load: (page: number) => Promise<Page<T>>): Promise<T[]> {
    const first = await load(1);
    const items = [...first.items];
    const lastPage = Math.min(first.totalPages, MAX_PAGES);
    if (lastPage > 1) {
        const rest = await Promise.all(Array.from({ length: lastPage - 1 }, (_, i) => load(i + 2)));
        for (const page of rest) items.push(...page.items);
    }
    return items;
}

const cache = new Map<string, { entries: SearchEntry[]; at: number }>();
const inFlight = new Map<string, Promise<SearchEntry[]>>();

/** Monta o item de busca de uma pesquisa. */
const researchEntry = (r: Research): SearchEntry => {
    const status = STATUS_LABELS[r.status];
    return {
        key: `research:${r.id}`,
        kind: "research",
        title: r.title,
        subtitle: r.objective || r.description || undefined,
        extra: [r.description, r.targetAudience, status?.label].filter(Boolean).join(" "),
        href: `/pesquisas/${r.id}`,
        badge: status?.label,
        badgeTone: status?.tone,
    };
};

/** Completa o número com zero à esquerda (2 dígitos). */
const pad = (n: number) => String(n).padStart(2, "0");

/** Formata data e hora como dd/mm/aaaa hh:mm (texto vazio se a data for inválida). */
const formatDateTime = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** Monta o item de busca de uma coleta, ligada à pesquisa dela. */
const collectionEntry = (c: CollectionSummary, research: Research): SearchEntry => {
    const when = formatDateTime(c.finishedAt || c.startedAt);
    return {
        key: `collection:${c.id}`,
        kind: "collection",
        title: `Coleta #${c.id}`,
        subtitle: [research.title, c.researcherName, when].filter(Boolean).join(" · "),
        extra: `${c.researcherName ?? ""} ${research.title}`,
        code: String(c.id),
        // Abre a pesquisa já na aba de coletas e com esta coleta aberta.
        href: `/pesquisas/${research.id}?aba=coletas&coleta=${c.id}`,
    };
};

/** Monta o item de busca de um pesquisador. */
const researcherEntry = (u: UserItem): SearchEntry => ({
    key: `researcher:${u.id}`,
    kind: "researcher",
    title: u.name,
    subtitle: `@${u.username}`,
    extra: u.username,
    href: "/pesquisadores",
});

/** Monta o item de busca de um administrador. */
const adminEntry = (u: UserItem): SearchEntry => ({
    key: `admin:${u.id}`,
    kind: "admin",
    title: u.name,
    subtitle: `@${u.username}`,
    extra: u.username,
    href: "/administradores",
});

/** Monta o item de busca de uma empresa. */
const companyEntry = (c: CompanyItem): SearchEntry => ({
    key: `company:${c.id}`,
    kind: "company",
    title: c.legalName,
    subtitle: c.contactInformation || undefined,
    extra: c.situation === "ACTIVE" ? "ativa" : "inativa",
    href: "/empresas",
    badge: c.situation === "ACTIVE" ? "Ativa" : "Inativa",
    badgeTone: c.situation === "ACTIVE" ? "live" : "off",
});

/**
 * Carrega os itens da busca global conforme o perfil. Cada fonte é independente: se uma falhar, as
 * outras continuam.
 */
async function fetchEntries(profile: SearchProfile, query: string): Promise<SearchEntry[]> {
    // Cada fonte é independente: se uma falhar, as outras continuam aparecendo.
    const settled = async <T>(promise: Promise<T>, fallback: T): Promise<T> => {
        try {
            return await promise;
        } catch (error) {
            if (error instanceof Error && error.message === "Session expired") throw error;
            console.error("Busca global: falha ao carregar uma fonte", error);
            return fallback;
        }
    };

    // Pesquisador não abre a página de uma pesquisa (é do administrador): o resultado leva para a lista dele.
    const mine = (entry: SearchEntry): SearchEntry => (profile === "RESEARCHER" ? { ...entry, href: "/pesquisas" } : entry);

    // O servidor procura o texto inteiro; com várias palavras mandamos a mais longa e o navegador confere as demais.
    const q = longestToken(query);
    const list = <T,>(load: (params: { page: number; pageSize: number; q: string; sort: "recent" }) => Promise<Page<T>>) =>
        settled(fetchAllPages((page) => load({ page, pageSize: FETCH_PAGE_SIZE, q, sort: "recent" })), [] as T[]);

    // Sem texto não há o que procurar: só as 4 pesquisas mais recentes, para o usuário ter por onde começar.
    if (!q) {
        if (profile === "SUPERADMINISTRATOR") return [];
        const recent = await settled(getResearchesPage({ page: 1, pageSize: 4, sort: "recent" }), null);
        return (recent?.items ?? []).map(researchEntry).map(mine);
    }

    if (profile === "SUPERADMINISTRATOR") {
        const [companies, admins] = await Promise.all([list(getCompaniesPage), list(getAdminsPage)]);
        return [...companies.map(companyEntry), ...admins.map(adminEntry)];
    }

    if (profile === "ADMINISTRATOR") {
        const [researches, researchers] = await Promise.all([list(getResearchesPage), list(getResearchersPage)]);

        // Coletas: a API lista por pesquisa, então consulta todas as pesquisas fora de rascunho
        // (rascunho não recebe coletas), poucas por vez, e junta tudo o que combina com o texto.
        const collections: SearchEntry[] = [];
        if (q.length >= 1) {
            const everything = await settled(
                fetchAllPages((page) => getResearchesPage({ page, pageSize: FETCH_PAGE_SIZE, sort: "recent" })),
                [] as ResearchListItem[],
            );
            const targets = everything.filter((r) => r.status !== "DRAFT");

            for (let i = 0; i < targets.length; i += COLLECTION_CONCURRENCY) {
                const batch = targets.slice(i, i + COLLECTION_CONCURRENCY);
                const results = await Promise.allSettled(
                    batch.map((r) => fetchAllPages((page) => getCollectionsPage(r.id, { page, pageSize: FETCH_PAGE_SIZE, q }))),
                );
                results.forEach((result, j) => {
                    if (result.status === "rejected") {
                        if (result.reason instanceof Error && result.reason.message === "Session expired") throw result.reason;
                        return;
                    }
                    for (const c of result.value) collections.push(collectionEntry(c, batch[j]));
                });
            }
        }

        return [...researches.map(researchEntry), ...researchers.map(researcherEntry), ...collections];
    }

    return (await list(getResearchesPage)).map(researchEntry).map(mine);
}

/** A palavra mais longa do texto (sem "#"): é a que mais restringe a consulta ao servidor. */
const longestToken = (query: string) =>
    query
        .trim()
        .split(/\s+/)
        .map((token) => token.replace(/^#+/, ""))
        .sort((a, b) => b.length - a.length)[0] ?? "";

/**
 * Registros do perfil que combinam com o texto (poucos por tipo). Sem texto, devolve as pesquisas mais recentes.
 * Reaproveita por 1 minuto a mesma busca.
 */
export function loadSearchEntries(profile: SearchProfile, query = ""): Promise<SearchEntry[]> {
    const key = `${profile}|${query.trim().toLowerCase()}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return Promise.resolve(hit.entries);

    const pending = inFlight.get(key);
    if (pending) return pending;

    const promise = fetchEntries(profile, query)
        .then((entries) => {
            cache.set(key, { entries, at: Date.now() });
            return entries;
        })
        .finally(() => {
            inFlight.delete(key);
        });
    inFlight.set(key, promise);
    return promise;
}

/** Descarta o cache (útil ao sair da conta ou depois de cadastrar algo). */
export function clearSearchCache() {
    cache.clear();
}

/* ------------------------------------------------------------------
   Busca
   ------------------------------------------------------------------ */

/** Minúsculas e sem acento, mantendo o mapa de posições para destacar o texto original. */
function fold(text: string): { folded: string; map: number[] } {
    let folded = "";
    const map: number[] = [];
    let index = 0;
    for (const char of text) {
        const plain = char.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
        for (let i = 0; i < plain.length; i += 1) map.push(index);
        folded += plain;
        index += char.length;
    }
    return { folded, map };
}

/** Texto sem acento e em minúsculas, para comparar buscas. */
export const normalizeText = (text: string) => fold(text).folded;

/** "#12" vale como "12": o número da coleta aparece com "#" na tela. */
const tokensOf = (query: string) =>
    normalizeText(query)
        .split(/\s+/)
        .map((token) => token.replace(/^#+/, ""))
        .filter(Boolean);

/** 0 = não encontrou. Início do texto > início de palavra > meio do texto. */
function scoreField(folded: string, token: string): number {
    const at = folded.indexOf(token);
    if (at < 0) return 0;
    if (at === 0) return 100;
    const before = folded[at - 1];
    return /[\s\-_./@(#]/.test(before) ? 70 : 40;
}

export interface SearchResult {
    entry: SearchEntry;
    score: number;
}

/**
 * Todas as palavras digitadas precisam aparecer (no título, no subtítulo ou no texto extra).
 * O título pesa mais que o resto, e as páginas ganham um pequeno impulso.
 */
export function searchEntries(entries: SearchEntry[], query: string, perKind = Number.POSITIVE_INFINITY): SearchResult[] {
    const tokens = tokensOf(query);
    if (tokens.length === 0) return [];

    const results: SearchResult[] = [];
    for (const entry of entries) {
        const title = normalizeText(entry.title);
        const subtitle = normalizeText(entry.subtitle ?? "");
        const extra = normalizeText(entry.extra ?? "");

        let total = 0;
        let matchedAll = true;
        for (const token of tokens) {
            const inTitle = scoreField(title, token);
            const best = Math.max(
                inTitle * 3,
                scoreField(subtitle, token) * 1.5,
                scoreField(extra, token)
            );
            if (best === 0) {
                matchedAll = false;
                break;
            }
            total += best;
        }
        if (!matchedAll) continue;

        if (title === tokens.join(" ")) total += 200;
        if (entry.code && tokens.includes(entry.code)) total += 300;
        if (entry.kind === "page") total += 15;
        results.push({ entry, score: total });
    }

    results.sort(
        (a, b) => b.score - a.score || a.entry.title.localeCompare(b.entry.title, "pt-BR")
    );

    // Sem limite por padrão: todos os registros que combinam aparecem (`perKind` só serve para quem quiser cortar).
    const taken: Record<string, number> = {};
    const limited = results.filter(({ entry }) => {
        taken[entry.kind] = (taken[entry.kind] ?? 0) + 1;
        return taken[entry.kind] <= perKind;
    });

    // Reagrupa na ordem fixa dos grupos, mantendo a ordem de relevância dentro de cada um.
    return KIND_ORDER.flatMap((kind) => limited.filter((r) => r.entry.kind === kind));
}

/** Trechos do texto original que casam com a busca, para destacar. */
export function highlightRanges(text: string, query: string): Array<[number, number]> {
    const tokens = tokensOf(query);
    if (tokens.length === 0 || !text) return [];

    const { folded, map } = fold(text);
    const ranges: Array<[number, number]> = [];

    for (const token of tokens) {
        let from = 0;
        for (; ;) {
            const at = folded.indexOf(token, from);
            if (at < 0) break;
            const start = map[at];
            const lastChar = map[at + token.length - 1];
            // O fim é o começo do caractere seguinte no texto original.
            const end = at + token.length < map.length ? map[at + token.length] : text.length;
            ranges.push([start, Math.max(end, lastChar + 1)]);
            from = at + token.length;
        }
    }

    // Junta trechos que se sobrepõem.
    ranges.sort((a, b) => a[0] - b[0]);
    const merged: Array<[number, number]> = [];
    for (const range of ranges) {
        const last = merged[merged.length - 1];
        if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
        else merged.push([range[0], range[1]]);
    }
    return merged;
}
