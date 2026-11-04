'use client';

import { AuthUser, getCurrentUser, USER_UPDATED_EVENT } from "@/lib/auth";
import { useEffect, useState } from "react";

/**
 * Carrega o usuário logado (`/auth/me`) e o recarrega quando o perfil é editado. Devolve `{ user,
 * loading }`.
 */
export function useCurrentUser() {
    const [user, setUser] = useState<AuthUser | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        const load = () => {
            getCurrentUser()
                .then((current) => { if (!cancelled) setUser(current); })
                .finally(() => { if (!cancelled) setLoading(false); });
        };

        load();
        // Perfil editado (nome/usuário): atualiza quem mostra o nome do usuário, como o menu lateral.
        window.addEventListener(USER_UPDATED_EVENT, load);

        return () => {
            cancelled = true;
            window.removeEventListener(USER_UPDATED_EVENT, load);
        };
    }, []);

    return { user, loading };
}
