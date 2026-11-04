import { Chart } from "./grafico";

type EstatisticasChartProps = {
    valor: React.ReactNode;
    chartData?: ({ month: string } & Record<string, string | number>)[];
    variant?: "line" | "bar";
    seriesKey?: string;
    seriesLabel?: string;
};

/** Gráfico de estatísticas, com o valor total ao lado. */
export default function EstatisticasChart({ valor, chartData, variant, seriesKey, seriesLabel }: EstatisticasChartProps) {
    return (
        <div className="grid w-full grid-cols-3 gap-2 max-lg:flex max-lg:flex-col max-lg:gap-3">
            <div className="flex items-center justify-center">
                <span className="text-5xl">{valor}</span>
            </div>
            <div className="col-span-2">
                <Chart variant={variant} data={chartData} seriesKey={seriesKey} seriesLabel={seriesLabel} />
            </div>
        </div>
    );
}
