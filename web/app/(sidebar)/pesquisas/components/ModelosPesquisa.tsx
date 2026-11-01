'use client'

import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/ui/loadingState";
import { createResearchFromTemplate, getResearchTemplates, type ResearchTemplate } from "@/lib/research";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";

/** Biblioteca de questionários prontos: escolhe um modelo e cria um rascunho já com seções, questões e regras. */
export default function ModelosPesquisa({ onClose }: { onClose?: () => void }) {
    const router = useRouter();
    const [templates, setTemplates] = useState<ResearchTemplate[] | null>(null);
    const [selected, setSelected] = useState<ResearchTemplate | null>(null);
    const [title, setTitle] = useState('');
    const [creating, setCreating] = useState(false);

    useEffect(() => {
        getResearchTemplates().then(setTemplates).catch((e) => { toast.error(e instanceof Error ? e.message : 'Erro ao carregar os modelos'); setTemplates([]); });
    }, []);

    const create = async () => {
        if (!selected) return;
        setCreating(true);
        try {
            const created = await createResearchFromTemplate({ templateId: selected.id, title: title.trim() || undefined });
            toast.success('Rascunho criado a partir do modelo!');
            onClose?.();
            router.push(`/pesquisas/${created.id}`);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Erro ao criar a pesquisa');
            setCreating(false);
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
                <div className="flex justify-end gap-2">
                    <Button variant="ghost" onClick={() => setSelected(null)} disabled={creating}>Voltar</Button>
                    <Button onClick={create} disabled={creating}>{creating ? 'Criando...' : 'Usar este modelo'}</Button>
                </div>
            </div>
        );
    }

    return (
        <div className="grid gap-3 overflow-y-auto sm:grid-cols-2">
            {templates.length === 0 && <p className="text-sm text-muted-foreground">Nenhum modelo disponível.</p>}
            {templates.map((t) => (
                <button key={t.id} type="button" onClick={() => setSelected(t)} className="rounded-2xl border border-border bg-white p-4 text-left transition hover:border-[var(--green)] hover:shadow-md">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t.category}</p>
                    <p className="font-semibold">{t.name}</p>
                    <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{t.description}</p>
                    <p className="mt-2 text-[11px] text-muted-foreground">{t.sectionCount} seções · {t.questionCount} questões{t.ruleCount ? ` · ${t.ruleCount} regras` : ''}</p>
                </button>
            ))}
        </div>
    );
}
