'use client';

import { useState } from 'react';
import { useBusySet } from '@/hooks/useBusySet';
import { usePagedResource } from '@/hooks/usePagedResource';
import { deactivate, deleteCompany, getCompaniesPage, type CompanyItem } from '@/lib/company';
import { deleteUser, getAdminsPage, setUserSituation, type UserItem } from '@/lib/user';
import { Button } from '@/components/ui/button';
import {
    DataTable,
    DataTableHeader,
    DataTableToolbar,
    Muted,
    PersonCell,
    RowActions,
    TableChip,
    TableEmpty,
    TableFilters,
    TableSearch,
    TableTabs,
    TableViewControls,
    type DataColumn,
    type TableSort,
    type TableView,
    useTableView,
} from '@/components/ui/data-table';
import { Building2, UsersRound } from 'lucide-react';
import toast from 'react-hot-toast';
import { confirmDialog } from '@/components/ui/confirm-dialog';
import EditUserDialog from '@/components/ui/edit-user-dialog';
import EditarEmpresaDialog from './EditarEmpresaDialog';

type Admin = UserItem;

interface ExibirEditarProps {
    allowActions?: boolean;
    /** Totais para as abas e filtros (vêm de `getCompanyStats`): a lista em si é paginada no servidor. */
    counts?: { companies: number; activeCompanies: number; admins: number };
    /** Muda quando o pai quer recarregar as listas (ex.: depois de cadastrar). */
    reloadKey?: number;
    /** Chamado depois que um administrador é excluído, para a página manter contadores e gráficos em dia. */
    onAdminDeleted?: (username: string) => void;
    /** Chamado depois de editar um administrador. */
    onAdminUpdated?: (admin: UserItem) => void;
    /** Chamado depois de editar ou desativar uma empresa. */
    onCompanyUpdated?: (company: CompanyItem) => void;
    /** Chamado depois de excluir uma empresa. */
    onCompanyDeleted?: (id: number) => void;
}

interface RawCompany {
    id: number;
    legalName: string;
    contactInformation: string;
    situation: 'ACTIVE' | 'INACTIVE';
    logoUrl?: string | null;
    createdAt?: string;
}

type Tab = 'companies' | 'admins';
type StatusFilter = 'ALL' | 'ACTIVE' | 'INACTIVE';

// Dicionário para traduzir os perfis no front-end
const PROFILE_TRANSLATION: Record<string, string> = {
    SUPERADMINISTRATOR: 'Super Administrador',
    ADMINISTRATOR: 'Administrador',
    RESEARCHER: 'Pesquisador',
};

/** Formata uma data ISO como dd/mm/aaaa (vazio se for inválida). */
const formatDate = (iso?: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('pt-BR');
};

/**
 * Lista de empresas usada no painel inicial do superadministrador, com as ações de editar,
 * desativar e excluir (quando permitidas).
 */
