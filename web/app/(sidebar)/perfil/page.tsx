'use client';

import { ChangeEvent, FormEvent, ReactNode, useEffect, useRef, useState } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import {
    ArrowUpRight,
    CalendarDays,
    Camera,
    Check,
    Eye,
    EyeOff,
    History,
    IdCard,
    KeyRound,
    LogOut,
    ShieldCheck,
    Shield,
    UserRound,
} from "lucide-react";
import BannerComponent from "@/components/ui/bannerComponent";
import { Button } from "@/components/ui/button";
import { Contour, Pin } from "@/components/ui/contour";
import { Input } from "@/components/ui/input";
import { LoadingState } from "@/components/ui/loadingState";
import { Spinner } from "@/components/ui/spinner";
import { UserAvatar } from "@/components/ui/user-avatar";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { logout } from "@/lib/auth";
import {
    AVATAR_MAX_BYTES,
    AVATAR_TYPES,
    getProfile,
    removeAvatar,
    updateProfile,
    uploadAvatar,
    type ProfileData,
    type UpdateProfileInput,
} from "@/lib/profile";

const PROFILE_LABELS: Record<string, string> = {
    SUPERADMINISTRATOR: 'Superadministrador',
    ADMINISTRATOR: 'Administrador',
    RESEARCHER: 'Pesquisador',
};

/** Formata uma data ISO por extenso (dia, mês e ano); `—` se for vazia ou inválida. */
const formatLong = (iso?: string) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
        ? '—'
        : d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
};

/** Painel branco com cantos amplos, igual aos do dashboard. */
function Panel({
    icon,
    title,
    description,
    children,
    className = '',
    delay = 1,
}: {
    icon: ReactNode;
    title: string;
    description?: string;
    children: ReactNode;
    className?: string;
    delay?: number;
}) {
    return (
        <article
            style={{ animationDelay: `${delay * 120}ms` }}
            className={`pa-card introduction-card ${className}`}
        >
            <header className="pa-card-h">
                <div className="pa-ic">{icon}</div>
                <div className="grow">
                    <h3>{title}</h3>
                    {description && <p className="desc">{description}</p>}
                </div>
            </header>
            <div className="mt-5">{children}</div>
        </article>
    );
}

/** Campo de formulário com rótulo. */
function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
    return (
        <div className="flex flex-col gap-1.5">
            <label htmlFor={id} className="text-[13px] font-medium">{label}</label>
            {children}
        </div>
    );
}

/** Texto do botão de salvar, com spinner enquanto salva. */
function SaveLabel({ saving, label }: { saving: boolean; label: string }) {
    return saving ? (
        <span className="flex items-center gap-2">
            <Spinner />
            Salvando...
        </span>
    ) : (
        <>{label}</>
    );
}

