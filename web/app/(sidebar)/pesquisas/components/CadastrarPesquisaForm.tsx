'use client';

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { createResearch } from "@/lib/research";
import { SubmitEventHandler, useState } from "react";
import { Spinner } from "@/components/ui/spinner";
import toast from "react-hot-toast";

interface CadastrarPesquisaFormProps {
    onSuccess?: () => void;
}

/** Formulário de criação de pesquisa. */
export default function CadastrarPesquisaForm({ onSuccess }: CadastrarPesquisaFormProps) {
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [objective, setObjective] = useState('');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [targetAudience, setTargetAudience] = useState('');
    const [recordInterview, setRecordInterview] = useState(false);

    const datesValid = !startDate || !endDate || startDate <= endDate;

    const [isSubmitLoading, setIsSubmitLoading] = useState(false);

    const handleSubmit: SubmitEventHandler<HTMLFormElement> = async (e) => {
        e.preventDefault();

        if (!datesValid) {
            toast.error("A data de término não pode ser anterior à data de início");
            return;
        }

        setIsSubmitLoading(true);

        try {
            await createResearch(
                title,
                description,
                objective,
                startDate,
                endDate,
                targetAudience,
                recordInterview
            );

            toast.success("Pesquisa criada com sucesso!");

            setTitle('');
            setDescription('');
            setObjective('');
            setStartDate('');
            setEndDate('');
            setTargetAudience('');
            setRecordInterview(false);

            if (onSuccess) {
                onSuccess();
            }
        } catch (error) {
            console.error(error);

            toast.error(
                error instanceof Error
                    ? error.message
                    : "Erro ao criar pesquisa"
            );
        } finally {
            setIsSubmitLoading(false);
        }
    };

    return (
        <form onSubmit={handleSubmit}>
            <div className="flex flex-col gap-5">
                <div>
                    <label htmlFor="title">Titulo*</label>
                    <Input
                        required
                        id="title"
                        placeholder="Pesquisa Exemplo"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        disabled={isSubmitLoading}
                    />
                </div>

                <div>
                    <label htmlFor="description">Descrição*</label>
                    <Input
                        type="text"
                        required
                        id="description"
                        placeholder="Descrição exemplo"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        disabled={isSubmitLoading}
                    />
                </div>

                <div>
                    <label htmlFor="Objective">Objetivo*</label>
                    <Input
                        type="text"
                        required
                        id="Objective"
                        placeholder="Objetivo exemplo"
                        value={objective}
                        onChange={(e) => setObjective(e.target.value)}
                        disabled={isSubmitLoading}
                    />
                </div>

                <div>
                    <label htmlFor="startDate">Data de início*</label>
                    <Input
                        type="date"
                        required
                        id="startDate"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        disabled={isSubmitLoading}
                    />
                </div>
                <div>
                    <label htmlFor="endDate">Data de término*</label>
                    <Input
                        type="date"
                        required
                        id="endDate"
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        disabled={isSubmitLoading}
                    />
                </div>
                {!datesValid && (
                    <p className="text-destructive text-sm mt-1">
                        A data de término deve ser após a data de início
                    </p>
                )}
                <div>
                    <label htmlFor="publico">Público Alvo*</label>
                    <Input
                        type="text"
                        required
                        id="publico"
                        placeholder="Público Alvo Exemplo"
                        value={targetAudience}
                        onChange={(e) => setTargetAudience(e.target.value)}
                        disabled={isSubmitLoading}
                    />
                </div>

                <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
                    <div className="flex flex-col gap-1">
                        <label htmlFor="recordInterview" className="font-medium">Gravar a entrevista</label>
                        <p className="text-xs text-muted-foreground">
                            O aplicativo grava o áudio da coleta inteira, em segundo plano, e exige a confirmação de que o
                            entrevistado consentiu antes de começar. Depois que a pesquisa for publicada, esta opção não pode mais ser alterada.
                        </p>
                    </div>
                    <Switch
                        id="recordInterview"
                        checked={recordInterview}
                        onCheckedChange={setRecordInterview}
                        disabled={isSubmitLoading}
                    />
                </div>

                <div className="flex justify-end">
                    <Button
                        type="submit"
                        className="w-fit"
                        disabled={isSubmitLoading}
                    >
                        {isSubmitLoading ? (
                            <div className="flex items-center gap-2">
                                <Spinner />
                                <span>Cadastrando...</span>
                            </div>
                        ) : (
                            <span>Cadastrar Pesquisa</span>
                        )}
                    </Button>
                </div>
            </div>
        </form>
    );
}
