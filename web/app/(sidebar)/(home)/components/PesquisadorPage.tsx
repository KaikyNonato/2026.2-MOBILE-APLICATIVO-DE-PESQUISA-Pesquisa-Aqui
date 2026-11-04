'use client';

import BannerComponent from "@/components/ui/bannerComponent";
import { buttonVariants } from "@/components/ui/button";
import { Pin } from "@/components/ui/contour";
import { LoadingState } from "@/components/ui/loadingState";
import { isSessionExpiredError } from "@/lib/apiFetcher";
import {
    daysUntil,
    deadlineLabel,
    getMyResearches,
    isOpenForCollection,
    MY_STATUS_LABELS,
    progressPercent,
    sortMyResearches,
    type MyResearch,
} from "@/lib/researcher";
import { ArrowUpRight, CloudUpload, Download, MapPinned, Smartphone, Target } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { firstName, greetingFor, PIN_SLOTS, todayLabel } from "./dashboardUtils";
import HeroPanel from "./HeroPanel";

const STEPS = [
    { icon: <Smartphone />, title: "Abra o aplicativo", text: "Entre com o mesmo usuário e a mesma senha do painel." },
    { icon: <Download />, title: "Baixe a pesquisa", text: "Depois de baixada, ela funciona mesmo sem internet." },
    { icon: <MapPinned />, title: "Colete em campo", text: "Registre as respostas, fotos e áudios de cada entrevista." },
    { icon: <CloudUpload />, title: "Envie as coletas", text: "Com internet, as coletas sobem e o progresso aparece aqui." },
];

