'use client';

import { useState, FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Spinner } from '@/components/ui/spinner';
import { Research } from './TabelaPesquisas';
import toast from 'react-hot-toast';

interface FormEditarDadosPesquisaProps {
    research: Research;
    onSuccess: (updated: Research) => void;
}

export default function FormEditarDadosPesquisa({ research, onSuccess }: FormEditarDadosPesquisaProps) {
    const [title, setTitle] = useState(research.title || '');
    const [description, setDescription] = useState(research.description || '');
    const [objective, setObjective] = useState(research.objective || '');
    const [startDate, setStartDate] = useState(
        research.startDate ? research.startDate.split('T')[0] : ''
    );
    const [endDate, setEndDate] = useState(
        research.endDate ? research.endDate.split('T')[0] : ''
    );
    const [targetAudience, setTargetAudience] = useState(research.targetAudience || '');
    const [recordInterview, setRecordInterview] = useState<boolean>(!!research.recordInterview);
    // Gravar a entrevista é estrutura do questionário: trava enquanto houver aparelho com a pesquisa baixada
    // (research.locked vem da API; o servidor recusa a mudança de qualquer jeito). Rascunho nunca trava.
    const canChangeRecording = research.status === 'DRAFT' || research.locked !== true;
    const [isLoading, setIsLoading] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);

    const datesValid = !startDate || !endDate || startDate <= endDate;

    const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!datesValid) return;

        setIsLoading(true);
        setSubmitError(null);

        const payload = {
            title,
            description,
            objective,
            startDate: startDate ? new Date(startDate).toISOString() : undefined,
            endDate: endDate ? new Date(endDate).toISOString() : undefined,
            targetAudience,
            ...(canChangeRecording ? { recordInterview } : {}),
        };

        try {
            const response = await fetch(`/api/research/${research.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(payload),
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => null);
                throw new Error(
                    Array.isArray(errorData?.message)
                        ? errorData.message.join(', ')
                        : errorData?.message || 'Falha ao atualizar a pesquisa.'
                );
            }

            const savedItem = await response.json();
            onSuccess(savedItem);
            toast.success("Pesquisa Editada Com Sucesso!")
        } catch (err) {
            setSubmitError(err instanceof Error ? err.message : 'Erro ao salvar alterações.');
            toast.error(err instanceof Error ? err.message : 'Erro ao salvar alterações.')
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {submitError && <p className="text-sm text-destructive">{submitError}</p>}

            <div>
                <label className="text-sm font-medium" htmlFor={`title-${research.id}`}>
                    Título*
                </label>
                <Input
                    required
                    id={`title-${research.id}`}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    disabled={isLoading}
                />
            </div>

            <div>
                <label className="text-sm font-medium" htmlFor={`desc-${research.id}`}>
                    Descrição*
                </label>
                <Input
                    required
                    id={`desc-${research.id}`}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    disabled={isLoading}
                />
            </div>

            <div>
                <label className="text-sm font-medium" htmlFor={`obj-${research.id}`}>
                    Objetivo*
                </label>
                <Input
                    required
                    id={`obj-${research.id}`}
                    value={objective}
                    onChange={(e) => setObjective(e.target.value)}
                    disabled={isLoading}
                />
            </div>

            <div className="grid grid-cols-2 gap-3">
                <div>
                    <label className="text-sm font-medium" htmlFor={`start-${research.id}`}>
                        Início*
                    </label>
                    <span>
                        &nbsp;{research.startDate ? `${new Date(research.startDate).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', })}` : '-'}
                    </span>
                    <Input
                        type="date"
                        required
                        id={`start-${research.id}`}
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        disabled={isLoading}
                    />
                </div>
                <div>
                    <label className="text-sm font-medium" htmlFor={`end-${research.id}`}>
                        Término*
                    </label>
                    <span>
                        &nbsp;{research.endDate ? `${new Date(research.endDate).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', })}` : '-'}
                    </span>
                    <Input
                        type="date"
                        required
                        id={`end-${research.id}`}
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        disabled={isLoading}
                    />
                </div>
            </div>

            {!datesValid && (
                <p className="text-destructive text-xs">
                    A data de término deve ser após a data de início.
                </p>
            )}

            <div>
                <label className="text-sm font-medium" htmlFor={`audience-${research.id}`}>
                    Público-Alvo*
                </label>
                <Input
                    required
                    id={`audience-${research.id}`}
                    value={targetAudience}
                    onChange={(e) => setTargetAudience(e.target.value)}
                    disabled={isLoading}
                />
            </div>

            <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
                <div className="flex flex-col gap-1">
                    <label className="text-sm font-medium" htmlFor={`record-${research.id}`}>
                        Gravar a entrevista
                    </label>
                    <p className="text-xs text-muted-foreground">
                        {canChangeRecording
                            ? 'O aplicativo grava o áudio da coleta inteira e exige o consentimento do entrevistado antes de começar.'
                            : 'Não pode ser alterada agora: há aparelhos com a pesquisa baixada. Fica liberada quando todas as cópias forem devolvidas ou revogadas.'}
                    </p>
                </div>
                <Switch
                    id={`record-${research.id}`}
                    checked={recordInterview}
                    onCheckedChange={setRecordInterview}
                    disabled={isLoading || !canChangeRecording}
                />
            </div>

            <div className="flex justify-end pt-2">
                <Button type="submit" disabled={isLoading || !datesValid}>
                    {isLoading ? (
                        <div className="flex items-center gap-2">
                            <Spinner />
                            <span>Salvando...</span>
                        </div>
                    ) : (
                        <span>Salvar Alterações</span>
                    )}
                </Button>
            </div>
        </form>
    );
}