'use client';

import BannerComponent from "@/components/ui/bannerComponent";
import { Pin } from "@/components/ui/contour";
import { buttonVariants } from "@/components/ui/button";
import { TableTabs } from "@/components/ui/data-table";
import { isSessionExpiredError } from "@/lib/apiFetcher";
import { useFieldSnapshot } from "@/hooks/useFieldSnapshot";
import { MONTH_NAMES, type ActivityItem } from "@/lib/dashboard";
import { teamRowsOf } from "@/lib/fieldData";
import { getResearcherStats, type ResearcherStats } from "@/lib/user";
import { CalendarClock, ClipboardList, Clock, History, NotebookPen, Target, UsersRound } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import ListaPesquisadores from "../../pesquisadores/components/ListaPesquisadores";
import AreaPanel from "./AreaPanel";
import { firstName, greetingFor, monthName, PIN_SLOTS, todayLabel } from "./dashboardUtils";
import EquipePanel from "./EquipePanel";
import HeatmapPanel from "./HeatmapPanel";
import HeroPanel from "./HeroPanel";
import InfoCard from "./infoCards";
import PesquisasEquipeTabela from "./PesquisasEquipeTabela";
import StatusPanel from "./StatusPanel";
import UltimasAtualizacoesList from "./UltimasAtualizacoesList";

const DAY_MS = 24 * 60 * 60 * 1000;

type TeamTab = "pesquisas" | "pesquisadores";

/**
 * Painel inicial do administrador: totais, gráficos, equipe e mapa de calor, calculados no
 * servidor.
 */
