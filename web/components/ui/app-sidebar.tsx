"use client";

import { CountUp } from "@/components/ui/count-up";
import { BrandMark, Contour } from "@/components/ui/contour";
import { GlobalSearch } from "@/components/ui/global-search";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { UserAvatar } from "@/components/ui/user-avatar";
import { useFieldSnapshot } from "@/hooks/useFieldSnapshot";
import { logout } from "@/lib/auth";
import { avatarTone, teamRowsOf } from "@/lib/fieldData";
import { Building2, ChevronLeft, LayoutDashboard, LogIn, LogOut, Menu, NotebookPen, ShieldCheck, UsersRound, X, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type NavItem = {
    href: string;
    label: string;
    icon: LucideIcon;
    profiles: ReadonlyArray<"SUPERADMINISTRATOR" | "ADMINISTRATOR" | "RESEARCHER">;
    /** Contador mostrado ao lado do nome (só para o administrador). */
    count?: "researches" | "researchers";
};

const NAV_ITEMS: NavItem[] = [
    { href: "/", label: "Início", icon: LayoutDashboard, profiles: ["SUPERADMINISTRATOR", "ADMINISTRATOR", "RESEARCHER"] },
    { href: "/empresas", label: "Empresas", icon: Building2, profiles: ["SUPERADMINISTRATOR"] },
    { href: "/administradores", label: "Administradores", icon: ShieldCheck, profiles: ["SUPERADMINISTRATOR"] },
    { href: "/empresa", label: "Empresa", icon: Building2, profiles: ["ADMINISTRATOR"] },
    { href: "/pesquisadores", label: "Pesquisadores", icon: UsersRound, profiles: ["ADMINISTRATOR"], count: "researchers" },
    { href: "/pesquisas", label: "Pesquisas", icon: NotebookPen, profiles: ["ADMINISTRATOR", "RESEARCHER"], count: "researches" },
];

const PROFILE_LABELS: Record<string, string> = {
    SUPERADMINISTRATOR: "Superadministrador",
    ADMINISTRATOR: "Administrador",
    RESEARCHER: "Pesquisador",
};

/** Menu lateral do painel, com os itens de acordo com o perfil do usuário logado. */
export function AppSidebar() {
    const pathname = usePathname();
    const { user } = useCurrentUser();
    const [collapsed, setCollapsed] = useState(false);
    // Celular: o menu é uma gaveta que abre pelo botão da barra superior.
    const [menuOpen, setMenuOpen] = useState(false);
    const closeMenu = () => setMenuOpen(false);

    useEffect(() => {
        if (!menuOpen) return;

        document.body.classList.add("pa-menu-open");
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") setMenuOpen(false);
        };
        // Se a tela crescer (ex.: girar o aparelho) a gaveta deixa de existir: libera a rolagem.
        const media = window.matchMedia("(min-width: 1025px)");
        const onResize = () => { if (media.matches) setMenuOpen(false); };

        window.addEventListener("keydown", onKeyDown);
        media.addEventListener("change", onResize);
        return () => {
            document.body.classList.remove("pa-menu-open");
            window.removeEventListener("keydown", onKeyDown);
            media.removeEventListener("change", onResize);
        };
    }, [menuOpen]);

    const items = NAV_ITEMS.filter((item) => user && item.profiles.includes(user.profile));

    // Só o administrador tem a equipe e as coletas da empresa para acompanhar.
    const isAdmin = user?.profile === "ADMINISTRATOR";
    const { snapshot, loading: fieldLoading } = useFieldSnapshot(isAdmin);
    const inField = useMemo(
        () => teamRowsOf(snapshot).filter((row) => row.inField),
        [snapshot]
    );
    const counts = {
        researches: snapshot?.totals.researches,
        researchers: snapshot?.totals.researchers,
    };

    const isActive = (href: string) =>
        href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

    const logoutUser = async () => {
        try {
            await logout();
        } catch (error) {
            console.log(error);
        }
    };

    const identityClass = "flex min-w-0 flex-1 items-center gap-[10px]";
    const identity = user && (
        <>
            <UserAvatar name={user.name} src={user.avatarUrl} size={38} className="avatar-pa avatar" />
            <div className="who">
                <b>{user.name}</b>
                <span>{PROFILE_LABELS[user.profile] ?? user.profile}</span>
            </div>
        </>
    );

    return (
        <aside className={`pa-side ${collapsed ? "c" : ""} ${menuOpen ? "open" : ""}`}>
            {/* Barra superior: só aparece no celular */}
            <header className="pa-mbar">
                <Link href="/" className="pa-brand" aria-label="Pesquisa Aqui, ir para o início">
                    <BrandMark />
                    <span>Pesquisa Aqui</span>
                </Link>
                <button
                    type="button"
                    className="pa-burger"
                    onClick={() => setMenuOpen(true)}
                    aria-label="Abrir menu"
                    aria-expanded={menuOpen}
                    aria-controls="pa-menu"
                >
                    <Menu strokeWidth={1.8} />
                </button>
            </header>

            <button type="button" className="pa-side-back" onClick={closeMenu} aria-label="Fechar menu" tabIndex={-1} />

            <div className="pa-side-in" id="pa-menu">
                <div className="pa-side-head">
                    <Link href="/" className="pa-brand" aria-label="Pesquisa Aqui, ir para o início">
                        <BrandMark />
                        <span>Pesquisa Aqui</span>
                    </Link>
                    <button type="button" className="pa-close" onClick={closeMenu} aria-label="Fechar menu">
                        <X strokeWidth={1.8} />
                    </button>
                    <button
                        type="button"
                        className="pa-collapse"
                        onClick={() => setCollapsed((value) => !value)}
                        aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
                        aria-expanded={!collapsed}
                    >
                        <ChevronLeft />
                    </button>
                </div>

                <GlobalSearch
                    profile={user?.profile}
                    pages={items.map(({ href, label, icon }) => ({ href, label, icon }))}
                    collapsed={collapsed}
                />

                <div className="pa-sgroup">
                    <p>Navegação</p>
                    <nav className="pa-snav" aria-label="Principal">
                        {items.map(({ href, label, icon: Icon, count }) => (
                            <Link
                                key={href}
                                href={href}
                                className={isActive(href) ? "on" : undefined}
                                aria-current={isActive(href) ? "page" : undefined}
                                title={collapsed ? label : undefined}
                                onClick={closeMenu}
                            >
                                <span className="t"><Icon strokeWidth={1.7} /></span>
                                <span className="l">{label}</span>
                                {count && isAdmin && counts[count] !== undefined && (
                                    <span className="n" aria-label={`${counts[count]} no total`}><CountUp value={counts[count]} /></span>
                                )}
                            </Link>
                        ))}
                    </nav>
                </div>

                {isAdmin && (
                    <div className="pa-live" aria-live="polite">
                        <Contour seed={6.2} rings={8} cx={1.0} cy={0.0} size={1.3} width={240} height={190} />
                        <div className="k"><i />Em campo agora</div>
                        <b>{fieldLoading ? "–" : inField.length}</b>
                        <span className="s">
                            {inField.length === 1 ? "pesquisador coletando" : "pesquisadores coletando"}
                        </span>
                        {inField.length > 0 && (
                            <div className="pa-stack" title={inField.map((row) => row.user.name).join(", ")}>
                                {inField.slice(0, 3).map(({ user: person }) => (
                                    <UserAvatar key={person.id} name={person.name} src={person.avatarUrl} size={32} className={`avatar-pa ${avatarTone(person.id)}`} />
                                ))}
                                {inField.length > 3 && <div className="avatar-pa more">+{inField.length - 3}</div>}
                            </div>
                        )}
                    </div>
                )}

                {user ? (
                    <div className="pa-suser">
                        {/* Todo perfil abre o próprio perfil clicando no nome. */}
                        <Link
                            href="/perfil"
                            className={`${identityClass} rounded-xl transition-opacity hover:opacity-80`}
                            title="Meu perfil"
                            aria-label="Abrir meu perfil"
                            onClick={closeMenu}
                        >
                            {identity}
                        </Link>
                        <button type="button" className="out" onClick={logoutUser} aria-label="Sair da conta">
                            <LogOut strokeWidth={1.7} />
                        </button>
                    </div>
                ) : (
                    <div className="pa-snav" style={{ marginTop: "auto" }}>
                        <Link href="/login">
                            <span className="t"><LogIn strokeWidth={1.7} /></span>
                            <span className="l">Entrar</span>
                        </Link>
                    </div>
                )}
            </div>
        </aside>
    );
}
