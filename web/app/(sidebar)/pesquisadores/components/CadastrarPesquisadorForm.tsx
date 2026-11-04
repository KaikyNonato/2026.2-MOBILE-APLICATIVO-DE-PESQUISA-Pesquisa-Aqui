'use client';

import { Button } from "@/components/ui/button";
import { RemoteComboBox } from "@/components/ui/remoteCombobox";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { getCompanyOptions } from "@/lib/company";
import { createUser } from "@/lib/user";
import { SubmitEventHandler, useState } from "react";
import toast from "react-hot-toast";

interface CadastrarPesquisadorFormProps {
    /** Perfil de quem está cadastrando. SUPERADMINISTRATOR precisa escolher a empresa. */
    isSuperAdmin?: boolean;
    onSuccess?: () => void;
}

/** Formulário de cadastro de pesquisador. */
export default function CadastrarPesquisadorForm({ isSuperAdmin = false, onSuccess }: CadastrarPesquisadorFormProps) {
    const [name, setName] = useState('');
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [companyId, setCompanyId] = useState('');
    const [isSubmitLoading, setIsSubmitLoading] = useState(false);

    const handleSubmit: SubmitEventHandler<HTMLFormElement> = async (e) => {
        e.preventDefault();

        if (isSuperAdmin && !companyId) {
            toast.error("Selecione uma empresa");
            return;
        }

        if (password.length < 6) {
            toast.error("A senha deve ter no mínimo 6 caracteres");
            return;
        }

        if (password !== confirmPassword) {
            toast.error("As senhas não coincidem");
            return;
        }

        setIsSubmitLoading(true);
        try {
            await createUser(
                name.trim(),
                username.trim(),
                password,
                'RESEARCHER',
                isSuperAdmin ? Number(companyId) : undefined
            );
            toast.success("Pesquisador cadastrado com sucesso!");

            setName('');
            setUsername('');
            setPassword('');
            setConfirmPassword('');
            setCompanyId('');
            onSuccess?.();
        } catch (error) {
            console.error(error);
            toast.error(error instanceof Error ? error.message : "Erro ao cadastrar pesquisador");
        } finally {
            setIsSubmitLoading(false);
        }
    };

    return (
        <form onSubmit={handleSubmit}>
            <div className="flex flex-col gap-5">
                <div>
                    <label htmlFor="researcher-name">Nome*</label>
                    <Input
                        required
                        id="researcher-name"
                        placeholder="João"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                    />
                </div>

                <div>
                    <label htmlFor="researcher-username">Usuário*</label>
                    <Input
                        required
                        id="researcher-username"
                        placeholder="joaozinho"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                    />
                </div>

                <div>
                    <label htmlFor="researcher-password">Senha* (mín. 6 caracteres)</label>
                    <Input
                        type="password"
                        required
                        minLength={6}
                        id="researcher-password"
                        placeholder="••••••"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                    />
                </div>

                <div>
                    <label htmlFor="researcher-cpassword">Confirmar Senha*</label>
                    <Input
                        type="password"
                        required
                        id="researcher-cpassword"
                        placeholder="••••••"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                    />
                </div>

                {isSuperAdmin && (
                    <div>
                        <label>Empresa*</label>
                        {/* Pesquisa e paginação no servidor: a lista de empresas nunca é baixada inteira. */}
                        <RemoteComboBox
                            fetchOptions={getCompanyOptions}
                            value={companyId}
                            onValueChange={setCompanyId}
                            placeholder="Digite para pesquisar a empresa"
                            emptyMessage="Nenhuma empresa encontrada!"
                        />
                    </div>
                )}

                <div className="flex justify-end">
                    <Button disabled={isSubmitLoading} type="submit" className="w-fit">
                        {isSubmitLoading ? (
                            <div className="flex gap-2">
                                <Spinner />
                                Cadastrando...
                            </div>
                        ) : (
                            <span>Cadastrar Pesquisador</span>
                        )}
                    </Button>
                </div>
            </div>
        </form>
    );
}
