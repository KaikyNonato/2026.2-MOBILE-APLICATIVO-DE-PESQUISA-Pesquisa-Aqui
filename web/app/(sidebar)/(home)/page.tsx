'use client';

import { useCurrentUser } from "@/hooks/useCurrentUser";
import SuperAdmPage from "./components/SuperAdmPage";
import AdmPage from "./components/AdmPage";
import PesquisadorPage from "./components/PesquisadorPage";

/**
 * Página inicial: mostra o painel do perfil do usuário (superadministrador, administrador ou
 * pesquisador).
 */
export default function Home() {
    const { user } = useCurrentUser();

    if (user?.profile === 'SUPERADMINISTRATOR') return <SuperAdmPage userName={user.name} />;
    if (user?.profile === 'ADMINISTRATOR') return <AdmPage userName={user.name} />;
    if (user?.profile === 'RESEARCHER') return <PesquisadorPage userName={user.name} />;

    return null;
}
