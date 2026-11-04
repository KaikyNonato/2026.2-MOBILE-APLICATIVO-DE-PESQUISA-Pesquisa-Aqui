'use client';

import { Button } from "@/components/ui/button";
import { RemoteComboBox } from "@/components/ui/remoteCombobox";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { getCompanyOptions } from "@/lib/company";
import { createUser } from "@/lib/user";
import { SubmitEventHandler, useState } from "react";
import toast from "react-hot-toast";

interface CadastrarAdministradorFormProps {
    /** Chamado depois que o administrador é cadastrado (a página recarrega os dados e fecha o diálogo). */
    onSuccess?: () => void;
}

/** Formulário de cadastro de administrador de empresa (nome, usuário e senha). */
export default function CadastrarAdministradorForm({ onSuccess }: CadastrarAdministradorFormProps) {
    const [name, setName] = useState('');
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');

    const [companyId, setCompanyId] = useState<string>('');

    const [isSubmitLoading, setIsSubmitLoading] = useState(false);
    const handleSubmit: SubmitEventHandler<HTMLFormElement> = async (e) => {
        e.preventDefault();

        if (!companyId) {
            toast.error("Selecione uma empresa");
            return;
        }

        if (password !== confirmPassword) {
            toast.error("As senhas não coincidem");
            return;
        }
        setIsSubmitLoading(true);
        try {
            await createUser(name, username, password, 'ADMINISTRATOR', Number(companyId));
            toast.success("Administrador cadastrado com sucesso!");

            setName('');
            setUsername('');
            setPassword('');
            setConfirmPassword('');
            setCompanyId('');
            onSuccess?.();
        } catch (error) {
            console.error(error);
            toast.error(error instanceof Error ? error.message : "Erro ao cadastrar administrador");
        } finally {
            setIsSubmitLoading(false);
        }
    };

    return (
        <form onSubmit={handleSubmit}>
            <div className="flex flex-col gap-5">
                <div>
                    <label htmlFor="admin-name">Nome*</label>
                    <Input
                        required
                        id="admin-name"
                        placeholder="João"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                    />
                </div>
                <div>
                    <label htmlFor="admin-name">Username*</label>
                    <Input
                        required
                        id="admin-username"
                        placeholder="João.admin"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                    />
                </div>

                <div>
                    <label htmlFor="admin-password">Senha*</label>
                    <Input
                        type="password"
                        required
                        id="admin-password"
                        placeholder="123456"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                    />
                </div>

                <div>
                    <label htmlFor="admin-cpassword">Confirmar Senha*</label>
                    <Input
                        type="password"
                        required
                        id="admin-cpassword"
                        placeholder="123456"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                    />
                </div>

                <div>
                    <label htmlFor="admin-empresa">Empresa*</label>
                    {/* Pesquisa e paginação no servidor: a lista de empresas nunca é baixada inteira. */}
                    <RemoteComboBox
                        fetchOptions={getCompanyOptions}
                        value={companyId}
                        onValueChange={setCompanyId}
                        placeholder="Digite para pesquisar a empresa"
                        emptyMessage="Nenhuma empresa encontrada!"
                    />
                </div>

                <div className="flex justify-end">
                    <Button disabled={isSubmitLoading} type="submit" className="w-fit">
                        {isSubmitLoading ? (
                            <div className="flex gap-2">
                                <Spinner className=""></Spinner>
                                Cadastrando...
                            </div>
                        ) : (
                            <span>Cadastrar Administrador</span>
                        )}
                    </Button>
                </div>
            </div>
        </form>
    );
}
