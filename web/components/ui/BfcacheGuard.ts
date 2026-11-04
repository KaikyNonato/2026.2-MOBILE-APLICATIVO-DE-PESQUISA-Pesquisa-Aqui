'use client';

import { useEffect } from "react";

/**
 * Recarrega a página quando o navegador a restaura do cache de voltar/avançar, para não mostrar a
 * tela de uma sessão antiga.
 */
export function BfcacheGuard() {
    useEffect(() => {
        const handlePageShow = (event: PageTransitionEvent) => {
            if (event.persisted) {
                window.location.reload();
            }
        };

        window.addEventListener('pageshow', handlePageShow);

        return () => window.removeEventListener('pageshow', handlePageShow);
    }, []);

    return null;
}
