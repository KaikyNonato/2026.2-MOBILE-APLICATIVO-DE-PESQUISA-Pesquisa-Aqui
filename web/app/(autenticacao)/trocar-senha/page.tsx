'use client';

import { BrandMark, Contour } from "@/components/ui/contour";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { changePassword, logout, passwordProblem, PASSWORD_RULES } from "@/lib/auth";
import { SubmitEventHandler, useState } from "react";

/**
 * Tela exibida depois do login quando a senha é temporária (cadastro novo ou redefinição feita pelo
 * administrador).
 * O servidor só libera o painel depois que a senha for trocada (ver AuthGuard, na API).
 */
export default function TrocarSenha() {
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmation, setConfirmation] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    const handleSubmit: SubmitEventHandler<HTMLFormElement> = async (e) => {
        e.preventDefault();
        setError(null);

        const problem = passwordProblem(newPassword);

        if (!currentPassword) return setError('Informe a senha temporária que você recebeu.');
        if (problem) return setError(problem);
        if (newPassword !== confirmation) return setError('A confirmação não é igual à nova senha.');
        if (newPassword === currentPassword) return setError('A nova senha precisa ser diferente da temporária.');

        setSaving(true);

        try {
            await changePassword(currentPassword, newPassword);
        } catch (error) {
            setError(error instanceof Error ? error.message : 'Não foi possível trocar a senha.');
            setSaving(false);
            return;
        }

        // Navegação completa, como no login: o cookie novo já está no navegador.
        window.location.replace('/');
    };

    return (
        <main className="pa-login">
            <Contour seed={2.4} rings={16} cx={0.62} cy={0.55} size={1.15} width={1400} height={800} />

            <section className="pa-login-copy">
                <span className="pa-brand">
                    <BrandMark color="#bfe3d0" />
                    Pesquisa Aqui
                </span>
                <div>
                    <h1>Escolha a sua senha.</h1>
                    <p className="lead">
                        A senha que você recebeu é temporária. Defina uma só sua para continuar.
                    </p>
                </div>
                <span aria-hidden="true" />
            </section>

            <section className="pa-login-card">
                <form onSubmit={handleSubmit} noValidate>
                    <h2>Trocar senha</h2>
                    <p className="sub">{PASSWORD_RULES}</p>

                    <div className="pa-field">
                        <label htmlFor="current">Senha temporária</label>
                        <Input id="current" type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
                    </div>

                    <div className="pa-field">
                        <label htmlFor="new">Nova senha</label>
                        <Input id="new" type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
                    </div>

                    <div className="pa-field">
                        <label htmlFor="confirm">Repita a nova senha</label>
                        <Input id="confirm" type="password" autoComplete="new-password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} />
                    </div>

                    {error && (
                        <p role="alert" key={error} className="pa-shake mb-4 rounded-xl bg-[#f3e0d9] px-3.5 py-2.5 text-[13px] font-medium text-[#8a432f]">
                            {error}
                        </p>
                    )}

                    <button
                        type="submit"
                        disabled={saving}
                        className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-ink text-[15px] font-medium text-white transition-[background-color,transform,opacity] duration-150 ease-[cubic-bezier(0.2,0,0,1)] hover:bg-[#26332c] active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100 disabled:pointer-events-none disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green"
                    >
                        {saving ? (<><Spinner />Salvando...</>) : 'Salvar e entrar'}
                    </button>

                    <p className="mt-5 text-center text-[13px] text-muted-foreground">
                        <button type="button" className="pa-link" onClick={() => logout()}>Sair</button>
                    </p>
                </form>
            </section>
        </main>
    );
}
