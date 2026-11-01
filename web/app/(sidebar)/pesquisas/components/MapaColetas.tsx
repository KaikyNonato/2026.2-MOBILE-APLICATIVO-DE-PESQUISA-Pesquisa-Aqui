'use client'

import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/ui/loadingState";
import { getResearchMap, QUALITY_LABELS, type ReportFilters, type ResearchMap } from "@/lib/report";
import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import "leaflet/dist/leaflet.css";

const ROUTE_COLORS = ["#447762", "#6b8fb5", "#8d6bb5", "#c9a94b", "#5aa5a5", "#b5666b", "#7a8a52", "#e0917a"];
const FIELD = "flex min-w-0 flex-col gap-1.5";
const LABEL = "text-xs font-medium text-muted-foreground";
const CONTROL = "h-10 w-full rounded-xl border border-border bg-white px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";
const todayStr = () => new Date().toISOString().slice(0, 10);
const esc = (t: string) => t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

export default function MapaColetas({ researchId }: { researchId: number }) {
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    const [researcherId, setResearcherId] = useState('');
    const [flagged, setFlagged] = useState(false);
    const [heat, setHeat] = useState(true);
    const [routes, setRoutes] = useState(true);
    const [data, setData] = useState<ResearchMap | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const mapEl = useRef<HTMLDivElement>(null);

    useEffect(() => {
        let cancelled = false;
        const filters: ReportFilters = { from: from || undefined, to: to || undefined, researcherId: researcherId ? Number(researcherId) : undefined, flagged: flagged || undefined };
        setLoading(true);
        getResearchMap(researchId, filters)
            .then((r) => { if (!cancelled) { setData(r); setError(null); } })
            .catch((e) => { if (!cancelled) { setError(e instanceof Error ? e.message : 'Erro ao carregar o mapa'); toast.error('Erro ao carregar o mapa'); } })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [researchId, from, to, researcherId, flagged]);

    // Leaflet só existe no navegador: carregado sob demanda e redesenhado a cada mudança de dados/camadas.
    useEffect(() => {
        if (!data || !mapEl.current) return;
        let map: import('leaflet').Map | null = null;
        let cancelled = false;
        (async () => {
            const L = (await import('leaflet')).default;
            if (cancelled || !mapEl.current) return;
            map = L.map(mapEl.current, { zoomControl: true }).setView([-14.2, -51.9], 4);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);
            const bounds: [number, number][] = [];

            if (data.area) {
                L.circle([data.area.latitude, data.area.longitude], { radius: data.area.radiusKm * 1000, color: '#447762', weight: 2, dashArray: '6 6', fillOpacity: 0.05 }).addTo(map);
                bounds.push([data.area.latitude + data.area.radiusKm / 111, data.area.longitude], [data.area.latitude - data.area.radiusKm / 111, data.area.longitude]);
            }
            // "Mapa de calor": círculos translúcidos que se somam onde há muitas coletas.
            if (heat) data.points.forEach((p) => L.circle([p.latitude, p.longitude], { radius: 250, stroke: false, fillColor: '#d9534f', fillOpacity: 0.12 }).addTo(map!));

            if (routes) {
                const groups = new Map<string, typeof data.points>();
                data.points.forEach((p) => {
                    const key = `${p.researcherId}|${p.startedAt.slice(0, 10)}`;
                    groups.set(key, [...(groups.get(key) ?? []), p]);
                });
                const colorOf = (id: number) => ROUTE_COLORS[data.researchers.findIndex((r) => r.userId === id) % ROUTE_COLORS.length] ?? ROUTE_COLORS[0];
                groups.forEach((pts) => {
                    if (pts.length < 2) return;
                    const sorted = [...pts].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
                    L.polyline(sorted.map((p) => [p.latitude, p.longitude] as [number, number]), { color: colorOf(sorted[0].researcherId), weight: 2.5, opacity: 0.7 }).addTo(map!);
                });
            }

            data.points.forEach((p) => {
                const warn = p.flags.some((f) => f.severity === 'warning');
                const marker = L.circleMarker([p.latitude, p.longitude], { radius: 7, color: '#fff', weight: 1.5, fillColor: warn ? '#d9534f' : '#447762', fillOpacity: 0.95 }).addTo(map!);
                const flags = p.flags.map((f) => `<li>${esc(QUALITY_LABELS[f.code])}</li>`).join('');
                marker.bindPopup(`<strong>Coleta #${p.collectionId}</strong><br/>${esc(p.researcherName)}<br/>${new Date(p.startedAt).toLocaleString('pt-BR')}${flags ? `<ul style="margin:4px 0 0 14px;padding:0">${flags}</ul>` : ''}`);
                bounds.push([p.latitude, p.longitude]);
            });
            if (bounds.length) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 16 });
        })();
        return () => { cancelled = true; map?.remove(); };
    }, [data, heat, routes]);

    return (
        <div className="space-y-4">
            <div className="grid gap-4 rounded-2xl border border-border bg-white p-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1.2fr_auto]">
                <label className={FIELD}>
                    <span className={LABEL}>De</span>
                    <input type="date" max={todayStr()} value={from} onChange={(e) => setFrom(e.target.value)} className={CONTROL} />
                </label>
                <label className={FIELD}>
                    <span className={LABEL}>Até</span>
                    <input type="date" max={todayStr()} value={to} onChange={(e) => setTo(e.target.value)} className={CONTROL} />
                </label>
                <label className={FIELD}>
                    <span className={LABEL}>Pesquisador</span>
                    <select value={researcherId} onChange={(e) => setResearcherId(e.target.value)} className={CONTROL}>
                        <option value="">Todos</option>
                        {data?.researchers.map((r) => <option key={r.userId} value={r.userId}>{r.name}</option>)}
                    </select>
                </label>
                <div className={FIELD}>
                    <span className={LABEL}>Exibir</span>
                    <div className="flex h-10 flex-wrap items-center gap-2">
                        {([['Só com alerta', flagged, setFlagged], ['Calor', heat, setHeat], ['Rotas', routes, setRoutes]] as const).map(([label, on, set]) => (
                            <button key={label} type="button" aria-pressed={on} onClick={() => set(!on)}
                                className={`h-9 rounded-full border px-3.5 text-[13px] font-medium transition ${on ? 'border-transparent bg-ink text-white' : 'border-border bg-white text-muted-foreground hover:bg-muted'}`}>
                                {label}
                            </button>
                        ))}
                        {(from || to || researcherId || flagged) && <Button variant="ghost" size="sm" onClick={() => { setFrom(''); setTo(''); setResearcherId(''); setFlagged(false); }}>Limpar</Button>}
                    </div>
                </div>
            </div>

            {loading && !data ? <LoadingState label="Carregando..." /> : error && !data ? <p className="text-sm text-destructive">{error}</p> : data && (
                <>
                    <p className="text-xs text-muted-foreground">
                        {data.withLocation} de {data.totalCollections} coletas com localização
                        {data.withoutLocation > 0 && ` (${data.withoutLocation} sem localização: só aparecem em coletas feitas com a versão nova do app)`}.
                        Pontos vermelhos têm alerta de qualidade. A linha liga as coletas de cada pesquisador no dia, em ordem.
                    </p>
                    {/* isolate cria um contexto de empilhamento próprio: os painéis do Leaflet (z-index até 1000) não passam por cima de diálogos e menus */}
                    <div className="relative isolate z-0 overflow-hidden rounded-2xl border border-border">
                        <div ref={mapEl} className="h-[520px] w-full" />
                    </div>
                </>
            )}
        </div>
    );
}
