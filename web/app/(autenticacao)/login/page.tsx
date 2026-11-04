'use client';

import { BrandMark, Contour, Pin } from "@/components/ui/contour";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { login, LoginError } from "@/lib/auth";
import Link from "next/link";
import { SubmitEventHandler, useState } from "react";

/** Página de login. */
export default function Login() {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [showForgotHint, setShowForgotHint] = useState(false);

    const [isLoadingLogin, setIsLoadingLogin] = useState(false);
    const handleSubmit: SubmitEventHandler<HTMLFormElement> = async (e) => {
        e.preventDefault();

        setError(null);
        setIsLoadingLogin(true);

        let mustChangePassword = false;

        try {
            ({ mustChangePassword } = await login(username, password));
        } catch (error) {
            setError(error instanceof LoginError ? error.message : 'Não foi possível entrar agora. Tente novamente.');
            setIsLoadingLogin(false);
            return;
        }

        // Senha temporária (primeiro acesso ou redefinida pelo administrador): troca antes de entrar no painel.
        if (mustChangePassword) {
            window.location.replace('/trocar-senha');
            return;
        }

        // Navegação completa (e não router.push): na Vercel o Next guarda em cache o
        // redirecionamento "/" -> "/login" feito antes do login, e o push reaproveitava
        // esse cache, deixando o usuário na tela de login até recarregar a página.
        // Com location.replace o navegador pede "/" ao servidor já com o cookie novo.
        // O botão continua em "Entrando..." até a página trocar.
        window.location.replace('/');
    };

    return (
        <main className="pa-login">
            <Contour seed={2.4} rings={16} cx={0.62} cy={0.55} size={1.15} width={1400} height={800} />
            <Pin label="Recife" left="45%" top="15%" delay="0s" />
            <Pin label="Caruaru" left="44%" top="78%" tone="clay" delay="1.1s" />

            <section className="pa-login-copy">
                <Link href="/" prefetch={false} className="pa-brand">
                    <BrandMark color="#bfe3d0" />
                    Pesquisa Aqui
                </Link>
                <div>
                    <h1>Cada resposta no lugar certo.</h1>
                    <p className="lead">
                        Monte questionários, acompanhe as coletas em campo e consulte os resultados em um só painel.
                    </p>
                </div>
                <span aria-hidden="true" />
            </section>

            <section className="pa-login-card">
                <form onSubmit={handleSubmit} noValidate>
                    <h2>Entrar</h2>
                    <p className="sub">Use o usuário e a senha fornecidos pela sua empresa.</p>

                    <div className="pa-field">
                        <label htmlFor="username">Usuário</label>
                        <Input
                            id="username"
                            type="text"
                            autoComplete="username"
                            placeholder="nome.sobrenome"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                        />
                    </div>

                    <div className="pa-field">
                        <label htmlFor="password">Senha</label>
                        <Input
                            id="password"
                            type="password"
                            autoComplete="current-password"
                            placeholder="••••••••"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                        />
                    </div>

                    <div style={{ textAlign: 'right', margin: '-4px 0 18px' }}>
                        <button type="button" className="pa-link" onClick={() => setShowForgotHint((v) => !v)} aria-expanded={showForgotHint}>
                            Esqueceu a senha?
                        </button>
                    </div>

                    {showForgotHint && (
                        <p role="note" className="mb-4 rounded-xl bg-[#e9ede9] px-3.5 py-2.5 text-[13px] text-[#26332c]">
                            Peça ao administrador da sua empresa para redefinir a senha. Ele gera uma senha temporária
                            e você escolhe a sua própria no primeiro acesso.
                        </p>
                    )}

                    {error && (
                        <p role="alert" key={error} className="pa-shake mb-4 rounded-xl bg-[#f3e0d9] px-3.5 py-2.5 text-[13px] font-medium text-[#8a432f]">
                            {error}
                        </p>
                    )}

                    <button
                        type="submit"
                        disabled={isLoadingLogin}
                        className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-ink text-[15px] font-medium text-white transition-[background-color,transform,opacity] duration-150 ease-[cubic-bezier(0.2,0,0,1)] hover:bg-[#26332c] active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100 disabled:pointer-events-none disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green"
                    >
                        {isLoadingLogin ? (<><Spinner />Entrando...</>) : 'Entrar'}
                    </button>

                    <p className="mt-5 text-center text-[13px] text-muted-foreground">
                        Ainda não tem acesso?{' '}
                        <Link className="pa-link" href="#">Fale com o administrador</Link>
                    </p>
                </form>
            </section>
        </main>
    );
}
