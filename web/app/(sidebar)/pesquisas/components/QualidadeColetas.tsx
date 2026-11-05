'use client';

import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/ui/loadingState";
import { formatSeconds, getResearchQuality, QUALITY_LABELS, type QualityCode, type ResearchQuality } from "@/lib/report";
import { updateResearchArea } from "@/lib/research";
import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";

/** Auditoria de qualidade das coletas: alertas por coleta e ajuste da área de atuação. */
export default function QualidadeColetas({ researchId, onAreaChanged }: { researchId: number; onAreaChanged?: () => void }) {
    const [data, setData] = useState<ResearchQuality | null>(null);
    const [loading, setLoading] = useState(true);
    const [onlyWarnings, setOnlyWarnings] = useState(true);
    const [lat, setLat] = useState('');
    const [lng, setLng] = useState('');
    const [radius, setRadius] = useState('');
    const [saving, setSaving] = useState(false);

    const load = useCallback(async () => {
        try {
            const q = await getResearchQuality(researchId);
            setData(q);
            setLat(q.area ? String(q.area.latitude) : '');
            setLng(q.area ? String(q.area.longitude) : '');
            setRadius(q.area ? String(q.area.radiusKm) : '');
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Erro ao carregar a auditoria');
        } finally {
            setLoading(false);
        }
    }, [researchId]);
    useEffect(() => { load(); }, [load]);

    const saveArea = async (clear: boolean) => {
        const area = clear ? { areaLatitude: null, areaLongitude: null, areaRadiusKm: null } : { areaLatitude: Number(lat.replace(',', '.')), areaLongitude: Number(lng.replace(',', '.')), areaRadiusKm: Number(radius.replace(',', '.')) };
        if (!clear && (![lat, lng, radius].every((v) => v.trim() !== '') || Object.values(area).some((v) => !Number.isFinite(v as number)) || Math.abs(area.areaLatitude as number) > 90 || Math.abs(area.areaLongitude as number) > 180 || (area.areaRadiusKm as number) <= 0)) {
            toast.error('Informe latitude, longitude e um raio (km) válidos.');
            return;
        }
        setSaving(true);
        try {
            await updateResearchArea(researchId, area);
            toast.success(clear ? 'Área-alvo removida.' : 'Área-alvo salva.');
            await load();
            onAreaChanged?.();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Erro ao salvar a área');
        } finally {
            setSaving(false);
        }
    };

    if (loading) return <LoadingState label="Carregando..." shape="quality" />;
    if (!data) return <p className="text-sm text-destructive">Não foi possível carregar a auditoria.</p>;

    const items = data.items.filter((i) => !onlyWarnings || i.flags.some((f) => f.severity === 'warning'));
    const codes = Object.keys(QUALITY_LABELS) as QualityCode[];

    return (
        <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                {codes.map((c) => (
                    <div key={c} className="rounded-2xl border border-border bg-white p-3">
                        <p className="text-2xl font-semibold">{data.summary.byCode[c] ?? 0}</p>
                        <p className="text-xs text-muted-foreground">{QUALITY_LABELS[c]}</p>
                    </div>
                ))}
            </div>
            <p className="text-sm text-muted-foreground">
                {data.summary.collectionsWithWarning} de {data.summary.totalCollections} coletas com alerta de atenção.
                {!data.recordInterview && ' (Esta pesquisa não grava áudio: a checagem de áudio ausente não se aplica.)'}
            </p>

            <div className="space-y-3 rounded-2xl border border-border bg-white p-4">
                <h3 className="text-sm font-semibold">Área-alvo</h3>
                <p className="text-xs text-muted-foreground">Coletas feitas fora deste círculo (a partir da localização do aparelho no início da coleta) recebem o alerta “Fora da área-alvo”.</p>
                <div className="flex flex-wrap items-end gap-3">
                    <label className="text-xs">Latitude<input value={lat} onChange={(e) => setLat(e.target.value)} placeholder="-23.5505" className="mt-1 block h-9 w-32 rounded-md border border-border px-2 text-sm" /></label>
                    <label className="text-xs">Longitude<input value={lng} onChange={(e) => setLng(e.target.value)} placeholder="-46.6333" className="mt-1 block h-9 w-32 rounded-md border border-border px-2 text-sm" /></label>
                    <label className="text-xs">Raio (km)<input value={radius} onChange={(e) => setRadius(e.target.value)} placeholder="5" className="mt-1 block h-9 w-24 rounded-md border border-border px-2 text-sm" /></label>
                    <Button size="sm" disabled={saving} onClick={() => saveArea(false)}>Salvar área</Button>
                    {data.area && <Button size="sm" variant="ghost" disabled={saving} onClick={() => saveArea(true)}>Remover</Button>}
                </div>
            </div>

            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold">Coletas sinalizadas</h3>
                    <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={onlyWarnings} onChange={(e) => setOnlyWarnings(e.target.checked)} /> Ocultar avisos informativos</label>
                </div>
                {items.length === 0 ? <p className="rounded-xl bg-white p-4 text-sm text-muted-foreground">Nenhuma coleta sinalizada.</p> : items.slice(0, 200).map((i) => (
                    <div key={i.collectionId} className="rounded-xl border border-border bg-white p-3 text-sm">
                        <div className="flex flex-wrap justify-between gap-2">
                            <strong>Coleta #{i.collectionId} · {i.researcherName}</strong>
                            <span className="text-xs text-muted-foreground">{new Date(i.startedAt).toLocaleString('pt-BR')} · {formatSeconds(i.durationSeconds)}</span>
                        </div>
                        <ul className="mt-1 space-y-0.5 text-xs">
                            {i.flags.map((f, k) => <li key={k} className={f.severity === 'warning' ? 'text-[#8a432f]' : 'text-muted-foreground'}>• {QUALITY_LABELS[f.code]} — {f.message}</li>)}
                        </ul>
                    </div>
                ))}
                {items.length > 200 && <p className="text-xs text-muted-foreground">Mostrando as 200 primeiras.</p>}
            </div>
        </div>
    );
}
