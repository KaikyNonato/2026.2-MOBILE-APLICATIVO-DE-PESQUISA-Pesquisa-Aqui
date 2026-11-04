'use client';

import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/ui/loadingState";
import {
    createResearchFromSaved,
    createResearchFromTemplate,
    deleteSavedTemplate,
    downloadTemplateFile,
    getResearches,
    getResearchTemplates,
    getSavedTemplates,
    parseTemplateFile,
    saveResearchAsTemplate,
    saveTemplate,
    type Research,
    type ResearchTemplate,
    type SavedTemplate,
} from "@/lib/research";
import { Download, FileJson, FilePlus2, Trash2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";

// Item da biblioteca: modelo pronto ou modelo salvo pela empresa (`custom`).
type Item = Omit<ResearchTemplate, 'id'> & { id: string; custom?: SavedTemplate };

/** Converte um modelo salvo no item exibido na lista de modelos. */
const summarize = (c: SavedTemplate): Item => ({
    id: `saved-${c.id}`,
    name: c.name,
    category: c.category,
    description: c.description || 'Modelo personalizado.',
    objective: c.objective,
    targetAudience: c.targetAudience,
    recordInterview: c.recordInterview,
    sectionCount: c.sections.length,
    questionCount: c.sections.reduce((n, s) => n + s.questions.length, 0),
    ruleCount: c.rules.length,
    sections: c.sections.map((s) => ({ title: s.title, questions: s.questions.map((q) => ({ statement: q.statement, type: q.type })) })),
    custom: c,
});

/** Biblioteca de questionários prontos e personalizados: escolhe um modelo e cria um rascunho já com seções, questões e regras. */
export default function ModelosPesquisa({ onClose }: { onClose?: () => void }) {
    const router = useRouter();
    const fileInput = useRef<HTMLInputElement>(null);
    const [templates, setTemplates] = useState<ResearchTemplate[] | null>(null);
    const [customs, setCustoms] = useState<SavedTemplate[]>([]);
    const [busy, setBusy] = useState(false);
    const [selected, setSelected] = useState<Item | null>(null);
    const [mode, setMode] = useState<'list' | 'pick'>('list');
    const [researches, setResearches] = useState<Research[] | null>(null);
    const [savingId, setSavingId] = useState<number | null>(null);
    const [title, setTitle] = useState('');
    const [creating, setCreating] = useState(false);

    useEffect(() => {
        getSavedTemplates().then(setCustoms).catch(() => setCustoms([]));
        getResearchTemplates().then(setTemplates).catch((e) => { toast.error(e instanceof Error ? e.message : 'Erro ao carregar os modelos'); setTemplates([]); });
    }, []);

    const create = async () => {
        if (!selected) return;
        setCreating(true);
        try {
            const created = selected.custom
                ? await createResearchFromSaved(selected.custom.id, title.trim() || undefined)
                : await createResearchFromTemplate({ templateId: selected.id, title: title.trim() || undefined });
            toast.success('Rascunho criado a partir do modelo!');
            onClose?.();
            router.push(`/pesquisas/${created.id}`);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Erro ao criar a pesquisa');
            setCreating(false);
        }
    };

    const importFile = async (file: File | undefined) => {
        if (!file) return;
        try {
            if (file.size > 2 * 1024 * 1024) throw new Error('O arquivo é grande demais para um modelo (máximo 2 MB).');
            const parsed = parseTemplateFile(await file.text(), file.name.replace(/\.json$/i, ''));
            setBusy(true);
            const saved = await saveTemplate(parsed);
            setCustoms((list) => [saved, ...list]);
            toast.success(`Modelo "${parsed.name}" adicionado à biblioteca!`);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Erro ao importar o arquivo');
        } finally {
            setBusy(false);
            if (fileInput.current) fileInput.current.value = '';
        }
    };

    const openPicker = () => {
        setMode('pick');
        if (!researches) getResearches().then(setResearches).catch((e) => { toast.error(e instanceof Error ? e.message : 'Erro ao carregar as pesquisas'); setResearches([]); });
    };

    const saveAsTemplate = async (research: Research) => {
        setSavingId(research.id);
        try {
            const saved = await saveResearchAsTemplate(research.id);
            setCustoms((list) => [saved, ...list]);
            toast.success(`"${research.title}" salva como modelo!`);
            setMode('list');
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Erro ao salvar como modelo');
        } finally {
            setSavingId(null);
        }
    };

    const remove = async (item: Item) => {
        if (!item.custom) return;
        setBusy(true);
        try {
            await deleteSavedTemplate(item.custom.id);
            setCustoms((list) => list.filter((c) => c.id !== item.custom!.id));
            setSelected(null);
            toast.success('Modelo removido da biblioteca.');
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Erro ao remover o modelo');
        } finally {
            setBusy(false);
        }
    };

    if (!templates) return <LoadingState label="Carregando..." />;

    if (selected) {
        return (
            <div className="space-y-4 overflow-y-auto">
                <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{selected.category}</p>
                    <h3 className="text-lg font-semibold">{selected.name}</h3>
                    <p className="text-sm text-muted-foreground">{selected.description}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{selected.sectionCount} seções · {selected.questionCount} questões · {selected.ruleCount} regras de exibição{selected.recordInterview ? ' · grava áudio' : ''}</p>
                </div>
                <div className="max-h-64 space-y-3 overflow-y-auto rounded-xl border border-border bg-muted/20 p-3 text-sm">
                    {selected.sections.map((s, i) => (
                        <div key={i}>
                            <p className="font-medium">{i + 1}. {s.title}</p>
                            <ul className="ml-4 list-disc text-xs text-muted-foreground">{s.questions.map((q, k) => <li key={k}>{q.statement}</li>)}</ul>
                        </div>
                    ))}
                </div>
                <label className="block text-xs">Título da pesquisa (opcional)
                    <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={selected.name} maxLength={150} className="mt-1 block h-10 w-full rounded-md border border-border px-3 text-sm" />
                </label>
                <p className="text-xs text-muted-foreground">Cria um rascunho: depois você ajusta questões, regras, datas e pesquisadores como em qualquer pesquisa.</p>
                <div className="flex flex-wrap justify-end gap-2">
                    {selected.custom && (
                        <>
                            <Button variant="ghost" onClick={() => remove(selected)} disabled={creating || busy} className="mr-auto text-destructive"><Trash2 />Remover</Button>
                            <Button variant="outline" onClick={() => downloadTemplateFile(selected.custom!)} disabled={creating}><Download />Baixar JSON</Button>
                        </>
                    )}
                    <Button variant="ghost" onClick={() => setSelected(null)} disabled={creating}>Voltar</Button>
                    <Button onClick={create} disabled={creating}>{creating ? 'Criando...' : 'Usar este modelo'}</Button>
                </div>
            </div>
        );
    }

    if (mode === 'pick') {
        return (
            <div className="flex min-h-0 flex-col gap-4">
                <div>
                    <h3 className="text-lg font-semibold">Salvar uma pesquisa como modelo</h3>
                    <p className="text-sm text-muted-foreground">Guarda só a estrutura (seções, questões, opções e regras). Coletas, respostas e pesquisadores não vão junto.</p>
                </div>
                {!researches ? <LoadingState label="Carregando pesquisas..." /> : (
                    <ul className="max-h-80 space-y-2 overflow-y-auto pr-1">
                        {researches.length === 0 && <li className="text-sm text-muted-foreground">Nenhuma pesquisa encontrada.</li>}
                        {researches.map((r) => (
                            <li key={r.id}>
                                <button
                                    type="button"
                                    onClick={() => saveAsTemplate(r)}
                                    disabled={savingId !== null}
                                    className="flex w-full items-center justify-between gap-3 rounded-xl border border-border bg-white px-4 py-3 text-left text-sm transition hover:border-[var(--green)] hover:shadow-sm disabled:opacity-60"
                                >
                                    <span className="font-medium">{r.title}</span>
                                    <span className="shrink-0 text-xs text-muted-foreground">{savingId === r.id ? 'Salvando...' : 'Salvar como modelo'}</span>
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
                <div className="flex justify-end"><Button variant="ghost" onClick={() => setMode('list')}>Voltar</Button></div>
            </div>
        );
    }

    const items: Item[] = [...customs.map(summarize), ...templates];

    return (
        <div className="flex min-h-0 flex-col gap-4">
            {/* Adicionar mais modelos */}
            <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-dashed border-border bg-muted/30 p-3">
                <p className="mr-auto flex items-center gap-2 text-sm font-medium"><FilePlus2 className="size-4" />Adicionar mais modelos</p>
                <Button variant="outline" size="sm" onClick={openPicker} disabled={busy}><FileJson />De uma pesquisa existente</Button>
                <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()} disabled={busy}><Upload />{busy ? 'Importando...' : 'Importar JSON'}</Button>
                <input ref={fileInput} type="file" accept=".json,application/json" className="hidden" onChange={(e) => importFile(e.target.files?.[0])} />
            </div>

            <div className="grid gap-3 overflow-y-auto sm:grid-cols-2">
                {items.length === 0 && <p className="text-sm text-muted-foreground">Nenhum modelo disponível.</p>}
                {items.map((t) => (
                    <button key={t.id} type="button" onClick={() => { setSelected(t); setTitle(''); }} className="rounded-2xl border border-border bg-white p-4 text-left transition hover:border-[var(--green)] hover:shadow-md">
                        <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                            {t.category}
                            {t.custom && <span className="rounded-full bg-[#e8f0ea] px-2 py-0.5 text-[10px] normal-case tracking-normal text-[#0f1713]">Meu modelo</span>}
                        </p>
                        <p className="font-semibold">{t.name}</p>
                        <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{t.description}</p>
                        <p className="mt-2 text-[11px] text-muted-foreground">{t.sectionCount} seções · {t.questionCount} questões{t.ruleCount ? ` · ${t.ruleCount} regras` : ''}</p>
                    </button>
                ))}
            </div>
            <p className="text-[11px] text-muted-foreground">Os modelos adicionados ficam salvos na sua empresa e aparecem para todos os administradores. Para compartilhar com outra empresa, use “Baixar JSON” no modelo e importe lá.</p>
        </div>
    );
}
