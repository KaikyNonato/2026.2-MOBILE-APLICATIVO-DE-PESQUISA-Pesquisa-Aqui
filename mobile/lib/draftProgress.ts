import type { LocalCollection } from './collectionStore';
import { getVisibleQuestionIds, isAnswerEmpty } from './displayRules';
import { getCachedResearchPackage } from './researchCache';

export interface DraftProgress {
    /** Questões visíveis que já têm resposta. */
    answered: number;
    /** Questões que a pessoa precisa percorrer, já descontadas as escondidas pelas regras de exibição. */
    total: number;
}

/** Progresso de cada rascunho (por clientId), calculado com o pacote da pesquisa guardado no aparelho. */
export async function getDraftsProgress(drafts: LocalCollection[]): Promise<Record<string, DraftProgress>> {
    const packages = new Map<number, Awaited<ReturnType<typeof getCachedResearchPackage>>>();
    const result: Record<string, DraftProgress> = {};

    for (const draft of drafts) {
        if (!packages.has(draft.researchId)) {
            packages.set(draft.researchId, await getCachedResearchPackage(draft.researchId).catch(() => null));
        }
        const pkg = packages.get(draft.researchId);
        if (!pkg) continue; // sem o pacote não dá para contar: a tela mostra só a data

        const visible = getVisibleQuestionIds(pkg, draft.answers);
        const answered = [...visible].filter((id) => !isAnswerEmpty(draft.answers[id])).length;
        result[draft.clientId] = { answered, total: visible.size };
    }
    return result;
}

/** "agora há pouco", "há 12 min", "há 3 h", "ontem", ou a data. Sem depender de Intl.RelativeTimeFormat (nem todo Hermes tem). */
export function formatRelativeTime(iso: string, now: number = Date.now()): string {
    const time = new Date(iso).getTime();
    if (Number.isNaN(time)) return '—';
    const minutes = Math.floor((now - time) / 60_000);
    if (minutes < 1) return 'agora há pouco';
    if (minutes < 60) return `há ${minutes} min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `há ${hours} h`;
    const days = Math.floor(hours / 24);
    if (days === 1) return 'ontem';
    if (days < 7) return `há ${days} dias`;
    return new Date(time).toLocaleDateString('pt-BR');
}
