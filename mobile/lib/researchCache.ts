import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { apiFetch } from "./api";
import type { ResearchPackage } from "./displayRules";
import { SENT_HISTORY_KEY } from "./sentHistory";

const RESEARCHES_CACHE_KEY = 'cached_researches';
const DEVICE_ID_KEY = 'device_id';

export interface Research {
    id: number;
    title: string;
    status: string;
    startDate: string;
    endDate: string;
    targetAudience: string;
    recordInterview?: boolean;
    isDownloaded?: boolean;
    // Situação da cópia DESTE aparelho no servidor (só vem com o X-Device-ID): ACTIVE, RETURNED ou REVOKED.
    copyStatus?: 'ACTIVE' | 'RETURNED' | 'REVOKED' | null;
    // O administrador revogou o acesso deste aparelho a esta pesquisa: não baixa mais.
    revoked?: boolean;
    // Meta do pesquisador nesta pesquisa (nulo = sem meta) e quantas coletas dele o servidor já recebeu,
    // como estavam em `progressSyncedAt` (a última atualização da lista com internet).
    targetCount?: number | null;
    collected?: number;
    // Identificadores (clientId) dessas coletas. Ausente em servidor antigo: aí vale o horário da atualização.
    collectedIds?: string[];
    progressSyncedAt?: string;
    // Área-alvo da pesquisa (centro e raio), quando o administrador definiu uma.
    areaLatitude?: number | null;
    areaLongitude?: number | null;
    areaRadiusKm?: number | null;
}

/** Gera ou recupera um ID único do dispositivo para controle de download */
export async function getDeviceId(): Promise<string> {
    let id = await SecureStore.getItemAsync(DEVICE_ID_KEY);
    if (!id) {
        id = 'device_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
        await SecureStore.setItemAsync(DEVICE_ID_KEY, id);
    }
    return id;
}

/** Apaga o pacote da pesquisa do aparelho (a cópia deixou de valer ou foi devolvida). */
async function removeLocalPackage(id: number): Promise<void> {
    await AsyncStorage.removeItem(`research_pkg_${id}`);
}

/**
 * Atualiza a lista de pesquisas. O servidor informa a situação da cópia deste aparelho: se o administrador
 * revogou (REVOKED) ou ela já consta como devolvida (RETURNED), o pacote local é apagado, para não
 * sobrar versão do formulário circulando fora do controle. Devolve as pesquisas cujo acesso foi revogado agora.
 */
export async function syncResearches(): Promise<Research[]> {
    try {
        // Tirado antes do pedido: o que for enviado depois disto ainda não está na contagem do servidor.
        const syncedAt = new Date().toISOString();
        const response = await apiFetch('/research', { headers: { 'X-Device-ID': await getDeviceId() } });
        if (!response.ok) return [];

        const data: Research[] = await response.json();

        // Mantém a flag 'isDownloaded' para pesquisas que já estão no celular
        const currentCache = await getCachedResearches();
        const downloadedIds = new Set(currentCache.filter(r => r.isDownloaded).map(r => r.id));

        const newlyRevoked: Research[] = [];
        const mergedData: Research[] = [];
        for (const item of data) {
            const wasDownloaded = downloadedIds.has(item.id);
            const copyInvalid = item.copyStatus === 'REVOKED' || item.copyStatus === 'RETURNED';

            if (wasDownloaded && copyInvalid) {
                await removeLocalPackage(item.id);
                if (item.copyStatus === 'REVOKED') newlyRevoked.push(item);
            }

            mergedData.push({
                ...item,
                isDownloaded: wasDownloaded && !copyInvalid,
                revoked: item.copyStatus === 'REVOKED',
                progressSyncedAt: syncedAt,
            });
        }

        await AsyncStorage.setItem(RESEARCHES_CACHE_KEY, JSON.stringify(mergedData));
        return newlyRevoked;
    } catch (error) {
        console.log('Sync de pesquisas falhou:', error);
        return [];
    }
}

/** Lê do aparelho a última lista de pesquisas baixada. */
export async function getCachedResearches(): Promise<Research[]> {
    const json = await AsyncStorage.getItem(RESEARCHES_CACHE_KEY);
    if (!json) return [];

    const list: Research[] = JSON.parse(json);
    return list.filter((item) => item.status !== 'DRAFT');
}

/**
 * Baixa o pacote da pesquisa (questionário e regras), identificando o aparelho, e guarda no
 * aparelho.
 */
export async function downloadResearchPackage(id: number): Promise<void> {
    const deviceId = await getDeviceId();

    // Identifica o aparelho no Header (ou poderia ser no body)
    const response = await apiFetch(`/research/${id}/download`, {
        headers: {
            'X-Device-ID': deviceId
        }
    });

    if (!response.ok) {
        // A API explica o motivo (não vinculado, encerrada, fora da vigência...)
        const body = await response.json().catch(() => null);
        throw new Error(body?.message || 'Falha ao baixar pacote da pesquisa');
    }

    const fullPackage = await response.json();

    // GRAVAÇÃO ATÔMICA: Salva o pacote completo primeiro
    await AsyncStorage.setItem(`research_pkg_${id}`, JSON.stringify(fullPackage));

    // Só marca como baixada se a gravação do pacote der 100% certo
    const list = await getCachedResearches();
    const updatedList = list.map(r => r.id === id ? { ...r, isDownloaded: true } : r);
    await AsyncStorage.setItem(RESEARCHES_CACHE_KEY, JSON.stringify(updatedList));
}

/**
 * Devolve a cópia ao servidor: registra a data, o contador de cópias cai e, quando a última volta, o
 * questionário destrava. Só depois da confirmação do servidor o pacote sai do aparelho.
 * Quem chama confere antes que não há coleta pendente (ver researchReturn.ts).
 */
export async function returnResearchCopy(id: number): Promise<void> {
    const response = await apiFetch(`/research/${id}/return`, {
        method: 'POST',
        headers: { 'X-Device-ID': await getDeviceId() },
    });

    if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.message || 'Não foi possível devolver a pesquisa. Tente de novo com internet.');
    }

    await removeLocalPackage(id);
    const list = await getCachedResearches();
    await AsyncStorage.setItem(
        RESEARCHES_CACHE_KEY,
        JSON.stringify(list.map(r => (r.id === id ? { ...r, isDownloaded: false } : r))),
    );
}

/**
 * Pacote baixado no aparelho (seções, questões, opções e regras de exibição).
 * Pacotes baixados antes das regras existirem não têm `displayRules`: viram lista vazia
 * até a pesquisa ser baixada de novo.
 */
export async function getCachedResearchPackage(id: number): Promise<ResearchPackage | null> {
    const json = await AsyncStorage.getItem(`research_pkg_${id}`);
    if (!json) return null;

    const pkg = JSON.parse(json);
    return { ...pkg, displayRules: pkg.displayRules ?? [] };
}

/** Apaga do aparelho as pesquisas guardadas, os pacotes e o histórico de enviadas. */
export async function clearResearchesCache(): Promise<void> {
    const keys = await AsyncStorage.getAllKeys();
    const researchKeys = keys.filter(k => k.startsWith('research_pkg_') || k === RESEARCHES_CACHE_KEY || k === SENT_HISTORY_KEY);
    if (researchKeys.length > 0) {
        await AsyncStorage.multiRemove(researchKeys);
    }
}
