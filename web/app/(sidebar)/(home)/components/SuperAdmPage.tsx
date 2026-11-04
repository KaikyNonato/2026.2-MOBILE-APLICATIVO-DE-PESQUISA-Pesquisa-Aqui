'use client';

import BannerComponent from "@/components/ui/bannerComponent";
import { Pin } from "@/components/ui/contour";
import { buttonVariants } from "@/components/ui/button";
import { isSessionExpiredError } from "@/lib/apiFetcher";
import { getCompanyStats, type CompanyStats } from "@/lib/company";
import { MONTH_NAMES, type ActivityItem } from "@/lib/dashboard";
import { Building2, Building, History, UserCog } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import ExibirEditar from "../../empresas/components/ExibirExcluir";
import AreaPanel from "./AreaPanel";
import { firstName, greetingFor, monthName, PIN_SLOTS, todayLabel } from "./dashboardUtils";
import HeroPanel from "./HeroPanel";
import InfoCard from "./infoCards";
import StatusPanel from "./StatusPanel";
import UltimasAtualizacoesList from "./UltimasAtualizacoesList";

/**
 * Painel inicial do superadministrador: totais, gráficos e atividades de empresas e
 * administradores.
 */
export default function SuperAdmPage({ userName }: { userName?: string }) {
    // Totais, gráficos e atividades chegam prontos do servidor (nenhuma lista inteira é baixada).
    const [stats, setStats] = useState<CompanyStats | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;

        getCompanyStats()
            .then((data) => {
                if (!cancelled) setStats(data);
            })
            .catch((error) => {
                if (cancelled || isSessionExpiredError(error)) return;
                console.error(error);
                toast.error('Erro ao carregar dados do painel');
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, []);

    const [today] = useState(() => new Date());
    const month = today.getMonth();

    const companiesCount = stats?.companies ?? 0;
    const activeCount = stats?.activeCompanies ?? 0;
    const adminsCount = stats?.admins ?? 0;

    const companiesChart = useMemo(
        () => MONTH_NAMES.map((label, i) => ({ label, value: stats?.companiesByMonth[i] ?? 0 })),
        [stats]
    );

    const adminsChart = useMemo(
        () => MONTH_NAMES.map((label, i) => ({ label, value: stats?.adminsByMonth[i] ?? 0 })),
        [stats]
    );

    const activities: ActivityItem[] = useMemo(
        () => (stats?.activities ?? []).map((a) => ({ ...a, date: new Date(a.date) })),
        [stats]
    );

    const newThisMonth = companiesChart[month]?.value ?? 0;

    const pins = useMemo(
        () =>
            (stats?.recentCompanies ?? [])
                .slice(0, PIN_SLOTS.length)
                .map((c, i) => ({ id: c.id, label: c.legalName, inactive: c.situation !== 'ACTIVE', slot: PIN_SLOTS[i] })),
        [stats]
    );

    const dash = loading ? "–" : undefined;

    return (
        <>
            <BannerComponent
                title="Painel de dados"
                description={todayLabel(today)}
                actions={<Link href="/empresas" className={buttonVariants({ size: "sm" })}>Nova empresa</Link>}
            />

            <HeroPanel
                greeting={`${greetingFor(today)}${userName ? `, ${firstName(userName)}` : ""}. Agora:`}
                value={dash ?? activeCount}
                caption={activeCount === 1 ? "empresa ativa" : "empresas ativas"}
                delta={!loading && newThisMonth > 0 ? `${newThisMonth} ${newThisMonth === 1 ? "nova" : "novas"} em ${monthName(month)}` : undefined}
                minis={[
                    { value: dash ?? companiesCount, label: "empresas cadastradas" },
                    { value: dash ?? adminsCount, label: "administradores" },
                    { value: dash ?? companiesCount - activeCount, label: "empresas inativas" },
                ]}
            >
                {!loading && pins.length === 0 && (
                    <p className="pa-empty absolute inset-0 z-2 px-10 text-[#8ea398]">
                        Nenhuma empresa cadastrada ainda. Cadastre a primeira para vê-la aqui.
                    </p>
                )}
                {pins.map(({ id, label, inactive, slot }) => (
                    <Pin key={id} label={label} left={slot.left} top={slot.top} delay={slot.delay} tone={inactive ? "clay" : "mint"} />
                ))}
            </HeroPanel>

            <section className="pa-bento">
                <AreaPanel
                    cardClassName="pa-c8"
                    icon={<Building2 />}
                    title="Empresas cadastradas por mês"
                    description={<span className="pa-hover-hint">Passe o mouse sobre o gráfico para ver cada mês</span>}
                    data={companiesChart}
                    unit="novas empresas"
                    currentMonth={month}
                />

                <StatusPanel
                    cardClassName="pa-c4"
                    icon={<Building />}
                    title="Situação das empresas"
                    description="Empresas que podem entrar no sistema"
                    highlighted={activeCount}
                    total={companiesCount}
                    caption="empresas ativas"
                    rows={[
                        { label: "Ativas", count: activeCount },
                        { label: "Inativas", count: companiesCount - activeCount, tone: "clay" },
                    ]}
                />

                <InfoCard
                    cardClassName="pa-c4"
                    tone="dark"
                    icon={<History />}
                    cardTitle="Atividade recente"
                    cardDescription="O que mudou nas empresas e administradores"
                    contour={{ seed: 2.8, rings: 10, cx: 0.1, cy: 1.0, size: 1.1, width: 400, height: 520 }}
                    cardContent={<UltimasAtualizacoesList items={activities} loading={loading} />}
                />

                <AreaPanel
                    cardClassName="pa-c8"
                    icon={<UserCog />}
                    title="Administradores cadastrados por mês"
                    data={adminsChart}
                    unit="novos administradores"
                    currentMonth={month}
                />

                <InfoCard
                    cardClassName="pa-c12"
                    icon={<Building2 />}
                    cardTitle="Empresas e administradores"
                    cardDescription="Quem tem acesso e em que situação"
                    CardContentClassName="max-h-[26rem] overflow-y-auto overflow-x-hidden px-1"
                    cardContent={<ExibirEditar allowActions={false} counts={stats ? { companies: stats.companies, activeCompanies: stats.activeCompanies, admins: stats.admins } : undefined} />}
                />
            </section>
        </>
    );
}