/** Foto de perfil: escolher, trocar ou remover. A imagem fica no Cloudinary; o servidor também confere tipo e tamanho. */
function AvatarEditor({ profile, onChanged }: { profile: ProfileData; onChanged: (updated: ProfileData) => void }) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [busy, setBusy] = useState<"upload" | "remove" | null>(null);

    const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = ''; // permite escolher o mesmo arquivo de novo depois
        if (!file) return;

        if (!AVATAR_TYPES.includes(file.type)) {
            toast.error('Use uma imagem JPG, PNG ou WebP');
            return;
        }
        if (file.size > AVATAR_MAX_BYTES) {
            toast.error('A foto deve ter no máximo 5 MB');
            return;
        }

        setBusy('upload');
        try {
            onChanged(await uploadAvatar(file));
            toast.success('Foto atualizada!');
        } catch (error) {
            console.error(error);
            toast.error(error instanceof Error ? error.message : 'Erro ao enviar a foto');
        } finally {
            setBusy(null);
        }
    };

    const handleRemove = async () => {
        setBusy('remove');
        try {
            onChanged(await removeAvatar());
            toast.success('Foto removida');
        } catch (error) {
            console.error(error);
            toast.error(error instanceof Error ? error.message : 'Erro ao remover a foto');
        } finally {
            setBusy(null);
        }
    };

    return (
        <div className="flex flex-wrap items-center gap-4 rounded-2xl bg-muted/50 p-4">
            <UserAvatar
                name={profile.name}
                src={profile.avatarUrl}
                size={64}
                className="grid size-16 shrink-0 place-items-center rounded-full bg-[var(--mint)] text-xl font-semibold text-[var(--forest)]"
            />

            <div className="min-w-0 grow basis-48">
                <p className="text-sm font-semibold">Foto de perfil</p>
                <p className="text-xs text-muted-foreground">
                    JPG, PNG ou WebP, até 5 MB. Aparece no menu e no seu perfil.
                </p>
            </div>

            <div className="flex flex-wrap gap-2">
                <input
                    ref={inputRef}
                    type="file"
                    accept={AVATAR_TYPES.join(',')}
                    className="hidden"
                    onChange={handleFile}
                    aria-label="Escolher foto de perfil"
                />
                <Button type="button" variant="outline" size="sm" disabled={busy !== null} onClick={() => inputRef.current?.click()}>
                    {busy === 'upload' ? (
                        <span className="flex items-center gap-2">
                            <Spinner />
                            Enviando...
                        </span>
                    ) : (
                        <>
                            <Camera />
                            {profile.avatarUrl ? 'Trocar foto' : 'Escolher foto'}
                        </>
                    )}
                </Button>
                {profile.avatarUrl && (
                    <Button type="button" variant="outline" size="sm" disabled={busy !== null} onClick={handleRemove}>
                        {busy === 'remove' ? 'Removendo...' : 'Remover'}
                    </Button>
                )}
            </div>
        </div>
    );
}

