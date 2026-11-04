'use client';

import { CountUp } from "@/components/ui/count-up";
import { useId, useMemo, useState, type ReactNode } from "react";
import InfoCard from "./infoCards";

export type AreaPoint = { label: string; value: number };

type AreaPanelProps = {
    title: string;
    description?: ReactNode;
    icon?: ReactNode;
    /** Um ponto por mês do ano. */
    data: AreaPoint[];
    /** Texto do que o valor mede, no plural. Ex.: "pesquisas ativas". */
    unit: string;
    /** Índice (0 a 11) do mês atual, usado no recorte "6 meses" e no valor atual. */
    currentMonth: number;
    cardClassName?: string;
};

const W = 700;
const H = 300;
const PL = 10;
const PR = 10;
const PT = 24;
const PB = 30;

/** Formata um número em pt-BR, com até uma casa decimal. */
const formatNumber = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 1 });

/** Gráfico de área com cursor: passe o mouse ou use as setas para ler cada mês. */
export default function AreaPanel({ title, description, icon, data, unit, currentMonth, cardClassName }: AreaPanelProps) {
    const [range, setRange] = useState<"year" | "six">("year");
    const [active, setActive] = useState<number | null>(null);
    const gradientId = useId();

    const points = useMemo(
        () => (range === "year" ? data : data.slice(Math.max(0, currentMonth - 5), currentMonth + 1)),
        [data, range, currentMonth]
    );

    const stats = useMemo(() => {
        const values = points.map((p) => p.value);
        const sum = values.reduce((a, b) => a + b, 0);
        const peakIndex = values.indexOf(Math.max(...values, 0));
        return {
            current: data[currentMonth]?.value ?? 0,
            average: values.length ? sum / values.length : 0,
            peak: values[peakIndex] ?? 0,
            peakLabel: points[peakIndex]?.label ?? "",
        };
    }, [points, data, currentMonth]);

    const geometry = useMemo(() => {
        const max = Math.max(4, ...points.map((p) => p.value)) * 1.15;
        const step = points.length > 1 ? (W - PL - PR) / (points.length - 1) : 0;
        const xs = points.map((_, i) => PL + i * step);
        const ys = points.map((p) => PT + (1 - p.value / max) * (H - PT - PB));

        let line = xs.length ? `M${xs[0]} ${ys[0]}` : "";
        for (let i = 0; i < xs.length - 1; i++) {
            const cx = (xs[i] + xs[i + 1]) / 2;
            line += ` C${cx} ${ys[i]} ${cx} ${ys[i + 1]} ${xs[i + 1]} ${ys[i + 1]}`;
        }
        const area = xs.length ? `${line} L${xs[xs.length - 1]} ${H - PB} L${xs[0]} ${H - PB} Z` : "";

        return { xs, ys, line, area, step };
    }, [points]);

    const handleMove = (event: React.MouseEvent<SVGSVGElement>) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const x = ((event.clientX - rect.left) / rect.width) * W;
        const index = geometry.step ? Math.round((x - PL) / geometry.step) : 0;
        setActive(Math.max(0, Math.min(points.length - 1, index)));
    };

    const handleKey = (event: React.KeyboardEvent<SVGSVGElement>) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const delta = event.key === "ArrowRight" ? 1 : -1;
        setActive((prev) => Math.max(0, Math.min(points.length - 1, (prev ?? points.length - 1) + delta)));
    };

    const shown = active ?? points.length - 1;
    const hasShown = points[shown] !== undefined;

    return (
        <InfoCard
            cardClassName={cardClassName}
            icon={icon}
            cardTitle={title}
            cardDescription={description}
            cardAction={
                <div className="pa-legend" role="group" aria-label="Período do gráfico">
                    <button type="button" className={range === "year" ? "on" : ""} aria-pressed={range === "year"} onClick={() => { setRange("year"); setActive(null); }}>Ano todo</button>
                    <button type="button" className={range === "six" ? "on" : ""} aria-pressed={range === "six"} onClick={() => { setRange("six"); setActive(null); }}>6 meses</button>
                </div>
            }
            cardContent={
                <>
                    <div className="pa-kpis">
                        <div><b><CountUp value={stats.current} format={formatNumber} /></b><span className="l">{unit} neste mês</span></div>
                        <div><b><CountUp value={stats.average} format={formatNumber} /></b><span className="l">média por mês</span></div>
                        <div><span className="pa-chip light"><i />Pico em {stats.peakLabel.toLowerCase() || "—"}: <CountUp value={stats.peak} format={formatNumber} /></span></div>
                    </div>
                    <div className="pa-chart-box">
                        <svg
                            className="pa-chart"
                            viewBox={`0 0 ${W} ${H}`}
                            role="img"
                            aria-label={`${title}: ${points.map((p) => `${p.label} ${p.value}`).join(", ")}`}
                            tabIndex={0}
                            onMouseMove={handleMove}
                            onMouseLeave={() => setActive(null)}
                            onKeyDown={handleKey}
                            onBlur={() => setActive(null)}
                            key={range}
                        >
                            <defs>
                                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0" stopColor="#447762" stopOpacity=".3" />
                                    <stop offset="1" stopColor="#447762" stopOpacity="0" />
                                </linearGradient>
                            </defs>
                            {[0, 0.5, 1].map((g) => {
                                const y = PT + g * (H - PT - PB);
                                return <line key={g} x1="0" x2={W} y1={y} y2={y} stroke="#e6ebe7" strokeDasharray="3 5" />;
                            })}
                            <path className="area" d={geometry.area} fill={`url(#${gradientId})`} />
                            <path className="line" pathLength={1} d={geometry.line} fill="none" stroke="#2e5546" strokeWidth="2.5" strokeLinecap="round" />
                            {points.map((p, i) =>
                                (range === "year" ? i % 3 === 0 : true) ? (
                                    <text key={p.label} x={geometry.xs[i]} y={H - 8} fill="#5d6a63" fontSize="12" textAnchor={i === 0 ? "start" : "middle"}>
                                        {p.label.slice(0, 3).toLowerCase()}
                                    </text>
                                ) : null
                            )}
                            {active !== null && hasShown && (
                                <>
                                    <line x1={geometry.xs[shown]} x2={geometry.xs[shown]} y1={PT} y2={H - PB} stroke="#2e5546" strokeDasharray="3 4" />
                                    <circle cx={geometry.xs[shown]} cy={geometry.ys[shown]} r="6" fill="#fff" stroke="#2e5546" strokeWidth="2.5" />
                                </>
                            )}
                        </svg>
                        <div
                            className="pa-tip"
                            aria-live="polite"
                            style={{
                                opacity: active !== null && hasShown ? 1 : 0,
                                left: hasShown ? `${(geometry.xs[shown] / W) * 100}%` : 0,
                                top: hasShown ? `${(geometry.ys[shown] / H) * 100}%` : 0,
                            }}
                        >
                            {hasShown && <><b>{points[shown].value}</b>{unit}, {points[shown].label.toLowerCase()}</>}
                        </div>
                    </div>
                </>
            }
        />
    );
}