export default function AdmPage({ userName }: { userName?: string }) {
    const [teamTab, setTeamTab] = useState<TeamTab>("pesquisas");

    // O servidor calcula o painel (totais, gráficos, equipe, mapa de calor) e devolve só o resultado.
    const { snapshot: dash, loading, failed } = useFieldSnapshot();
    const [researcherStats, setResearcherStats] = useState<ResearcherStats | null>(null);

    useEffect(() => {
        let cancelled = false;
        getResearcherStats()
            .then((data) => { if (!cancelled) setResearcherStats(data); })
            .catch((error) => {
                if (cancelled || isSessionExpiredError(error)) return;
                console.error(error);
            });
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        if (failed) toast.error('Erro ao carregar dados do painel');
    }, [failed]);

    const [today] = useState(() => new Date());
    const month = today.getMonth() + 1;

    const researchesChart = useMemo(
        () => MONTH_NAMES.map((label, i) => ({ label, value: dash?.activeByMonth[i] ?? 0 })),
        [dash]
    );

    const researchersChart = useMemo(
        () => MONTH_NAMES.map((label, i) => ({ label, value: dash?.researchersByMonth[i] ?? 0 })),
        [dash]
    );

    const activities: ActivityItem[] = useMemo(
        () => (dash?.activities ?? []).map((a) => ({ ...a, date: new Date(a.date) })),
        [dash]
    );

    const byStatus = {
        draft: dash?.byStatus.DRAFT ?? 0,
        published: dash?.byStatus.PUBLISHED ?? 0,
        inField: dash?.byStatus.IN_FIELD ?? 0,
        closed: dash?.byStatus.CLOSED ?? 0,
    };

    const pins = useMemo(
        () =>
            (dash?.pins ?? []).slice(0, PIN_SLOTS.length).map((r, i) => {
                const daysLeft = Math.ceil((new Date(r.endDate).getTime() - today.getTime()) / DAY_MS);
                return { id: r.id, label: r.title, daysLeft, slot: PIN_SLOTS[i] };
            }),
        [dash, today]
    );

    const fieldNow = dash?.generatedAt ?? today.getTime();
    const teamRows = useMemo(() => teamRowsOf(dash), [dash]);
    const inFieldNow = dash?.totals.inField ?? 0;

    const activeThisMonth = dash?.activeThisMonth ?? 0;
    const diff = activeThisMonth - (dash?.activePrevMonth ?? 0);
    const previousMonthName = monthName(month - 2);
    const delta = loading || diff === 0
        ? undefined
        : `${Math.abs(diff)} ${diff > 0 ? "a mais" : "a menos"} que em ${previousMonthName}`;

    const dashValue = loading ? "–" : undefined;

    return (
        <>
            <BannerComponent
                title="Painel de dados"
                description={todayLabel(today)}
                actions={<Link href="/pesquisas" className={buttonVariants({ size: "sm" })}>Nova pesquisa</Link>}
            />

            <HeroPanel
                greeting={`${greetingFor(today)}${userName ? `, ${firstName(userName)}` : ""}. Neste mês:`}
                value={dashValue ?? activeThisMonth}
                caption={activeThisMonth === 1 ? "pesquisa ativa" : "pesquisas ativas"}
                delta={delta}
                minis={[
                    { value: dashValue ?? dash?.totals.researches ?? 0, label: "pesquisas no total" },
                    { value: dashValue ?? dash?.totals.researchers ?? 0, label: "pesquisadores" },
                    { value: dashValue ?? inFieldNow, label: "pesquisadores em campo" },
                ]}
            >
                {!loading && pins.length === 0 && (
                    <p className="pa-empty absolute inset-0 z-2 px-10 text-[#8ea398]">
                        Nenhuma pesquisa ativa neste mês. Publique uma para ver os pontos de campo aqui.
                    </p>
                )}
                {pins.map(({ id, label, daysLeft, slot }) => (
                    <Pin
                        key={id}
                        label={label}
                        value={daysLeft >= 0 ? `${daysLeft} d` : undefined}
                        left={slot.left}
                        top={slot.top}
                        delay={slot.delay}
                        tone={daysLeft <= 7 ? "clay" : "mint"}
                    />
                ))}
            </HeroPanel>

            <section className="pa-bento">
                <AreaPanel
                    cardClassName="pa-c8"
                    icon={<ClipboardList />}
                    title="Pesquisas ativas por mês"
                    description={<span className="pa-hover-hint">Passe o mouse sobre o gráfico para ver cada mês</span>}
                    data={researchesChart}
                    unit="pesquisas ativas"
                    currentMonth={month - 1}
                />

                <StatusPanel
                    cardClassName="pa-c4"
                    icon={<Target />}
                    title="Situação das pesquisas"
                    description="Como estão todas as pesquisas da empresa"
                    highlighted={byStatus.published + byStatus.inField}
                    total={dash?.totals.researches ?? 0}
                    caption="publicadas ou em campo"
                    rows={[
                        { label: "Em campo", count: byStatus.inField },
                        { label: "Publicadas", count: byStatus.published },
                        { label: "Rascunhos", count: byStatus.draft, tone: "clay" },
                        { label: "Encerradas", count: byStatus.closed },
                    ]}
                />

                <InfoCard
                    cardClassName="pa-c4"
                    tone="dark"
                    icon={<History />}
                    cardTitle="Atividade recente"
                    cardDescription="O que mudou nas pesquisas e na equipe"
                    contour={{ seed: 2.8, rings: 10, cx: 0.1, cy: 1.0, size: 1.1, width: 400, height: 520 }}
                    cardContent={<UltimasAtualizacoesList items={activities} loading={loading} />}
                />

                <AreaPanel
                    cardClassName="pa-c8"
                    icon={<UsersRound />}
                    title="Pesquisadores cadastrados por mês"
                    data={researchersChart}
                    unit="novos pesquisadores"
                    currentMonth={month - 1}
                />

                <HeatmapPanel
                    cardClassName="pa-c6"
                    icon={<CalendarClock />}
                    heat={dash?.heatmap}
                    loading={loading}
                    error={failed && !dash}
                />

                <EquipePanel
                    cardClassName="pa-c6"
                    icon={<UsersRound />}
                    rows={teamRows}
                    now={fieldNow}
                    loading={loading}
                    error={failed && !dash}
                />

                <InfoCard
                    cardClassName="pa-c12"
                    icon={<Clock />}
                    cardTitle="Pesquisas e equipe"
                    cardDescription="Situação, período e quem coleta em cada pesquisa"
                    CardContentClassName="max-h-[26rem] overflow-y-auto overflow-x-hidden px-1"
                    cardContent={
                        <div className="w-full">
                            <TableTabs<TeamTab>
                                label="Tabelas"
                                value={teamTab}
                                onChange={setTeamTab}
                                options={[
                                    { value: "pesquisas", label: "Pesquisas", count: loading ? undefined : dash?.totals.researches, icon: <NotebookPen /> },
                                    { value: "pesquisadores", label: "Pesquisadores", count: loading ? undefined : dash?.totals.researchers, icon: <UsersRound /> },
                                ]}
                            />

                            {teamTab === "pesquisas" ? (
                                <PesquisasEquipeTabela now={fieldNow} />
                            ) : (
                                <ListaPesquisadores
                                    companyNames={{}}
                                    counts={researcherStats ?? undefined}
                                    canDelete={false}
                                    showCompany={false}
                                    onDeleted={() => { }}
                                    maxHeightClassName="max-h-none"
                                />
                            )}
                        </div>
                    }
                />
            </section>
        </>
    );
}
