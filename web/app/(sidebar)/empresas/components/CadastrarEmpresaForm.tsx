'use client';

import { Button } from "@/components/ui/button";
import { ComboBoxLayout } from "@/components/ui/comboboxLayout";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { createCompany } from "@/lib/company";
import { SubmitEventHandler, useState } from "react";
import toast from "react-hot-toast";

export type Situation = "ACTIVE" | "INACTIVE";

export const situations: Situation[] = ["ACTIVE", "INACTIVE"];

export const situationLabels: Record<Situation, string> = {
    ACTIVE: "Ativo",
    INACTIVE: "Inativo",
};

interface CadastrarEmpresaFormProps {
    /** Chamado depois que a empresa é cadastrada (a página recarrega os dados e fecha o diálogo). */
    onSuccess?: () => void;
}

/** Formulário de cadastro de empresa (razão social, contato e situação). */
export default function CadastrarEmpresaForm({ onSuccess }: CadastrarEmpresaFormProps) {
    const [legalName, setLegalName] = useState('');
    const [contact, setContact] = useState('');
    const [situation, setSituation] = useState<Situation | ''>('');

    const [isSubmitLoading, setIsSubmitLoading] = useState(false);

    const handleSubmit: SubmitEventHandler<HTMLFormElement> = async (e) => {
        e.preventDefault();

        if (!situation) {
            toast.error("Selecione uma situação");
            return;
        }

        setIsSubmitLoading(true);

        try {
            await createCompany(legalName, contact, situation);

            toast.success("Empresa cadastrada com sucesso!");

            setLegalName('');
            setContact('');
            setSituation('');
            onSuccess?.();
        } catch (error) {
            console.error(error);

            toast.error(
                error instanceof Error
                    ? error.message
                    : "Erro ao cadastrar empresa"
            );
        } finally {
            setIsSubmitLoading(false);
        }
    };

    return (
        <form onSubmit={handleSubmit}>
            <div className="flex flex-col gap-5">
                <div>
                    <label htmlFor="company-name">Nome da Empresa*</label>
                    <Input
                        required
                        id="company-name"
                        placeholder="Razão Social"
                        value={legalName}
                        onChange={(e) => setLegalName(e.target.value)}
                        disabled={isSubmitLoading}
                    />
                </div>

                <div>
                    <label htmlFor="company-contact">Contato*</label>
                    <Input
                        required
                        id="company-contact"
                        placeholder="+00 00 0000-0000"
                        value={contact}
                        onChange={(e) => setContact(e.target.value)}
                        disabled={isSubmitLoading}
                    />
                </div>

                <div>
                    <label htmlFor="company-situation">Situação*</label>
                    <ComboBoxLayout<Situation>
                        items={situations}
                        labels={situationLabels}
                        value={situation}
                        onValueChange={setSituation}
                        placeholder="Selecione Um Status"
                        emptyMessage="Nenhum Status Encontrado!"
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
                            <span>Cadastrar Empresa</span>
                        )}
                    </Button>
                </div>
            </div>
        </form>
    );
}
