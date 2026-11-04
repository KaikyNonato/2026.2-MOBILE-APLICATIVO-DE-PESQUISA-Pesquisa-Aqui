'use client';

import BannerComponent from "@/components/ui/bannerComponent";
import DialogLayout from "@/components/ui/dialogLayout";
import { Button } from "@/components/ui/button";
import { CountUp } from "@/components/ui/count-up";
import { isSessionExpiredError } from "@/lib/apiFetcher";
import { getCompanyStats, type CompanyStats } from "@/lib/company";
import { getAdminsPage } from "@/lib/user";
import { monthsToChart } from "@/lib/dashboard";
import { ArrowUpRight, CalendarPlus, RefreshCw, UserPlus, UsersRound } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import InfoCard from "../(home)/components/infoCards";
import { useCurrentUser } from "@/hooks/useCurrentUser";

import { Chart } from "../(home)/components/grafico";
import CadastrarAdministradorForm from "../empresas/components/CadastrarAdministradorForm";
import ListaAdministradores from "./components/ListaAdministradores";

/** Página de administradores: cadastro e lista. */
export default function AdministradoresPage() {
    const { user } = useCurrentUser();
    const isSuperAdmin = user?.profile === 'SUPERADMINISTRATOR';

    // Só os números e o gráfico vêm para cá; a lista é paginada dentro de <ListaAdministradores>.
    const [companyStats, setCompanyStats] = useState<CompanyStats | null>(null);
    const [inactiveAdmins, setInactiveAdmins] = useState(0);
    const [loadingData, setLoadingData] = useState(true);
    const [reloadKey, setReloadKey] = useState(0);

    const loadStats = useCallback(() => {
        // Os totais vêm das estatísticas; os inativos são só a contagem de uma página de 1 item.
        Promise.all([
            getCompanyStats(),
            getAdminsPage({ page: 1, pageSize: 1, situation: 'INACTIVE' }),
        ])
            .then(([stats, inactive]) => {
                setCompanyStats(stats);
                setInactiveAdmins(inactive.total);
            })
            .catch((error) => {
                if (isSessionExpiredError(error)) return;
                console.error(error);
                toast.error('Erro ao carregar dados dos administradores');
            })
            .finally(() => setLoadingData(false));
    }, []);

    const reloadData = useCallback(() => {
        setLoadingData(true);
        setReloadKey((k) => k + 1);
    }, []);

    useEffect(() => {
        if (!isSuperAdmin) return;
        loadStats();
    }, [isSuperAdmin, loadStats, reloadKey]);

    const year = companyStats?.year ?? new Date().getFullYear();
    const adminsChart = monthsToChart(companyStats?.adminsByMonth ?? [], 'Administradores');
    const newThisYear = (companyStats?.adminsByMonth ?? []).reduce((sum, n) => sum + n, 0);

    const companies = companyStats?.companies ?? 0;
    const admins = companyStats?.admins ?? 0;
    const inactive = Math.min(inactiveAdmins, admins);
    const active = admins - inactive;
    const activePct = admins ? (active / admins) * 100 : 0;
    const perCompany = companies ? (admins / companies).toFixed(1).replace('.', ',') : '0';

    const val = (n: number | string) => (loadingData ? "–" : n);

    return (
        <section className="flex flex-col gap-5">
            <BannerComponent
                title="Administradores"
                description="Cadastre os administradores que respondem pelas empresas."
                actions={
                    isSuperAdmin && (
                        <DialogLayout
                            triggerButtonSize="sm"
                            dialogTrigger={<><UserPlus />Novo administrador</>}
                            dialogTitle="Novo administrador"
                            dialogDescription="Informe os dados de acesso do administrador."
                            dialogContent={(close) => (
                                <CadastrarAdministradorForm
                                    onSuccess={() => {
                                        reloadData();
                                        close();
                                    }}
                                />
                            )}
                        />
                    )
                }
            />

            <section className="pa-bento" style={{ marginTop: 0 }}>
                {/* Painel principal: quantas pessoas respondem pelas empresas. */}
                <InfoCard
                    cardClassName="pa-c8"
                    animationDelayN={1}
                    tone="dark"
                    contour={{ seed: 5, rings: 13, cx: 0.92, cy: 0.2, size: 1.1 }}
                    icon={<UsersRound />}
                    cardTitle="Administradores na plataforma"
                    cardDescription="Cada empresa é gerida por quem está aqui"
                    cardContent={
                        <div className="flex flex-col gap-7">
                            <div className="flex items-end gap-4">
                                <p className="pa-stat text-[var(--fg-dark)]" style={{ fontSize: 88 }}>
                                    <CountUp value={val(admins)} />
                                </p>
                                <p className="pb-2 text-sm text-[var(--muted-dark)]">
                                    {admins === 1 ? 'administrador cadastrado' : 'administradores cadastrados'}
                                </p>
                            </div>

                            <div>
                                <div
                                    className="flex h-3 gap-1 overflow-hidden rounded-full bg-white/10"
                                    role="img"
                                    aria-label={`${active} de ${admins} administradores ativos`}
                                >
                                    <div
                                        className="h-full rounded-full bg-[var(--mint)] transition-all duration-700"
                                        style={{ width: `${loadingData ? 0 : activePct}%` }}
                                    />
                                    {!loadingData && inactive > 0 && (
                                        <div className="h-full flex-1 rounded-full bg-[var(--clay)]" />
                                    )}
                                </div>

                                <dl className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3 sm:gap-0 sm:divide-x sm:divide-white/10">
                                    <div className="sm:pr-5">
                                        <dt className="flex items-center gap-2 text-xs text-[var(--muted-dark)]">
                                            <i className="size-2 rounded-full bg-[var(--mint)]" />
                                            Ativos
                                        </dt>
                                        <dd className="mt-1 text-2xl font-light tabular-nums"><CountUp value={val(active)} /></dd>
                                    </div>
                                    <div className="sm:px-5">
                                        <dt className="flex items-center gap-2 text-xs text-[var(--muted-dark)]">
                                            <i className="size-2 rounded-full bg-[var(--clay)]" />
                                            Inativos
                                        </dt>
                                        <dd className="mt-1 text-2xl font-light tabular-nums"><CountUp value={val(inactive)} /></dd>
                                        <p className="mt-0.5 text-xs text-[var(--muted-dark)]">
                                            {!loadingData && inactive === 0 ? 'Nenhum administrador bloqueado' : 'Sem acesso ao sistema'}
                                        </p>
                                    </div>
                                    <div className="sm:pl-5">
                                        <dt className="text-xs text-[var(--muted-dark)]">Empresas</dt>
                                        <dd className="mt-1 text-2xl font-light tabular-nums"><CountUp value={val(companies)} /></dd>
                                        <p className="mt-0.5 text-xs text-[var(--muted-dark)]">
                                            {loadingData ? '…' : `${perCompany} por empresa, em média`}
                                        </p>
                                        <Link
                                            href="/empresas"
                                            className="mt-0.5 inline-flex items-center gap-0.5 rounded text-xs font-medium text-[var(--mint)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mint)]"
                                        >
                                            Ver empresas
                                            <ArrowUpRight size={13} />
                                        </Link>
                                    </div>
                                </dl>
                            </div>
                        </div>
                    }
                />

                <InfoCard
                    cardClassName="pa-c4"
                    animationDelayN={2}
                    tone="mint"
                    icon={<CalendarPlus />}
                    cardTitle="Novos administradores"
                    cardDescription={
                        loadingData
                            ? `Cadastros em ${year}`
                            : `${newThisYear} ${newThisYear === 1 ? 'cadastro' : 'cadastros'} em ${year}`
                    }
                    cardContent={
                        <Chart variant="bar" data={adminsChart} seriesKey="Administradores" seriesLabel="Administradores cadastrados" />
                    }
                />

                <InfoCard
                    cardClassName="pa-c12"
                    animationDelayN={3}
                    icon={<UsersRound />}
                    cardTitle={
                        <span className="inline-flex items-center gap-2.5">
                            Administradores cadastrados
                            {!loadingData && (
                                <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold tabular-nums text-[var(--green-deep)]">
                                    {admins}
                                </span>
                            )}
                        </span>
                    }
                    cardDescription="Edite os dados, desative o acesso ou exclua o administrador."
                    cardAction={
                        <Button variant="outline" size="sm" onClick={reloadData} disabled={loadingData}>
                            <RefreshCw size={14} className={loadingData ? 'animate-spin' : ''} />
                            Atualizar
                        </Button>
                    }
                    cardContent={
                        <ListaAdministradores
                            reloadKey={reloadKey}
                            onAdminDeleted={loadStats}
                            onAdminUpdated={loadStats}
                        />
                    }
                />
            </section>
        </section>
    );
}