/** Barra de progresso da meta (ou só a contagem, quando a pesquisa não tem meta). */
function Progress({ research }: { research: MyResearch }) {
    const percent = progressPercent(research);

    return (
        <div>
            <div className="mb-1.5 flex items-center justify-between text-xs text-muted-foreground">
                <span>
                    {research.targetCount
                        ? `${research.collected} de ${research.targetCount} coletas`
                        : `${research.collected} ${research.collected === 1 ? "coleta enviada" : "coletas enviadas"}`}
                </span>
                {percent !== null && <b className="font-semibold text-foreground">{percent}%</b>}
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-[#e7ece8]">
                <div
                    className="h-full rounded-full bg-[var(--green)] transition-[width] duration-700"
                    style={{ width: `${percent ?? (research.collected > 0 ? 100 : 0)}%`, opacity: percent === null ? 0.35 : 1 }}
                />
            </div>
        </div>
    );
}

/** Início do pesquisador: o que ele tem para coletar e quanto já enviou. A coleta em si é feita no aplicativo. */
export default function PesquisadorPage({ userName }: { userName?: string }) {
    const [researches, setResearches] = useState<MyResearch[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [today] = useState(() => new Date());

    useEffect(() => {
        let cancelled = false;
        getMyResearches()
            .then((list) => { if (!cancelled) setResearches(sortMyResearches(list)); })
            .catch((err) => {
                if (cancelled || isSessionExpiredError(err)) return;
                setError(err instanceof Error ? err.message : "Erro ao carregar as suas pesquisas");
            });
        return () => { cancelled = true; };
    }, []);

    const open = useMemo(() => (researches ?? []).filter(isOpenForCollection), [researches]);
    const collected = useMemo(() => (researches ?? []).reduce((sum, r) => sum + r.collected, 0), [researches]);
    const goalDone = useMemo(
        () => (researches ?? []).filter((r) => r.targetCount && r.collected >= r.targetCount).length,
        [researches],
    );
    const pins = useMemo(
        () =>
            open.slice(0, PIN_SLOTS.length).map((r, i) => ({
                id: r.id,
                label: r.title,
                daysLeft: daysUntil(r.endDate, today.getTime()),
                slot: PIN_SLOTS[i],
            })),
        [open, today],
    );

    if (!researches && !error) return <LoadingState label="Abrindo as suas pesquisas..." shape="page" />;

    const loading = !researches;
    const dash = loading ? "–" : undefined;

    return (
        <>
            <BannerComponent
                title="Minha área"
                description={todayLabel(today)}
                actions={<Link href="/pesquisas" className={buttonVariants({ size: "sm" })}>Ver minhas pesquisas</Link>}
            />

            {error && (
                <div role="alert" className="rounded-[22px] border border-dashed border-input bg-muted/40 p-6 text-center text-sm text-destructive">
                    {error}
                </div>
            )}

            <HeroPanel
                greeting={`${greetingFor(today)}${userName ? `, ${firstName(userName)}` : ""}. Você já enviou:`}
                value={dash ?? collected}
                caption={collected === 1 ? "coleta" : "coletas"}
                minis={[
                    { value: dash ?? open.length, label: "pesquisas abertas" },
                    { value: dash ?? (researches?.length ?? 0), label: "pesquisas vinculadas" },
                    { value: dash ?? goalDone, label: "metas cumpridas" },
                ]}
            >
                {!loading && pins.length === 0 && (
                    <p className="pa-empty absolute inset-0 z-2 px-10 text-[#8ea398]">
                        Nenhuma pesquisa aberta para você agora. Quando o administrador vincular você a uma, ela aparece aqui.
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

            <section className="grid grid-cols-1 gap-5 lg:grid-cols-5">
                <article className="pa-card introduction-card lg:col-span-3">
                    <header className="pa-card-h">
                        <div className="pa-ic"><Target /></div>
                        <div className="grow">
                            <h3>Pesquisas em andamento</h3>
                            <p className="desc">Seu progresso frente à meta de cada pesquisa.</p>
                        </div>
                        <Link href="/pesquisas" className="pa-link inline-flex items-center gap-1">
                            Ver todas <ArrowUpRight className="size-3.5" />
                        </Link>
                    </header>

                    <div className="mt-5">
                        {open.length === 0 ? (
                            <p className="rounded-2xl border border-dashed border-input bg-muted/40 p-6 text-center text-sm text-muted-foreground">
                                Nenhuma pesquisa em andamento.
                            </p>
                        ) : (
                            <ul className="flex flex-col gap-3">
                                {open.map((research) => {
                                    const days = daysUntil(research.endDate, today.getTime());
                                    return (
                                        <li key={research.id} className="rounded-2xl border border-border bg-white p-4">
                                            <div className="mb-3 flex items-start justify-between gap-3">
                                                <div className="min-w-0">
                                                    <p className="truncate font-semibold">{research.title}</p>
                                                    <p className="text-xs text-muted-foreground">
                                                        {MY_STATUS_LABELS[research.status]} · {deadlineLabel(days)}
                                                    </p>
                                                </div>
                                                {days <= 7 && (
                                                    <span className="shrink-0 rounded-full bg-[#f3e0d9] px-2.5 py-1 text-xs font-medium text-[#8a432f]">
                                                        Prazo próximo
                                                    </span>
                                                )}
                                            </div>
                                            <Progress research={research} />
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </div>
                </article>

                <article className="pa-card introduction-card lg:col-span-2">
                    <header className="pa-card-h">
                        <div className="pa-ic"><Smartphone /></div>
                        <div className="grow">
                            <h3>Coleta pelo aplicativo</h3>
                            <p className="desc">O painel acompanha; quem coleta é o app.</p>
                        </div>
                    </header>

                    <ol className="mt-5 flex flex-col gap-4">
                        {STEPS.map((step, i) => (
                            <li key={step.title} className="flex items-start gap-3">
                                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#e4ece7] text-[var(--green-deep)] [&>svg]:size-[18px]">
                                    {step.icon}
                                </span>
                                <div className="min-w-0">
                                    <p className="text-sm font-semibold">{i + 1}. {step.title}</p>
                                    <p className="text-[13px] text-muted-foreground">{step.text}</p>
                                </div>
                            </li>
                        ))}
                    </ol>
                </article>
            </section>
        </>
    );
}
