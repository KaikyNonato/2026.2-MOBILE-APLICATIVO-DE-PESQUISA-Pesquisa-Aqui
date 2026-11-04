import AsyncStorage from '@react-native-async-storage/async-storage';

// Histórico de coletas enviadas (aparelho). Quando o servidor confirma, a coleta sai da fila e do aparelho;
// aqui fica só o registro de que ela chegou: o pesquisador vê o que já enviou, mesmo sem internet.
// Guarda apenas os dados mínimos (nunca as respostas) e os mais recentes, para não crescer sem limite.
export const SENT_HISTORY_KEY = 'sent_history';
const MAX_RECORDS = 1000;

export interface SentRecord {
    clientId: string;
    researchId: number;
    startedAt: string; // ISO 8601
    finishedAt?: string; // ISO 8601
    sentAt: string; // ISO 8601: quando o servidor confirmou
}

/** Lê o histórico de coletas enviadas (lista vazia se faltar ou for inválido). */
async function read(): Promise<SentRecord[]> {
    const json = await AsyncStorage.getItem(SENT_HISTORY_KEY);
    if (!json) return [];
    try {
        const list = JSON.parse(json);
        return Array.isArray(list) ? (list as SentRecord[]) : [];
    } catch {
        return [];
    }
}

/** Enviadas, a mais recente primeiro. */
export async function listSent(): Promise<SentRecord[]> {
    return (await read()).sort((a, b) => b.sentAt.localeCompare(a.sentAt));
}

/** Registra a coleta confirmada. Registrar a mesma coleta de novo (reenvio "já existia") não duplica. */
export async function recordSent(record: SentRecord): Promise<void> {
    const list = (await read()).filter((item) => item.clientId !== record.clientId);
    list.push(record);
    list.sort((a, b) => b.sentAt.localeCompare(a.sentAt));
    await AsyncStorage.setItem(SENT_HISTORY_KEY, JSON.stringify(list.slice(0, MAX_RECORDS)));
}
