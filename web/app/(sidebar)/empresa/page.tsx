'use client';

import { ReactNode, useEffect, useState } from "react";
import Link from "next/link";
import BannerComponent from "@/components/ui/bannerComponent";
import { Contour, Pin } from "@/components/ui/contour";
import { UserAvatar } from "@/components/ui/user-avatar";
import EditarImagensEmpresa, { CoverBanner } from "./components/ImagensEmpresa";
import { getCompanies } from "@/lib/company";
import { getResearchers, setAllResearchersSituation } from "@/lib/user";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { confirmDialog } from "@/components/ui/confirm-dialog";
import toast from "react-hot-toast";
import { LoadingState } from "@/components/ui/loadingState";
import {
    ArrowUpRight,
    Check,
    ClipboardList,
    Copy,
    Fingerprint,
    Mail,
    MapPinned,
    Phone,
    ShieldCheck,
    ShieldOff,
    Smartphone,
    UsersRound,
    AtSign,
    CalendarDays,
    History,
} from "lucide-react";

export interface Company {
    id?: string;
    legalName: string;
    contactInformation: string;
    situation?: 'ACTIVE' | 'INACTIVE';
    logoUrl?: string | null;
    coverUrl?: string | null;
    createdAt?: string;
    updatedAt?: string;
}

/** Formata uma data ISO por extenso (dia, mês e ano); `—` se for vazia ou inválida. */
const formatLong = (iso?: string) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
        ? '—'
        : d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
};

type ContactKind = 'email' | 'phone' | 'text';

/**
 * Classifica uma linha de contato (e-mail, telefone ou texto) e monta o link correspondente, quando
 * existe.
 */
const classifyContact = (line: string): { kind: ContactKind; href?: string } => {
    const value = line.trim();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return { kind: 'email', href: `mailto:${value}` };
    const digits = value.replace(/\D/g, '');
    if (digits.length >= 8 && /^[\d\s()+\-.]+$/.test(value)) return { kind: 'phone', href: `tel:${digits}` };
    return { kind: 'text' };
};

const CONTACT_ICON: Record<ContactKind, ReactNode> = {
    email: <Mail />,
    phone: <Phone />,
    text: <AtSign />,
};

