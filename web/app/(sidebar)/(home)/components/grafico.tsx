"use client";

import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

type ChartProps = {
    variant?: "line" | 'bar';
    /** Cada ponto precisa ter `month` e um valor numérico na chave `seriesKey`. */
    data?: ({ month: string } & Record<string, string | number>)[];
    /** Chave do valor dentro de cada ponto de `data`. Ex.: "Pesquisas", "Empresas". */
    seriesKey?: string;
    /** Rótulo exibido na legenda e no tooltip. Por padrão, o próprio `seriesKey`. */
    seriesLabel?: string;
};

/** Gráfico de linhas ou de barras, conforme `variant`. */
export function Chart({ variant, data = [], seriesKey = "Pesquisas", seriesLabel }: ChartProps) {
    const chartConfig: ChartConfig = {
        [seriesKey]: {
            label: seriesLabel ?? seriesKey,
            color: "#447762",
        },
    };

    const color = `var(--color-${seriesKey})`;

    return (
        <ChartContainer config={chartConfig} className="max-h-175 max-w-175 w-full min-w-50">

            {variant === 'line' ? (
                <LineChart accessibilityLayer data={data}>
                    <CartesianGrid vertical={false} />

                    <XAxis
                        dataKey="month"
                        tickLine={false}
                        tickMargin={10}
                        axisLine={false}
                        tickFormatter={(value) => value.slice(0, 3)}
                    />
                    <YAxis hide allowDecimals={false} domain={[0, (max: number) => Math.max(max, 1)]} />
                    <Line
                        type="natural"
                        dataKey={seriesKey}
                        stroke={color}
                        strokeWidth={2}
                        dot={{ fill: color }}
                        activeDot={{ r: 6 }}
                    />
                    <ChartLegend content={<ChartLegendContent />} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                </LineChart>
            ) : (
                <BarChart accessibilityLayer data={data}>
                    <CartesianGrid vertical={false} />

                    <XAxis
                        dataKey="month"
                        tickLine={false}
                        tickMargin={10}
                        axisLine={false}
                        tickFormatter={(value) => value.slice(0, 3)}
                    />
                    <YAxis hide allowDecimals={false} domain={[0, (max: number) => Math.max(max, 1)]} />
                    <Bar dataKey={seriesKey} fill={color} radius={4} />
                    <ChartLegend content={<ChartLegendContent />} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                </BarChart>
            )}

        </ChartContainer>
    );
}
