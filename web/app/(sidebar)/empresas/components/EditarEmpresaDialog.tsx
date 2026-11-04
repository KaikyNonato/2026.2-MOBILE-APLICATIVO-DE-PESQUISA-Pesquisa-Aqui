'use client';

import { Button } from "@/components/ui/button";
import { ComboBoxLayout } from "@/components/ui/comboboxLayout";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { updateCompany, type CompanyItem } from "@/lib/company";
import { useState, type FormEvent } from "react";
import toast from "react-hot-toast";
import { situationLabels, situations, type Situation } from "./CadastrarEmpresaForm";

interface EditarEmpresaDialogProps {
    /** Empresa em edição; nulo = caixa fechada. */
    company: CompanyItem | null;
    onOpenChange: (open: boolean) => void;
    onSaved: (updated: CompanyItem) => void;
}

/** Caixa para editar uma empresa. */
export default function EditarEmpresaDialog({ company, onOpenChange, onSaved }: EditarEmpresaDialogProps) {
    // Mantém a última empresa enquanto a caixa fecha, para o conteúdo não sumir no meio da animação.
    const [shown, setShown] = useState<CompanyItem | null>(company);
    if (company && company !== shown) setShown(company);

    return (
        <Dialog open={!!company} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="text-xl tracking-tight">Editar empresa</DialogTitle>
                    <DialogDescription>
                        Altere os dados da empresa. Inativa, ela bloqueia o acesso de todos os usuários dela.
                    </DialogDescription>
                </DialogHeader>

                {shown && (
                    <EditarEmpresaForm
                        key={shown.id}
                        company={shown}
                        onCancel={() => onOpenChange(false)}
                        onSaved={(updated) => {
                            onSaved(updated);
                            onOpenChange(false);
                        }}
                    />
                )}
            </DialogContent>
        </Dialog>
    );
}

/** Formulário de edição da empresa, usado dentro da caixa. */
function EditarEmpresaForm({
    company,
    onCancel,
    onSaved,
}: {
    company: CompanyItem;
    onCancel: () => void;
    onSaved: (updated: CompanyItem) => void;
}) {
    const [legalName, setLegalName] = useState(company.legalName);
    const [contact, setContact] = useState(company.contactInformation ?? '');
    const [situation, setSituation] = useState<Situation>(company.situation);
    const [saving, setSaving] = useState(false);

    const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();

        const nextName = legalName.trim();
        const nextContact = contact.trim();

        if (!nextName || !nextContact) {
            toast.error("Informe o nome e o contato da empresa");
            return;
        }

        // Só envia o que mudou.
        const changes: { legalName?: string; contactInformation?: string; situation?: Situation } = {};
        if (nextName !== company.legalName) changes.legalName = nextName;
        if (nextContact !== (company.contactInformation ?? '')) changes.contactInformation = nextContact;
        if (situation !== company.situation) changes.situation = situation;

        if (Object.keys(changes).length === 0) {
            toast("Nenhuma alteração para salvar");
            onCancel();
            return;
        }

        setSaving(true);
        try {
            const updated = await updateCompany(company.id, changes);
            toast.success("Empresa atualizada com sucesso!");
            onSaved(updated);
        } catch (error) {
            console.error(error);
            toast.error(error instanceof Error ? error.message : "Erro ao salvar alterações");
        } finally {
            setSaving(false);
        }
    };

    return (
        <form onSubmit={handleSubmit}>
            <div className="flex flex-col gap-5">
                <div>
                    <label htmlFor="edit-company-name">Nome da Empresa*</label>
                    <Input
                        required
                        id="edit-company-name"
                        value={legalName}
                        onChange={(e) => setLegalName(e.target.value)}
                        disabled={saving}
                    />
                </div>

                <div>
                    <label htmlFor="edit-company-contact">Contato*</label>
                    <Input
                        required
                        id="edit-company-contact"
                        value={contact}
                        onChange={(e) => setContact(e.target.value)}
                        disabled={saving}
                    />
                </div>

                <div>
                    <label htmlFor="edit-company-situation">Situação*</label>
                    <ComboBoxLayout<Situation>
                        items={situations}
                        labels={situationLabels}
                        value={situation}
                        onValueChange={setSituation}
                        placeholder="Selecione Um Status"
                        emptyMessage="Nenhum Status Encontrado!"
                    />
                </div>

                <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
                        Cancelar
                    </Button>
                    <Button type="submit" disabled={saving}>
                        {saving ? (
                            <span className="flex items-center gap-2">
                                <Spinner />
                                Salvando...
                            </span>
                        ) : (
                            "Salvar alterações"
                        )}
                    </Button>
                </div>
            </div>
        </form>
    );
}
