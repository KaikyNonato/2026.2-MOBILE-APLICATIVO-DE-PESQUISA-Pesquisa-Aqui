'use client'

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Spinner } from "@/components/ui/spinner";
import { Plus, Save, Trash2, ArrowUp, ArrowDown, FolderPlus } from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";
import { saveQuestionnaire, type FormSection, type FormQuestion, type FrontendQuestionType } from "@/lib/questionnaire";

interface MontarPesquisaFormProps {
    researchId?: string | number;
    onSuccess?: () => void;
}

const QUESTION_TYPES_LABEL: { type: FrontendQuestionType; label: string }[] = [
    { type: "text", label: "Texto Livre" }, { type: "number", label: "Numérica" },
    { type: "date", label: "Data" }, { type: "time", label: "Hora" },
    { type: "boolean", label: "Sim / Não" }, { type: "single-choice", label: "Escolha Única" },
    { type: "multiple-choice", label: "Múltipla Escolha" }, { type: "rating-1-5", label: "Escala de 1 a 5" },
    { type: "photo", label: "Foto" }, { type: "multiple-photos", label: "Várias Fotos" },
    { type: "location", label: "Localização" }, { type: "audio", label: "Áudio" },
];

export default function MontarPesquisaForm({ researchId, onSuccess }: MontarPesquisaFormProps) {
    const createNewQuestion = (order: number): FormQuestion => ({
        id: crypto.randomUUID(), title: "", type: "text", helpText: "",
        required: false, order, options: [{ id: crypto.randomUUID(), text: "Opção 1", order: 1 }],
    });

    const createNewSection = (order: number): FormSection => ({
        id: crypto.randomUUID(), title: "", order, questions: [createNewQuestion(1)]
    });

    const [sections, setSections] = useState<FormSection[]>([createNewSection(1)]);
    const [isSaving, setIsSaving] = useState(false);

    // ================= GERENCIAMENTO DE SEÇÕES =================
    const addSection = () => setSections(prev => [...prev, createNewSection(prev.length + 1)]);

    const removeSection = (sectionId: string) => {
        if (sections.length === 1) return toast.error("A pesquisa deve ter pelo menos uma seção.");
        setSections(prev => prev.filter(s => s.id !== sectionId).map((s, i) => ({ ...s, order: i + 1 })));
    };

    const updateSectionTitle = (sectionId: string, title: string) => {
        setSections(prev => prev.map(s => s.id === sectionId ? { ...s, title } : s));
    };

    const moveSection = (index: number, direction: "up" | "down") => {
        const targetIndex = direction === "up" ? index - 1 : index + 1;
        if (targetIndex < 0 || targetIndex >= sections.length) return;
        const updated = [...sections];
        const [moved] = updated.splice(index, 1);
        updated.splice(targetIndex, 0, moved);
        setSections(updated.map((s, i) => ({ ...s, order: i + 1 })));
    };

    // ================= GERENCIAMENTO DE QUESTÕES =================
    const addQuestion = (sectionId: string) => {
        setSections(prev => prev.map(s => {
            if (s.id === sectionId) return { ...s, questions: [...s.questions, createNewQuestion(s.questions.length + 1)] };
            return s;
        }));
    };

    const removeQuestion = (sectionId: string, questionId: string) => {
        setSections(prev => prev.map(s => {
            if (s.id !== sectionId) return s;
            if (s.questions.length === 1) {
                toast.error("Uma seção não pode ficar sem questões.");
                return s;
            }
            return {
                ...s,
                questions: s.questions.filter(q => q.id !== questionId).map((q, i) => ({ ...q, order: i + 1 }))
            };
        }));
    };

    const updateQuestion = (sectionId: string, questionId: string, field: keyof Omit<FormQuestion, "id" | "options">, value: any) => {
        setSections(prev => prev.map(s => {
            if (s.id !== sectionId) return s;
            return {
                ...s,
                questions: s.questions.map(q => q.id === questionId ? { ...q, [field]: value } : q)
            };
        }));
    };

    const moveQuestion = (sectionId: string, qIndex: number, direction: "up" | "down") => {
        setSections(prev => prev.map(s => {
            if (s.id !== sectionId) return s;
            const targetIndex = direction === "up" ? qIndex - 1 : qIndex + 1;
            if (targetIndex < 0 || targetIndex >= s.questions.length) return s;
            
            const updatedQuestions = [...s.questions];
            const [moved] = updatedQuestions.splice(qIndex, 1);
            updatedQuestions.splice(targetIndex, 0, moved);
            
            return {
                ...s,
                questions: updatedQuestions.map((q, i) => ({ ...q, order: i + 1 }))
            };
        }));
    };

    const hasOptions = (type: FrontendQuestionType) => type === "single-choice" || type === "multiple-choice";

    // ================= SALVAMENTO =================
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!researchId) return toast.error("ID da pesquisa não encontrado.");

        setIsSaving(true);
        try {
            await saveQuestionnaire(Number(researchId), sections);
            toast.success("Questionário montado e ordenado com sucesso!");
            setSections([createNewSection(1)]);
            if (onSuccess) onSuccess();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Erro ao salvar questionário.");
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="mx-auto space-y-6 max-h-[75vh]  px-2 pb-6">
            
            {sections.map((section, sIndex) => (
                <div key={section.id} className="border-2 border-primary/20 bg-muted/30 p-4 rounded-xl space-y-4 shadow-sm">
                    {/* Cabeçalho da Seção com controles de Reordenação */}
                    <div className="flex items-center justify-between gap-2 border-b pb-3">
                        <div className="flex items-center gap-2 flex-1">
                            <span className="bg-primary text-primary-foreground font-bold px-2.5 py-1 rounded-md text-xs">
                                Seção {sIndex + 1}
                            </span>
                            <Input 
                                placeholder="Nome da Seção (Ex: Dados Pessoais)" 
                                value={section.title} 
                                onChange={(e) => updateSectionTitle(section.id, e.target.value)} 
                                required 
                                className="bg-background font-semibold"
                            />
                        </div>
                        <div className="flex items-center gap-1">
                            <Button type="button" variant="ghost" size="icon" onClick={() => moveSection(sIndex, "up")} disabled={sIndex === 0} title="Mover Seção para Cima">
                                <ArrowUp className="w-4 h-4" />
                            </Button>
                            <Button type="button" variant="ghost" size="icon" onClick={() => moveSection(sIndex, "down")} disabled={sIndex === sections.length - 1} title="Mover Seção para Baixo">
                                <ArrowDown className="w-4 h-4" />
                            </Button>
                            <Button type="button" variant="ghost" size="icon" className="text-destructive hover:bg-destructive/10" onClick={() => removeSection(section.id)} title="Excluir Seção">
                                <Trash2 className="w-4 h-4" />
                            </Button>
                        </div>
                    </div>

                    {/* Questões dentro desta Seção */}
                    <div className="space-y-4 pl-2 md:pl-6 border-l-2 border-primary/30">
                        {section.questions.map((q, qIndex) => (
                            <Card key={q.id} className="shadow-sm">
                                <CardHeader className="flex flex-row items-center justify-between py-2.5 bg-muted/50 border-b">
                                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                                        <span>Questão #{q.order}</span>
                                    </CardTitle>
                                    <div className="flex items-center gap-1">
                                        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => moveQuestion(section.id, qIndex, "up")} disabled={qIndex === 0} title="Mover Questão para Cima">
                                            <ArrowUp className="w-3.5 h-3.5" />
                                        </Button>
                                        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => moveQuestion(section.id, qIndex, "down")} disabled={qIndex === section.questions.length - 1} title="Mover Questão para Baixo">
                                            <ArrowDown className="w-3.5 h-3.5" />
                                        </Button>
                                        <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:bg-destructive/10" onClick={() => removeQuestion(section.id, q.id)} title="Remover Questão">
                                            <Trash2 className="w-3.5 h-3.5" />
                                        </Button>
                                    </div>
                                </CardHeader>
                                <CardContent className="space-y-3 pt-3">
                                    <div className="space-y-1">
                                        <Label className="text-xs">Enunciado da Pergunta *</Label>
                                        <Input placeholder="Ex: Qual é a sua idade?" value={q.title} onChange={(e) => updateQuestion(section.id, q.id, "title", e.target.value)} required />
                                    </div>
                                    <div className="space-y-1">
                                        <Label className="text-xs">Texto de Ajuda / Instrução</Label>
                                        <Input placeholder="Opcional" value={q.helpText} onChange={(e) => updateQuestion(section.id, q.id, "helpText", e.target.value)} />
                                    </div>
                                    <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between pt-1">
                                        <div className="space-y-1 flex-1 w-full">
                                            <Label className="text-xs">Tipo de Resposta *</Label>
                                            <Select value={q.type} onValueChange={(val) => updateQuestion(section.id, q.id, "type", val as FrontendQuestionType)}>
                                                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                                                <SelectContent>
                                                    {QUESTION_TYPES_LABEL.map((item) => (
                                                        <SelectItem key={item.type} value={item.type}>{item.label}</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="flex items-center space-x-2 sm:pt-5">
                                            <Switch checked={q.required} onCheckedChange={(c) => updateQuestion(section.id, q.id, "required", c)} />
                                            <Label className="cursor-pointer text-xs">Obrigatória</Label>
                                        </div>
                                    </div>

                                    {hasOptions(q.type) && (
                                        <div className="p-2.5 bg-orange-50 border border-orange-200 text-orange-800 rounded text-xs">
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        ))}

                        <Button type="button" variant="outline" size="sm" onClick={() => addQuestion(section.id)} className="w-full border-dashed">
                            <Plus className="w-4 h-4 mr-2" /> Adicionar Questão nesta Seção
                        </Button>
                    </div>
                </div>
            ))}

            <div className="flex items-center justify-between p-4 sticky bottom-0 bg-background/95 backdrop-blur rounded-xl border shadow-lg z-10">
                <Button type="button" variant="secondary" onClick={addSection} disabled={isSaving}>
                    <FolderPlus className="w-4 h-4 mr-2" /> Nova Seção
                </Button>
                <Button className="bg-primary text-primary-foreground" type="submit" disabled={isSaving}>
                    {isSaving ? (
                        <div className="flex items-center gap-2"><Spinner /><span>Salvando...</span></div>
                    ) : (
                        <><Save className="w-4 h-4 mr-2" /><span>Salvar Questionário</span></>
                    )}
                </Button>
            </div>
        </form>
    );
}