export default function ExibirEditar({
    allowActions = true,
    counts,
    reloadKey = 0,
    onAdminDeleted,
    onAdminUpdated,
    onCompanyUpdated,
    onCompanyDeleted,
}: ExibirEditarProps) {
    const [actionError, setActionError] = useState<string | null>(null);
    const [deletingAdmin, setDeletingAdmin] = useState<string | null>(null);
    const togglingAdmin = useBusySet<string>();
    const [deletingCompany, setDeletingCompany] = useState<number | null>(null);
    const [editingCompany, setEditingCompany] = useState<RawCompany | null>(null);
    const [editingAdmin, setEditingAdmin] = useState<Admin | null>(null);

    const [tab, setTab] = useState<Tab>('companies');
    const [status, setStatus] = useState<StatusFilter>('ALL');
    const [sort, setSort] = useState<TableSort>('recent');
    const [view, setView] = useTableView('cards');

    // Cada aba pede ao servidor só a página que aparece (busca, situação e ordem são feitas lá).
    // Só a aba aberta faz requisição.
    const companiesList = usePagedResource<RawCompany>(
        (params) => getCompaniesPage({ ...params, situation: status === 'ALL' ? undefined : status, sort }),
        { filters: { status, sort, reloadKey }, enabled: tab === 'companies' },
    );
    const adminsList = usePagedResource<Admin>((params) => getAdminsPage({ ...params, sort }), {
        filters: { sort, reloadKey },
        enabled: tab === 'admins',
    });
    const active = tab === 'companies' ? companiesList : adminsList;
    const error = active.error;
    const { search, setSearch } = active;
    const rawCompanies = companiesList.items;
    const rawAdmins = adminsList.items;
    const loadingCompanies = companiesList.loading;
    const loadingAdmins = adminsList.loading;

    const handleCompanySaved = (updated: CompanyItem) => {
        companiesList.reload();
        onCompanyUpdated?.(updated);
    };

    const handleAdminSaved = (updated: UserItem) => {
        adminsList.reload();
        onAdminUpdated?.(updated);
    };

    const handleDeleteCompany = async (id: string) => {
        const company = rawCompanies.find((c) => String(c.id) === id);

        const confirmed = await confirmDialog({
            title: 'Excluir empresa',
            description: `Tem certeza que deseja excluir a empresa "${company?.legalName ?? id}"? Esta ação não pode ser desfeita.\n\nEmpresas com administradores, pesquisadores ou pesquisas vinculados não podem ser excluídas; nesse caso, use "Desativar".`,
            confirmLabel: 'Excluir',
            variant: 'destructive',
        });
        if (!confirmed) return;

        setActionError(null);
        setDeletingCompany(+id);

        try {
            await deleteCompany(+id);

            companiesList.reload();
            onCompanyDeleted?.(+id);
            toast.success(`Empresa "${company?.legalName ?? id}" excluída`);
        } catch (err) {
            setActionError(err instanceof Error ? err.message : 'Erro ao excluir empresa');
        } finally {
            setDeletingCompany(null);
        }
    };

    const handleDeactivateCompany = async (id: string) => {
        const company = rawCompanies.find((c) => String(c.id) === id);

        const confirmed = await confirmDialog({
            title: 'Desativar empresa',
            description: `Tem certeza que deseja desativar a empresa "${company?.legalName ?? id}"? Isso impedirá o acesso de todos os usuários dela ao sistema.`,
            confirmLabel: 'Desativar',
            variant: 'destructive',
        });
        if (!confirmed) return;

        setActionError(null);

        try {
            await deactivate(+id);

            companiesList.reload();
            if (company) onCompanyUpdated?.({ ...company, situation: 'INACTIVE' });
        } catch (err) {
            setActionError(err instanceof Error ? err.message : 'Erro ao desativar empresa');
        }
    };

    const handleToggleAdminSituation = async (username: string) => {
        const admin = rawAdmins.find((a) => a.username === username);
        if (!admin) return;

        const deactivating = admin.situation !== 'INACTIVE';

        if (deactivating) {
            const confirmed = await confirmDialog({
                title: 'Desativar administrador',
                description: `Tem certeza que deseja desativar o administrador "${admin.name}"? Ele não conseguirá entrar no sistema até ser reativado.`,
                confirmLabel: 'Desativar',
                variant: 'destructive',
            });
            if (!confirmed) return;
        }

        setActionError(null);
        togglingAdmin.start(username);

        try {
            const updated = await setUserSituation(username, deactivating ? 'INACTIVE' : 'ACTIVE');

            adminsList.reload();
            onAdminUpdated?.(updated);
            toast.success(deactivating ? 'Administrador desativado' : 'Administrador reativado');
        } catch (err) {
            setActionError(err instanceof Error ? err.message : 'Erro ao alterar a situação do administrador');
        } finally {
            togglingAdmin.stop(username);
        }
    };

    const handleDeactivateAdmin = async (username: string) => {
        const admin = rawAdmins.find((a) => a.username === username);

        const confirmed = await confirmDialog({
            title: 'Excluir administrador',
            description: `Tem certeza que deseja excluir o administrador "${admin?.name ?? username}"? Ele perderá o acesso ao sistema e esta ação não pode ser desfeita.`,
            confirmLabel: 'Excluir',
            variant: 'destructive',
        });
        if (!confirmed) return;

        setActionError(null);
        setDeletingAdmin(username);

        try {
            await deleteUser(username);

            adminsList.reload();
            onAdminDeleted?.(username);
            toast.success(`Administrador "${admin?.name ?? username}" excluído`);
        } catch (err) {
            setActionError(err instanceof Error ? err.message : 'Erro ao excluir administrador');
        } finally {
            setDeletingAdmin(null);
        }
    };

    const hasFilter = search.trim().length > 0 || (tab === 'companies' && status !== 'ALL');

    const companies = companiesList.items;
    const admins = adminsList.items;

    const clear = () => {
        setSearch('');
        setStatus('ALL');
    };

    const switchTab = (t: Tab) => {
        companiesList.setSearch('');
        adminsList.setSearch('');
        setTab(t);
        setStatus('ALL');
    };

    const companyColumns: DataColumn<RawCompany>[] = [
        {
            id: 'name',
            header: 'Empresa',
            minWidth: '14rem',
            cell: (c) => (
                <PersonCell
                    id={c.id}
                    name={c.legalName}
                    sub={formatDate(c.createdAt) ? `Desde ${formatDate(c.createdAt)}` : undefined}
                    square
                    avatarUrl={c.logoUrl}
                />
            ),
        },
        {
            id: 'contact',
            header: 'Contato',
            cell: (c) => c.contactInformation || <Muted>Sem contato</Muted>,
        },
        {
            id: 'status',
            header: 'Situação',
            cell: (c) =>
                c.situation === 'ACTIVE' ? (
                    <TableChip tone="live">Ativa</TableChip>
                ) : (
                    <TableChip tone="off">Inativa</TableChip>
                ),
        },
        ...(allowActions
            ? [{
                id: 'actions',
                header: 'Ações',
                hideHeader: true,
                align: 'right',
                cell: (c: RawCompany) => (
                    <RowActions>
                        <Button variant="outline" size="sm" onClick={() => setEditingCompany(c)}>
                            Editar
                        </Button>
                        <Button
                            variant="destructive"
                            size="sm"
                            disabled={c.situation !== 'ACTIVE'}
                            onClick={() => handleDeactivateCompany(String(c.id))}
                        >
                            {c.situation === 'ACTIVE' ? 'Desativar' : 'Desativada'}
                        </Button>
                        <Button
                            variant="destructive"
                            size="sm"
                            disabled={deletingCompany !== null}
                            onClick={() => handleDeleteCompany(String(c.id))}
                        >
                            {deletingCompany === c.id ? 'Excluindo...' : 'Excluir'}
                        </Button>
                    </RowActions>
                ),
            } as DataColumn<RawCompany>]
            : []),
    ];

    const adminColumns: DataColumn<Admin>[] = [
        {
            id: 'name',
            header: 'Administrador',
            minWidth: '14rem',
            cell: (a) => <PersonCell id={Number(a.id) || a.name.length} name={a.name} username={a.username} avatarUrl={a.avatarUrl} />,
        },
        {
            id: 'profile',
            header: 'Perfil',
            cell: (a) => <TableChip tone="done">{PROFILE_TRANSLATION[a.profile] ?? a.profile}</TableChip>,
        },
        {
            id: 'situation',
            header: 'Situação',
            cell: (a) =>
                a.situation === 'INACTIVE' ? (
                    <TableChip tone="off">Inativo</TableChip>
                ) : (
                    <TableChip tone="live">Ativo</TableChip>
                ),
        },
        ...(allowActions
            ? [{
                id: 'actions',
                header: 'Ações',
                hideHeader: true,
                align: 'right',
                cell: (a: Admin) => (
                    <RowActions>
                        <Button variant="outline" size="sm" onClick={() => setEditingAdmin(a)}>
                            Editar
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={togglingAdmin.has(a.username)}
                            onClick={() => handleToggleAdminSituation(a.username)}
                        >
                            {togglingAdmin.has(a.username) ? 'Aguarde...' : a.situation === 'INACTIVE' ? 'Reativar' : 'Desativar'}
                        </Button>
                        <Button
                            variant="destructive"
                            size="sm"
                            disabled={deletingAdmin !== null}
                            onClick={() => handleDeactivateAdmin(String(a.username))}
                        >
                            {deletingAdmin === a.username ? 'Excluindo...' : 'Excluir'}
                        </Button>
                    </RowActions>
                ),
            } as DataColumn<Admin>]
            : []),
    ];

    return (
        <div className="flex flex-col">
            <TableTabs<Tab>
                label="Listas"
                value={tab}
                onChange={switchTab}
                options={[
                    { value: 'companies', label: 'Empresas', count: counts?.companies, icon: <Building2 /> },
                    { value: 'admins', label: 'Administradores', count: counts?.admins, icon: <UsersRound /> },
                ]}
            />

            <DataTableHeader
                title={tab === 'companies' ? 'Empresas cadastradas' : 'Administradores cadastrados'}
                count={active.loading ? undefined : active.total}
            />

            <DataTableToolbar>
                <TableSearch
                    value={search}
                    onChange={setSearch}
                    placeholder={tab === 'companies' ? 'Buscar empresa ou contato...' : 'Buscar nome ou usuário...'}
                    label="Buscar"
                />
                <div className="grow flex flex-wrap items-center gap-2">
                    {tab === 'companies' && counts && counts.companies > 0 && (
                        <TableFilters<StatusFilter>
                            label="Situação"
                            value={status}
                            onChange={setStatus}
                            options={[
                                { value: 'ALL', label: 'Todas', count: counts.companies },
                                { value: 'ACTIVE', label: 'Ativas', count: counts.activeCompanies },
                                { value: 'INACTIVE', label: 'Inativas', count: counts.companies - counts.activeCompanies },
                            ]}
                        />
                    )}
                    <TableViewControls sort={sort} onSortChange={setSort} view={view} onViewChange={setView} onRefresh={active.reload} refreshing={active.fetching} />
                </div>
            </DataTableToolbar>

            {error && <p className="mb-3 text-sm text-destructive">Erro: {error}</p>}
            {actionError && <p className="mb-3 rounded-xl bg-[#f3e0d9] px-3.5 py-2 text-sm text-[#8a432f]">{actionError}</p>}

            {tab === 'companies' ? (
                <DataTable
                    label="Empresas"
                    columns={companyColumns}
                    rows={companies}
                    getRowKey={(c) => c.id}
                    loading={loadingCompanies}
                    loadingLabel="Carregando empresas..."
                    view={view}
                    server={companiesList.server}
                    empty={
                        <TableEmpty
                            icon={hasFilter ? undefined : <Building2 />}
                            title={hasFilter ? 'Nada encontrado' : 'Nenhuma empresa cadastrada ainda.'}
                            onClear={hasFilter ? clear : undefined}
                        />
                    }
                />
            ) : (
                <DataTable
                    label="Administradores"
                    columns={adminColumns}
                    rows={admins}
                    getRowKey={(a) => a.id}
                    loading={loadingAdmins}
                    loadingLabel="Carregando administradores..."
                    view={view}
                    server={adminsList.server}
                    empty={
                        <TableEmpty
                            icon={hasFilter ? undefined : <UsersRound />}
                            title={hasFilter ? 'Nada encontrado' : 'Nenhum administrador cadastrado ainda.'}
                            onClear={hasFilter ? clear : undefined}
                        />
                    }
                />
            )}

            {allowActions && (
                <>
                    <EditarEmpresaDialog
                        company={editingCompany}
                        onOpenChange={(open) => { if (!open) setEditingCompany(null); }}
                        onSaved={handleCompanySaved}
                    />
                    <EditUserDialog
                        user={editingAdmin}
                        role="administrador"
                        onOpenChange={(open) => { if (!open) setEditingAdmin(null); }}
                        onSaved={handleAdminSaved}
                    />
                </>
            )}
        </div>
    );
}
