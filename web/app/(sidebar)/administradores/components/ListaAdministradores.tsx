'use client';

import { useState } from 'react';
import { useBusySet } from '@/hooks/useBusySet';
import { usePagedResource } from '@/hooks/usePagedResource';
import { deleteUser, getAdminsPage, setUserSituation, type UserItem } from '@/lib/user';
import { Button } from '@/components/ui/button';
import {
    DataTable,
    DataTableToolbar,
    PersonCell,
    RowActions,
    TableChip,
    TableEmpty,
    TableSearch,
    TableViewControls,
    type DataColumn,
    type TableSort,
    type TableView,
    useTableView,
} from '@/components/ui/data-table';
import { UsersRound } from 'lucide-react';
import toast from 'react-hot-toast';
import { confirmDialog } from '@/components/ui/confirm-dialog';
import { confirmAndResetPassword } from '@/components/ui/reset-password';
import EditUserDialog from '@/components/ui/edit-user-dialog';

type Admin = UserItem;

interface ListaAdministradoresProps {
    allowActions?: boolean;
    /** Muda quando o pai quer recarregar a lista (ex.: depois de cadastrar). */
    reloadKey?: number;
    /** Chamado depois que um administrador é excluído, para a página manter contadores e gráficos em dia. */
    onAdminDeleted?: (username: string) => void;
    /** Chamado depois de editar um administrador. */
    onAdminUpdated?: (admin: UserItem) => void;
}

// Dicionário para traduzir os perfis no front-end
const PROFILE_TRANSLATION: Record<string, string> = {
    SUPERADMINISTRATOR: 'Super Administrador',
    ADMINISTRATOR: 'Administrador',
    RESEARCHER: 'Pesquisador',
};

/**
 * Lista de administradores, com busca, paginação e as ações permitidas (editar, ativar ou desativar
 * e excluir).
 */
export default function ListaAdministradores({
    allowActions = true,
    reloadKey = 0,
    onAdminDeleted,
    onAdminUpdated,
}: ListaAdministradoresProps) {
    const [actionError, setActionError] = useState<string | null>(null);
    const [deletingAdmin, setDeletingAdmin] = useState<string | null>(null);
    const togglingAdmin = useBusySet<string>();
    const [editingAdmin, setEditingAdmin] = useState<Admin | null>(null);

    const [sort, setSort] = useState<TableSort>('recent');
    const [view, setView] = useTableView('cards');

    // O servidor devolve só a página que aparece (busca e ordem são feitas lá).
    const adminsList = usePagedResource<Admin>((params) => getAdminsPage({ ...params, sort }), {
        filters: { sort, reloadKey },
    });
    const { search, setSearch, error } = adminsList;
    const admins = adminsList.items;
    const rawAdmins = admins;

    const handleAdminSaved = (updated: UserItem) => {
        adminsList.reload();
        onAdminUpdated?.(updated);
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

    const hasFilter = search.trim().length > 0;

    const clear = () => setSearch('');

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
                        <Button variant="outline" size="sm" onClick={() => confirmAndResetPassword(a)}>
                            Redefinir senha
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
            <DataTableToolbar>
                <TableSearch
                    value={search}
                    onChange={setSearch}
                    placeholder="Buscar nome ou usuário..."
                    label="Buscar"
                />
                <div className="grow flex flex-wrap items-center gap-2">
                    <TableViewControls sort={sort} onSortChange={setSort} view={view} onViewChange={setView} />
                </div>
            </DataTableToolbar>

            {error && <p className="mb-3 text-sm text-destructive">Erro: {error}</p>}
            {actionError && <p className="mb-3 rounded-xl bg-[#f3e0d9] px-3.5 py-2 text-sm text-[#8a432f]">{actionError}</p>}

            <DataTable
                label="Administradores"
                columns={adminColumns}
                rows={admins}
                getRowKey={(a) => a.id}
                loading={adminsList.loading}
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

            {allowActions && (
                <EditUserDialog
                    user={editingAdmin}
                    role="administrador"
                    onOpenChange={(open) => { if (!open) setEditingAdmin(null); }}
                    onSaved={handleAdminSaved}
                />
            )}
        </div>
    );
}
