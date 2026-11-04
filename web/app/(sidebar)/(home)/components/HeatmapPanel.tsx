import { HEAT_DAY_NAMES, HEAT_DAYS, HEAT_FIRST_HOUR, HEAT_HOURS, type Heatmap } from "@/lib/fieldData";
import { LoadingState } from "@/components/ui/loadingState";
import { type ReactNode } from "react";
import InfoCard from "./infoCards";

type HeatmapPanelProps = {
    /** Mapa já calculado pelo servidor (GET /dashboard/admin). */
    heat: Heatmap | undefined;
    loading?: boolean;
    /** A consulta das coletas falhou. */
    error?: boolean;
    /** Alguma pesquisa não carregou: os números podem estar incompletos. */
    incomplete?: boolean;
    icon?: ReactNode;
    cardClassName?: string;
};

/** Escreve o número com a palavra no singular ou no plural. */
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Mapa de calor: em que dia da semana e horário as coletas acontecem (últimas 4 semanas). */
export default function HeatmapPanel({ heat: heatData, loading = false, error = false, incomplete = false, icon, cardClassName }: HeatmapPanelProps) {
    const heat: Heatmap = heatData ?? { cells: HEAT_DAYS.map(() => new Array<number>(HEAT_HOURS).fill(0)), levels: HEAT_DAYS.map(() => new Array<number>(HEAT_HOURS).fill(0)), total: 0, outside: 0, peak: null };
    const peakLabel = heat.peak
        ? `${HEAT_DAY_NAMES[heat.peak.day]}, ${heat.peak.hour}h às ${heat.peak.hour + 1}h`
        : null;

    return (
        <InfoCard
            cardClassName={cardClassName}
            icon={icon}
            cardTitle="Quando as coletas acontecem"
            cardDescription="Volume por dia e horário, últimas 4 semanas"
            cardContent={
                loading ? (
                    <LoadingState label="Carregando coletas..." shape="heatmap" />
                ) : error ? (
                    <div className="pa-empty">Não foi possível carregar as coletas.</div>
                ) : heat.total === 0 ? (
                    <div className="pa-empty">Nenhuma coleta nas últimas 4 semanas.</div>
                ) : (
                    <>
                        <div
                            className="pa-heat"
                            role="img"
                            aria-label={`Coletas por dia e horário. ${plural(heat.total, "coleta", "coletas")} nas últimas 4 semanas${peakLabel ? `; pico na ${peakLabel}` : ""}.`}
                        >
                            {HEAT_DAYS.map((day, d) => (
                                <div className="row" key={day}>
                                    <span className="rl">{day}</span>
                                    {heat.levels[d].map((level, c) => (
                                        <i
                                            key={c}
                                            className={`l${level}`}
                                            title={`${day}, ${c + HEAT_FIRST_HOUR}h: ${plural(heat.cells[d][c], "coleta", "coletas")}`}
                                        />
                                    ))}
                                </div>
                            ))}
                            <div className="row hours" aria-hidden="true">
                                <span />
                                {[0, 3, 6, 9].map((c) => (
                                    <span className="hl" key={c} style={{ gridColumn: `${c + 2} / span 3` }}>
                                        {HEAT_FIRST_HOUR + c}h
                                    </span>
                                ))}
                            </div>
                        </div>

                        <div className="pa-heat-foot">
                            {peakLabel && <span className="pa-chip light"><i />Pico: {peakLabel}</span>}
                            <div className="pa-scale" aria-hidden="true">
                                menos <i className="l0" /><i className="l1" /><i className="l2" /><i className="l3" /><i className="l4" /> mais
                            </div>
                        </div>
                        {incomplete && (
                            <p className="pa-heat-note">Algumas pesquisas não carregaram; os números podem estar incompletos.</p>
                        )}
                        {heat.outside > 0 && (
                            <p className="pa-heat-note">
                                {plural(heat.outside, "coleta fora", "coletas fora")} do intervalo de {HEAT_FIRST_HOUR}h às {HEAT_FIRST_HOUR + HEAT_HOURS}h não aparece{heat.outside === 1 ? "" : "m"} no mapa.
                            </p>
                        )}
                    </>
                )
            }
        />
    );
}