/** Botão que copia o valor para a área de transferência e mostra a confirmação por instantes. */
function CopyButton({ value }: { value: string }) {
    const [copied, setCopied] = useState(false);

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1800);
        } catch (e) {
            console.error(e);
        }
    };

    return (
        <button
            type="button"
            onClick={copy}
            aria-label="Copiar código da empresa"
            className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium transition-all ${copied ? 'bg-[var(--green-deep)] text-white' : 'bg-ink text-white hover:bg-[#26332c]'
                }`}
        >
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {copied ? 'Copiado' : 'Copiar'}
        </button>
    );
}

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

/** Página da empresa do usuário logado: dados, contatos e imagens. */
export default function EmpresaPage() {
    const [company, setCompany] = useState<Company | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const { user } = useCurrentUser();
    // Pesquisadores da empresa: total e quantos podem entrar no app (só o administrador mexe nisso).
    const [team, setTeam] = useState<{ total: number; active: number } | null>(null);
    const [savingAccess, setSavingAccess] = useState(false);
    const isCompanyAdmin = user?.profile === 'ADMINISTRATOR';

    useEffect(() => {
        if (!isCompanyAdmin) return;
        getResearchers()
            .then((list) => setTeam({ total: list.length, active: list.filter((r) => r.situation !== 'INACTIVE').length }))
            .catch(() => setTeam(null));
    }, [isCompanyAdmin]);

    const handleToggleAccess = async (block: boolean) => {
        if (!team) return;
        const ok = await confirmDialog({
            title: block ? 'Bloquear o aplicativo para todos?' : 'Liberar o aplicativo para todos?',
            description: block
                ? `Os ${team.total} pesquisadores da empresa perdem o acesso ao aplicativo agora, inclusive quem está logado. As coletas já feitas ficam salvas.`
                : `Os ${team.total} pesquisadores da empresa voltam a poder entrar no aplicativo, inclusive quem foi desativado individualmente.`,
            confirmLabel: block ? 'Bloquear todos' : 'Liberar todos',
            variant: block ? 'destructive' : 'default',
        });
        if (!ok) return;

        try {
            setSavingAccess(true);
            const result = await setAllResearchersSituation(block ? 'INACTIVE' : 'ACTIVE');
            setTeam({ total: result.total, active: result.active });
            toast.success(block ? 'Aplicativo bloqueado para todos os pesquisadores.' : 'Aplicativo liberado para todos os pesquisadores.');
        } catch (err: any) {
            toast.error(err.message || 'Falha ao alterar o acesso dos pesquisadores');
        } finally {
            setSavingAccess(false);
        }
    };

    useEffect(() => {
        /** Carrega a empresa do usuário e controla os estados de carregando e erro. */
        async function loadData() {
            try {
                setLoading(true);
                const data = await getCompanies();

                const currentCompany = Array.isArray(data) ? data[0] : data;
                setCompany(currentCompany);
            } catch (err: any) {
                setError(err.message || 'Erro ao carregar dados da empresa');
            } finally {
                setLoading(false);
            }
        }

        loadData();
    }, []);

    if (loading) {
        return <LoadingState label="Abrindo os dados da empresa..." shape="profile" />;
    }

    if (error || !company) {
        return (
            <section className="flex flex-col gap-6">
                <BannerComponent title="Empresa" />
                <div className="rounded-[22px] border border-dashed border-input bg-muted/40 p-8 text-center text-sm text-destructive">
                    {error || 'Nenhuma empresa encontrada para esta conta.'}
                </div>
            </section>
        );
    }

    const companyActive = company.situation === 'ACTIVE';
    // Coleta liberada = empresa ativa e ao menos um pesquisador com acesso (ou equipe ainda desconhecida).
    const everyoneBlocked = !!team && team.total > 0 && team.active === 0;
    const isActive = companyActive && !everyoneBlocked;
    const partial = companyActive && !!team && team.active > 0 && team.active < team.total;
    const contacts = (company.contactInformation || '')
        .split(/\r?\n|;/)
        .map((l) => l.trim())
        .filter(Boolean);

    // Logo e capa trocados na janela de edição: o cartão do topo já mostra as novas imagens.
    const handleImagesChanged = (updated: { logoUrl?: string | null; coverUrl?: string | null; updatedAt?: string }) =>
        setCompany((current) =>
            current
                ? {
                    ...current,
                    logoUrl: updated.logoUrl ?? null,
                    coverUrl: updated.coverUrl ?? null,
                    updatedAt: updated.updatedAt ?? current.updatedAt,
                }
                : current,
        );

    return (
        <section className="flex flex-col gap-5">
            {/* Credencial da empresa */}
            <article className="pa-card dark introduction-card overflow-hidden !p-0">
                {/* Capa (se houver): faixa no topo; o cartão com logo e nome vem logo abaixo */}
                <CoverBanner url={company.coverUrl} />

                <div className="relative">
                    <Contour seed={7} rings={14} cx={0.88} cy={0.45} size={1.25} width={900} height={320} />
                    <div className="pointer-events-none !absolute inset-0 hidden md:block" aria-hidden="true">
                        <Pin
                            label={isActive ? "Coleta liberada" : "Coleta bloqueada"}
                            tone={isActive ? "mint" : "clay"}
                            left="82%"
                            top="34%"
                        />
                    </div>

                    <div className="relative flex flex-col gap-6 p-7 sm:flex-row sm:items-center sm:p-9">
                        <UserAvatar
                            name={company.legalName}
                            src={company.logoUrl}
                            size={96}
                            fit="contain"
                            className={`grid size-24 shrink-0 place-items-center rounded-[28px] text-[34px] font-semibold tracking-tight shadow-[0_18px_40px_-18px_rgba(191,227,208,0.7)] ring-8 ring-[rgba(191,227,208,0.12)] ${company.logoUrl ? 'bg-white p-2.5' : 'bg-[var(--mint)] text-[var(--forest)]'
                                }`}
                        />

                        <div className="min-w-0">
                            <p className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.14em] text-[var(--muted-dark)]">
                                <MapPinned className="size-3.5" /> Empresa
                            </p>
                            <h1 className="truncate text-[34px] font-semibold leading-[1.05] tracking-[-0.04em] text-[var(--fg-dark)] sm:text-[40px]">
                                {company.legalName}
                            </h1>
                            <div className="mt-4 flex flex-wrap items-center gap-2.5">
                                <span
                                    className={`inline-flex h-7 items-center gap-2 rounded-full px-3 text-[13px] font-medium ${companyActive
                                            ? 'bg-[rgba(191,227,208,0.16)] text-[var(--mint)]'
                                            : 'bg-[rgba(224,145,122,0.18)] text-[#f0b09c]'
                                        }`}
                                >
                                    <span className="relative flex size-2">
                                        {companyActive && (
                                            <span className="absolute inline-flex size-full animate-ping rounded-full bg-[var(--mint)] opacity-60" />
                                        )}
                                        <span
                                            className={`relative inline-flex size-2 rounded-full ${companyActive ? 'bg-[var(--mint)]' : 'bg-[#e0917a]'
                                                }`}
                                        />
                                    </span>
                                    {companyActive ? 'Cadastro ativo' : 'Cadastro inativo'}
                                </span>
                                <span className="inline-flex items-center gap-1.5 text-[13px] text-[var(--muted-dark)]">
                                    <CalendarDays className="size-3.5" />
                                    No Pesquisa Aqui desde {formatLong(company.createdAt)}
                                </span>
                                {isCompanyAdmin && (
                                    <EditarImagensEmpresa
                                        company={{
                                            id: Number(company.id),
                                            legalName: company.legalName,
                                            logoUrl: company.logoUrl,
                                            coverUrl: company.coverUrl,
                                        }}
                                        onChanged={handleImagesChanged}
                                        className="sm:absolute sm:bottom-7 sm:right-7"
                                    />
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </article>

            <section className="grid grid-cols-1 gap-5 lg:grid-cols-5">
                {/* Coleta no aplicativo */}
                <Panel
                    delay={1}
                    className={`lg:col-span-3 ${isActive ? 'mint' : 'clay'}`}
                    icon={isActive ? <ShieldCheck /> : <ShieldOff />}
                    title="Coleta no aplicativo"
                    description="Define se a equipe pode coletar em campo."
                >
                    <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
                        {/* celular ilustrado */}
                        <div className="relative mx-auto h-[132px] w-[78px] shrink-0 rounded-[20px] border-[3px] border-[var(--forest)] bg-white p-1.5 shadow-[0_16px_30px_-18px_rgba(10,20,16,0.6)] sm:mx-0">
                            <div className="mx-auto mb-1.5 h-1 w-6 rounded-full bg-[var(--forest)]/80" />
                            <div
                                className={`grid h-[96px] place-items-center rounded-xl ${isActive ? 'bg-[var(--mint)]' : 'bg-[#e9b9a9]'
                                    }`}
                            >
                                {isActive ? (
                                    <Smartphone className="size-7 text-[var(--green-deep)]" />
                                ) : (
                                    <ShieldOff className="size-7 text-[var(--clay-ink)]" />
                                )}
                            </div>
                        </div>

                        <div>
                            <p className="text-lg font-semibold tracking-tight">
                                {isActive ? 'Liberada' : 'Bloqueada'}
                            </p>
                            <p className="mt-1 max-w-md text-sm text-[#3c4a42]">
                                {isActive
                                    ? 'Os pesquisadores podem baixar pesquisas e enviar coletas.'
                                    : 'Os pesquisadores não conseguem entrar no aplicativo.'}
                            </p>
                            {!companyActive && (
                                <p className="mt-2 text-xs text-muted-foreground">
                                    Fale com o suporte informando o código da empresa para reativar.
                                </p>
                            )}
                            {companyActive && partial && team && (
                                <p className="mt-2 text-xs text-muted-foreground">
                                    {team.active} de {team.total} pesquisadores com acesso ao aplicativo.
                                </p>
                            )}
                            {companyActive && isCompanyAdmin && team && team.total > 0 && (
                                <div className="mt-4 flex flex-wrap gap-2">
                                    {team.active > 0 && (
                                        <button
                                            type="button"
                                            disabled={savingAccess}
                                            onClick={() => handleToggleAccess(true)}
                                            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[#bcd8c9] bg-white/70 px-4 text-[13px] font-medium text-[var(--forest)] shadow-[0_8px_18px_-14px_rgba(10,20,16,0.5)] backdrop-blur-sm transition-all hover:bg-white hover:shadow-[0_10px_20px_-14px_rgba(10,20,16,0.6)] disabled:opacity-50 [&>svg]:text-[#b4533a]"
                                        >
                                            <ShieldOff className="size-3.5" />
                                            {savingAccess ? 'Salvando...' : 'Bloquear todos os pesquisadores'}
                                        </button>
                                    )}
                                    {team.active < team.total && (
                                        <button
                                            type="button"
                                            disabled={savingAccess}
                                            onClick={() => handleToggleAccess(false)}
                                            className="inline-flex h-9 items-center gap-1.5 rounded-full bg-ink px-4 text-[13px] font-medium text-white transition-all hover:bg-[#26332c] disabled:opacity-50"
                                        >
                                            <ShieldCheck className="size-3.5" />
                                            {savingAccess ? 'Salvando...' : 'Liberar todos os pesquisadores'}
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </Panel>

                {/* Código */}
                <Panel
                    delay={2}
                    className="lg:col-span-2"
                    icon={<Fingerprint />}
                    title="Código da empresa"
                    description="Use este código ao falar com o suporte."
                >
                    <div className="flex items-center gap-2 rounded-2xl border border-dashed border-input bg-muted/50 p-2 pl-4">
                        <code className="min-w-0 flex-1 truncate font-mono text-lg font-semibold tracking-wide">
                            {company.id || 'Não informado'}
                        </code>
                        {company.id && <CopyButton value={String(company.id)} />}
                    </div>
                </Panel>
            </section>

            <section className="grid grid-cols-1 gap-5 lg:grid-cols-5">
                {/* Contato */}
                <Panel
                    delay={3}
                    className="lg:col-span-3"
                    icon={<Phone />}
                    title="Contato"
                    description="Como falar com a organização."
                >
                    {contacts.length === 0 ? (
                        <p className="text-sm text-muted-foreground">Nenhum contato informado.</p>
                    ) : (
                        <ul className="grid gap-2.5 sm:grid-cols-2">
                            {contacts.map((line, i) => {
                                const { kind, href } = classifyContact(line);
                                const inner = (
                                    <>
                                        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#e4ece7] text-[var(--green-deep)] transition-colors group-hover:bg-[var(--forest)] group-hover:text-[var(--mint)] [&>svg]:size-[18px]">
                                            {CONTACT_ICON[kind]}
                                        </span>
                                        <span className="min-w-0 flex-1 break-words text-sm font-medium">{line}</span>
                                        {href && (
                                            <ArrowUpRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                                        )}
                                    </>
                                );
                                const cls =
                                    'group flex items-center gap-3 rounded-2xl border border-border bg-white p-2.5 pr-3.5 transition-all hover:border-[#c6d0c9] hover:shadow-[0_14px_26px_-22px_rgba(10,20,16,0.5)]';

                                return (
                                    <li key={i}>
                                        {href ? (
                                            <a href={href} className={cls}>{inner}</a>
                                        ) : (
                                            <div className={cls}>{inner}</div>
                                        )}
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </Panel>

                {/* Linha do tempo */}
                <Panel
                    delay={4}
                    className="lg:col-span-2"
                    icon={<History />}
                    title="Histórico do cadastro"
                    description="Datas importantes da conta."
                >
                    <ol className="relative flex flex-col gap-5 pl-6 before:absolute before:bottom-1 before:left-[7px] before:top-1 before:w-px before:bg-border">
                        <li className="relative">
                            <span className="absolute -left-6 top-1 size-[15px] rounded-full border-[3px] border-white bg-[var(--green)] ring-1 ring-[var(--green)]" />
                            <p className="text-[13px] text-muted-foreground">Empresa cadastrada</p>
                            <p className="text-sm font-medium">{formatLong(company.createdAt)}</p>
                        </li>
                        <li className="relative">
                            <span className="absolute -left-6 top-1 size-[15px] rounded-full border-[3px] border-white bg-[var(--mint)] ring-1 ring-[var(--green)]" />
                            <p className="text-[13px] text-muted-foreground">Última atualização</p>
                            <p className="text-sm font-medium">{formatLong(company.updatedAt ?? company.createdAt)}</p>
                        </li>
                    </ol>
                </Panel>
            </section>

            {/* Atalhos */}
            <section className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                {[
                    { href: '/pesquisadores', icon: <UsersRound />, title: 'Equipe de campo', text: 'Veja e cadastre os pesquisadores da empresa.' },
                    { href: '/pesquisas', icon: <ClipboardList />, title: 'Pesquisas', text: 'Acompanhe as pesquisas e as coletas em andamento.' },
                ].map((s, i) => (
                    <Link
                        key={s.href}
                        href={s.href}
                        style={{ animationDelay: `${(5 + i) * 120}ms` }}
                        className="pa-card introduction-card group flex items-center gap-4 !p-5"
                    >
                        <div className="pa-ic">{s.icon}</div>
                        <div className="grow">
                            <h3>{s.title}</h3>
                            <p className="desc">{s.text}</p>
                        </div>
                        <span className="grid size-10 place-items-center rounded-full bg-muted text-ink transition-all group-hover:bg-[var(--forest)] group-hover:text-[var(--mint)]">
                            <ArrowUpRight className="size-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                        </span>
                    </Link>
                ))}
            </section>
        </section>
    );
}
