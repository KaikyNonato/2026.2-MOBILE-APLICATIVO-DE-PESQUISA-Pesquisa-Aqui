'use client';

import BannerComponent from "@/components/ui/bannerComponent";
import DialogLayout from "@/components/ui/dialogLayout";
import { Button } from "@/components/ui/button";
import { CountUp } from "@/components/ui/count-up";
import { isSessionExpiredError } from "@/lib/apiFetcher";
import { getCompanyStats, type CompanyStats } from "@/lib/company";
import { monthsToChart } from "@/lib/dashboard";
import { ArrowUpRight, Building2, CalendarPlus, Plus, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import InfoCard from "../(home)/components/infoCards";
import { useCurrentUser } from "@/hooks/useCurrentUser";

import { Chart } from "../(home)/components/grafico";
import CadastrarEmpresaForm from "./components/CadastrarEmpresaForm";
import ListaEmpresas from "./components/ListaEmpresas";

/** Página de empresas: cadastros e lista, com as ações liberadas conforme o perfil. */
export default function EmpresaPage() {
    const { user } = useCurrentUser();
    const isSuperAdmin = user?.profile === 'SUPERADMINISTRATOR';

    // Só os números e o gráfico vêm para cá; a lista é paginada dentro de <ListaEmpresas>.
    const [companyStats, setCompanyStats] = useState<CompanyStats | null>(null);
    const [loadingData, setLoadingData] = useState(true);
    const [reloadKey, setReloadKey] = useState(0);

    const loadStats = useCallback(() => {
        getCompanyStats()
            .then(setCompanyStats)
            .catch((error) => {
                if (isSessionExpiredError(error)) return;
                console.error(error);
                toast.error('Erro ao carregar dados das empresas');
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
    const companiesChart = monthsToChart(companyStats?.companiesByMonth ?? [], 'Empresas');
    const newThisYear = (companyStats?.companiesByMonth ?? []).reduce((sum, n) => sum + n, 0);

    const total = companyStats?.companies ?? 0;
    const active = companyStats?.activeCompanies ?? 0;
    const inactive = total - active;
    const admins = companyStats?.admins ?? 0;
    const activePct = total ? (active / total) * 100 : 0;

    const val = (n: number) => (loadingData ? "–" : n);

    return (
        <section className="flex flex-col gap-5">
            <BannerComponent
                title="Empresas"
                description="Cadastre e acompanhe as empresas que usam a plataforma."
                actions={
                    isSuperAdmin && (
                        <DialogLayout
                            triggerButtonSize="sm"
                            dialogTrigger={<><Plus />Nova empresa</>}
                            dialogTitle="Nova empresa"
                            dialogDescription="Informe os dados da empresa."
                            dialogContent={(close) => (
                                <CadastrarEmpresaForm
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
                {/* Painel principal: quantas empresas existem e quantas podem coletar agora. */}
                <InfoCard
                    cardClassName="pa-c8"
                    animationDelayN={1}
                    tone="dark"
                    contour={{ seed: 3, rings: 13, cx: 0.92, cy: 0.2, size: 1.1 }}
                    icon={<Building2 />}
                    cardTitle="Empresas na plataforma"
                    cardDescription="Só as ativas podem coletar com o aplicativo"
                    cardContent={
                        <div className="flex flex-col gap-7">
                            <div className="flex items-end gap-4">
                                <p className="pa-stat text-[var(--fg-dark)]" style={{ fontSize: 88 }}>
                                    <CountUp value={val(total)} />
                                </p>
                                <p className="pb-2 text-sm text-[var(--muted-dark)]">
                                    {total === 1 ? 'empresa cadastrada' : 'empresas cadastradas'}
                                </p>
                            </div>

                            <div>
                                <div
                                    className="flex h-3 gap-1 overflow-hidden rounded-full bg-white/10"
                                    role="img"
                                    aria-label={`${active} de ${total} empresas ativas`}
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
                                            Ativas
                                        </dt>
                                        <dd className="mt-1 text-2xl font-light tabular-nums"><CountUp value={val(active)} /></dd>
                                    </div>
                                    <div className="sm:px-5">
                                        <dt className="flex items-center gap-2 text-xs text-[var(--muted-dark)]">
                                            <i className="size-2 rounded-full bg-[var(--clay)]" />
                                            Inativas
                                        </dt>
                                        <dd className="mt-1 text-2xl font-light tabular-nums"><CountUp value={val(inactive)} /></dd>
                                        <p className="mt-0.5 text-xs text-[var(--muted-dark)]">
                                            {!loadingData && inactive === 0 ? 'Nenhuma empresa bloqueada' : 'Sem acesso ao aplicativo'}
                                        </p>
                                    </div>
                                    <div className="sm:pl-5">
                                        <dt className="text-xs text-[var(--muted-dark)]">Administradores</dt>
                                        <dd className="mt-1 text-2xl font-light tabular-nums"><CountUp value={val(admins)} /></dd>
                                        <Link
                                            href="/administradores"
                                            className="mt-0.5 inline-flex items-center gap-0.5 rounded text-xs font-medium text-[var(--mint)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mint)]"
                                        >
                                            Ver administradores
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
                    cardTitle="Novas empresas"
                    cardDescription={
                        loadingData
                            ? `Cadastros em ${year}`
                            : `${newThisYear} ${newThisYear === 1 ? 'cadastro' : 'cadastros'} em ${year}`
                    }
                    cardContent={
                        <Chart variant="bar" data={companiesChart} seriesKey="Empresas" seriesLabel="Empresas cadastradas" />
                    }
                />

                <InfoCard
                    cardClassName="pa-c12"
                    animationDelayN={3}
                    icon={<Building2 />}
                    cardTitle={
                        <span className="inline-flex items-center gap-2.5">
                            Empresas cadastradas
                            {!loadingData && (
                                <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold tabular-nums text-[var(--green-deep)]">
                                    <CountUp value={total} />
                                </span>
                            )}
                        </span>
                    }
                    cardDescription="Edite os dados, desative o acesso ou exclua a empresa."
                    cardAction={
                        <Button variant="outline" size="sm" onClick={reloadData} disabled={loadingData}>
                            <RefreshCw size={14} className={loadingData ? 'animate-spin' : ''} />
                            Atualizar
                        </Button>
                    }
                    cardContent={
                        <ListaEmpresas
                            reloadKey={reloadKey}
                            counts={companyStats ? { companies: companyStats.companies, activeCompanies: companyStats.activeCompanies } : undefined}
                            onCompanyUpdated={loadStats}
                            onCompanyDeleted={loadStats}
                        />
                    }
                />
            </section>
        </section>
    );
}