/** Nome e usuário (o usuário é o que a pessoa digita para entrar). */
function PersonalForm({ profile, onSaved }: { profile: ProfileData; onSaved: (updated: ProfileData) => void }) {
    const [name, setName] = useState(profile.name);
    const [username, setUsername] = useState(profile.username);
    const [saving, setSaving] = useState(false);

    const nextName = name.trim();
    const nextUsername = username.trim();
    const changed = nextName !== profile.name || nextUsername !== profile.username;

    const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();

        if (!nextName || !nextUsername) {
            toast.error('Informe o nome e o usuário');
            return;
        }

        const changes: UpdateProfileInput = {};
        if (nextName !== profile.name) changes.name = nextName;
        if (nextUsername !== profile.username) changes.username = nextUsername;

        if (Object.keys(changes).length === 0) return;

        setSaving(true);
        try {
            const updated = await updateProfile(changes);
            setName(updated.name);
            setUsername(updated.username);
            onSaved(updated);
            toast.success('Perfil atualizado com sucesso!');
        } catch (error) {
            console.error(error);
            toast.error(error instanceof Error ? error.message : 'Erro ao salvar o perfil');
        } finally {
            setSaving(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            <Field id="perfil-nome" label="Nome*">
                <Input
                    required
                    id="perfil-nome"
                    autoComplete="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={saving}
                />
            </Field>

            <Field id="perfil-usuario" label="Usuário*">
                <Input
                    required
                    id="perfil-usuario"
                    autoComplete="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    disabled={saving}
                />
                <p className="text-xs text-muted-foreground">É com este usuário que você entra no painel.</p>
            </Field>

            <div className="flex justify-end gap-2">
                <Button
                    type="button"
                    variant="outline"
                    disabled={saving || !changed}
                    onClick={() => {
                        setName(profile.name);
                        setUsername(profile.username);
                    }}
                >
                    Desfazer
                </Button>
                <Button type="submit" disabled={saving || !changed}>
                    <SaveLabel saving={saving} label="Salvar alterações" />
                </Button>
            </div>
        </form>
    );
}

/** Troca de senha: pede a senha atual e confirma a nova. */
function PasswordForm() {
    const [current, setCurrent] = useState('');
    const [next, setNext] = useState('');
    const [confirm, setConfirm] = useState('');
    const [show, setShow] = useState(false);
    const [saving, setSaving] = useState(false);

    const longEnough = next.length >= 6;
    const matches = next.length > 0 && next === confirm;
    const type = show ? 'text' : 'password';

    const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();

        if (!current) {
            toast.error('Informe a senha atual');
            return;
        }
        if (!longEnough) {
            toast.error('A nova senha deve ter pelo menos 6 caracteres');
            return;
        }
        if (!matches) {
            toast.error('As senhas não coincidem');
            return;
        }
        if (next === current) {
            toast.error('A nova senha deve ser diferente da atual');
            return;
        }

        setSaving(true);
        try {
            await updateProfile({ currentPassword: current, newPassword: next });
            setCurrent('');
            setNext('');
            setConfirm('');
            toast.success('Senha alterada com sucesso!');
        } catch (error) {
            console.error(error);
            toast.error(error instanceof Error ? error.message : 'Erro ao alterar a senha');
        } finally {
            setSaving(false);
        }
    };

    const rule = (ok: boolean, text: string) => (
        <li className={`flex items-center gap-2 text-xs ${ok ? 'text-[var(--green-deep)]' : 'text-muted-foreground'}`}>
            <span
                className={`grid size-4 place-items-center rounded-full ${ok ? 'bg-[var(--green-deep)] text-white' : 'bg-muted'
                    }`}
            >
                {ok && <Check className="size-2.5" strokeWidth={3} />}
            </span>
            {text}
        </li>
    );

    return (
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            <Field id="perfil-senha-atual" label="Senha atual*">
                <Input
                    required
                    id="perfil-senha-atual"
                    type={type}
                    autoComplete="current-password"
                    value={current}
                    onChange={(e) => setCurrent(e.target.value)}
                    disabled={saving}
                />
            </Field>

            <div className="grid gap-5 sm:grid-cols-2">
                <Field id="perfil-senha-nova" label="Nova senha*">
                    <Input
                        required
                        id="perfil-senha-nova"
                        type={type}
                        autoComplete="new-password"
                        value={next}
                        onChange={(e) => setNext(e.target.value)}
                        disabled={saving}
                    />
                </Field>
                <Field id="perfil-senha-confirmar" label="Confirmar nova senha*">
                    <Input
                        required
                        id="perfil-senha-confirmar"
                        type={type}
                        autoComplete="new-password"
                        value={confirm}
                        onChange={(e) => setConfirm(e.target.value)}
                        disabled={saving}
                    />
                </Field>
            </div>

            <ul className="flex flex-col gap-1.5">
                {rule(longEnough, 'Pelo menos 6 caracteres')}
                {rule(matches, 'As duas senhas são iguais')}
            </ul>

            <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                    type="button"
                    onClick={() => setShow((value) => !value)}
                    className="inline-flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                    {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    {show ? 'Ocultar senhas' : 'Mostrar senhas'}
                </button>
                <Button type="submit" disabled={saving || !current || !next || !confirm}>
                    <SaveLabel saving={saving} label="Alterar senha" />
                </Button>
            </div>
        </form>
    );
}

