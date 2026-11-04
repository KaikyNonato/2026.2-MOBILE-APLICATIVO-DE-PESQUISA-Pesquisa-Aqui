"use client";

import { useCallback, useState } from "react";

/**
 * Controla "quais linhas estão ocupadas" quando várias ações podem rodar ao mesmo tempo.
 * Um único id (`useState<number | null>`) perde a animação da 1ª linha ao clicar na 2ª;
 * aqui cada id entra e sai do conjunto de forma independente.
 *
 *   const busy = useBusySet<string>()
 *   busy.start(id); try { await ... } finally { busy.stop(id) }
 *   busy.has(id)  // true enquanto a ação daquela linha roda
 */
export function useBusySet<T extends string | number>() {
    const [ids, setIds] = useState<ReadonlySet<T>>(() => new Set());

    const start = useCallback((id: T) => {
        setIds((prev) => new Set(prev).add(id));
    }, []);

    const stop = useCallback((id: T) => {
        setIds((prev) => {
            if (!prev.has(id)) return prev;
            const next = new Set(prev);
            next.delete(id);
            return next;
        });
    }, []);

    const has = useCallback((id: T) => ids.has(id), [ids]);

    return { ids, has, start, stop };
}