/** Página de perfil: dados pessoais, foto e troca de senha do usuário logado. */
export default function PerfilPage() {
    const { user, loading: userLoading } = useCurrentUser();
    const [profile, setProfile] = useState<ProfileData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    // Todo perfil vê a própria página; só administrador e superadministrador editam os dados.
    const canSeeProfile = !!user;

    useEffect(() => {
        if (!canSeeProfile) return;

        getProfile()
            .then(setProfile)
            .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Erro ao carregar o perfil'))
            .finally(() => setLoading(false));
    }, [canSeeProfile]);

    if (userLoading || (canSeeProfile && loading)) {
        return <LoadingState label="Abrindo o seu perfil..." shape="profile" />;
    }

    if (!canSeeProfile) return null;

    if (error || !profile) {
        return (
            <section className="flex flex-col gap-6">
                <BannerComponent title="Meu perfil" />
                <div className="rounded-[22px] border border-dashed border-input bg-muted/40 p-8 text-center text-sm text-destructive">
                    {error || 'Não foi possível carregar o seu perfil.'}
                </div>
            </section>
        );
    }

    const active = profile.situation !== 'INACTIVE';
    const isSuper = profile.profile === 'SUPERADMINISTRATOR';
    const isResearcher = profile.profile === 'RESEARCHER';
    const profileLabel = PROFILE_LABELS[profile.profile] ?? profile.profile;
    const ProfileIcon = isResearcher ? UserRound : isSuper ? Shield : ShieldCheck;

    return (
        <section className="flex flex-col gap-5">
            {/* Cartão de identificação */}
            <article className="pa-card dark introduction-card !p-0">
                <Contour seed={3.6} rings={14} cx={0.88} cy={0.45} size={1.25} width={900} height={320} />
                <div className="pointer-events-none !absolute inset-0 hidden md:block" aria-hidden="true">
                    <Pin label={profile.companyName ?? (isSuper ? 'Pesquisa Aqui' : 'Sua empresa')} left="82%" top="34%" />
                </div>

                <div className="relative flex flex-col gap-6 p-7 sm:flex-row sm:items-center sm:p-9">
                    <UserAvatar
                        name={profile.name}
                        src={profile.avatarUrl}
                        size={96}
                        className="grid size-24 shrink-0 place-items-center rounded-[28px] bg-[var(--mint)] text-[34px] font-semibold tracking-tight text-[var(--forest)] shadow-[0_18px_40px_-18px_rgba(191,227,208,0.7)] ring-8 ring-[rgba(191,227,208,0.12)]"
                    />

                    <div className="min-w-0">
                        <p className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.14em] text-[var(--muted-dark)]">
                            <UserRound className="size-3.5" /> Meu perfil
                        </p>
                        <h1 className="truncate text-[34px] font-semibold leading-[1.05] tracking-[-0.04em] text-[var(--fg-dark)] sm:text-[40px]">
                            {profile.name}
                        </h1>
                        <p className="mt-1.5 truncate text-[15px] text-[var(--muted-dark)]">@{profile.username}</p>
                        <div className="mt-4 flex flex-wrap items-center gap-2.5">
                            <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-[rgba(191,227,208,0.16)] px-3 text-[13px] font-medium text-[var(--mint)]">
                                <ProfileIcon className="size-3.5" />
                                {profileLabel}
                            </span>
                            <span
                                className={`inline-flex h-7 items-center gap-2 rounded-full px-3 text-[13px] font-medium ${active
                                        ? 'bg-[rgba(191,227,208,0.16)] text-[var(--mint)]'
                                        : 'bg-[rgba(224,145,122,0.18)] text-[#f0b09c]'
                                    }`}
                            >
                                <span className={`size-2 rounded-full ${active ? 'bg-[var(--mint)]' : 'bg-[#e0917a]'}`} />
                                {active ? 'Conta ativa' : 'Conta inativa'}
                            </span>
                            <span className="inline-flex items-center gap-1.5 text-[13px] text-[var(--muted-dark)]">
                                <CalendarDays className="size-3.5" />
                                No Pesquisa Aqui desde {formatLong(profile.createdAt)}
                            </span>
                        </div>
                    </div>
                </div>
            </article>

            <section className="grid grid-cols-1 gap-5 lg:grid-cols-5">
                <Panel
                    delay={1}
                    className="lg:col-span-3"
                    icon={<IdCard />}
                    title="Dados pessoais"
                    description="Como você aparece no painel e o usuário que usa para entrar."
                >
                    <div className="flex flex-col gap-5">
                        <AvatarEditor profile={profile} onChanged={setProfile} />

                        {isResearcher ? (
                            <div className="flex flex-col gap-5">
                                <Field id="perfil-nome" label="Nome">
                                    <Input id="perfil-nome" value={profile.name} readOnly />
                                </Field>
                                <Field id="perfil-usuario" label="Usuário">
                                    <Input id="perfil-usuario" value={profile.username} readOnly />
                                </Field>
                                <p className="rounded-2xl bg-muted/60 p-4 text-sm text-[#3c4a42]">
                                    Seu cadastro é feito pelo administrador da empresa. Para alterar o nome, o usuário
                                    ou a senha, fale com ele.
                                </p>
                            </div>
                        ) : (
                            <PersonalForm profile={profile} onSaved={setProfile} />
                        )}
                    </div>
                </Panel>

                <Panel
                    delay={2}
                    className="lg:col-span-2"
                    icon={<History />}
                    title="Sobre a conta"
                    description="Informações que só podem ser alteradas pelo suporte."
                >
                    <dl className="flex flex-col divide-y divide-border text-sm">
                        <div className="flex items-center justify-between gap-4 py-2.5 first:pt-0">
                            <dt className="text-muted-foreground">Perfil</dt>
                            <dd className="font-medium">{profileLabel}</dd>
                        </div>
                        {!isSuper && (
                            <div className="flex items-center justify-between gap-4 py-2.5">
                                <dt className="text-muted-foreground">Empresa</dt>
                                <dd className="flex min-w-0 items-center justify-end gap-2 font-medium">
                                    {profile.companyLogoUrl && (
                                        <UserAvatar
                                            name={profile.companyName ?? ''}
                                            src={profile.companyLogoUrl}
                                            size={24}
                                            fit="contain"
                                            ariaHidden
                                            className="grid size-6 shrink-0 place-items-center rounded-md border border-border bg-white text-[10px]"
                                        />
                                    )}
                                    {profile.companyName && isResearcher ? (
                                        <span className="truncate">{profile.companyName}</span>
                                    ) : profile.companyName ? (
                                        <Link
                                            href="/empresa"
                                            className="group inline-flex max-w-full items-center gap-1 text-[var(--green-deep)] hover:underline"
                                        >
                                            <span className="truncate">{profile.companyName}</span>
                                            <ArrowUpRight className="size-3.5 shrink-0 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                                        </Link>
                                    ) : (
                                        '—'
                                    )}
                                </dd>
                            </div>
                        )}
                        <div className="flex items-center justify-between gap-4 py-2.5">
                            <dt className="text-muted-foreground">Cadastro em</dt>
                            <dd className="font-medium">{formatLong(profile.createdAt)}</dd>
                        </div>
                        <div className="flex items-center justify-between gap-4 py-2.5 last:pb-0">
                            <dt className="text-muted-foreground">Última atualização</dt>
                            <dd className="font-medium">{formatLong(profile.updatedAt ?? profile.createdAt)}</dd>
                        </div>
                    </dl>
                </Panel>
            </section>

            <section className="grid grid-cols-1 gap-5 lg:grid-cols-5">
                {!isResearcher && (
                    <Panel
                        delay={3}
                        className="lg:col-span-3"
                        icon={<KeyRound />}
                        title="Senha"
                        description="Para trocar, confirme a senha atual."
                    >
                        <PasswordForm />
                    </Panel>
                )}

                <Panel
                    delay={4}
                    className={isResearcher ? "lg:col-span-5" : "lg:col-span-2"}
                    icon={<LogOut />}
                    title="Sessão"
                    description="Encerre o acesso neste navegador."
                >
                    <p className="mb-4 text-sm text-[#3c4a42]">
                        Você está conectado como <b>@{profile.username}</b>. Em computadores compartilhados, saia
                        da conta ao terminar.
                    </p>
                    <Button type="button" variant="destructive" onClick={() => logout()}>
                        <LogOut />
                        Sair da conta
                    </Button>
                </Panel>
            </section>
        </section>
    );
}
