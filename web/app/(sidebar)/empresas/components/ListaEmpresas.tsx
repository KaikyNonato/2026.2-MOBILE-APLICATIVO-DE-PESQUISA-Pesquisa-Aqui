'use client';

import { useState } from 'react';
import { usePagedResource } from '@/hooks/usePagedResource';
import { deactivate, deleteCompany, getCompaniesPage, type CompanyItem } from '@/lib/company';
import { Button } from '@/components/ui/button';
import {
    DataTable,
    DataTableToolbar,
    Muted,
    PersonCell,
    RowActions,
    TableChip,
    TableEmpty,
    TableFilters,
    TableSearch,
    TableViewControls,
    type DataColumn,
    type TableSort,
    type TableView,
} from '@/components/ui/data-table';
import { Building2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { confirmDialog } from '@/components/ui/confirm-dialog';
import EditarEmpresaDialog from './EditarEmpresaDialog';

interface ListaEmpresasProps {
    allowActions?: boolean;
    /** Totais para os filtros (vêm de `getCompanyStats`): a lista em si é paginada no servidor. */
    counts?: { companies: number; activeCompanies: number };
    /** Muda quando o pai quer recarregar a lista (ex.: depois de cadastrar). */
    reloadKey?: number;
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
    createdAt?: string;
}

type StatusFilter = 'ALL' | 'ACTIVE' | 'INACTIVE';

const formatDate = (iso?: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('pt-BR');
};

export default function ListaEmpresas({
    allowActions = true,
    counts,
    reloadKey = 0,
    onCompanyUpdated,
    onCompanyDeleted,
}: ListaEmpresasProps) {
    const [actionError, setActionError] = useState<string | null>(null);
    const [deletingCompany, setDeletingCompany] = useState<number | null>(null);
    const [editingCompany, setEditingCompany] = useState<RawCompany | null>(null);

    const [status, setStatus] = useState<StatusFilter>('ALL');
    const [sort, setSort] = useState<TableSort>('recent');
    const [view, setView] = useState<TableView>('table');

    // O servidor devolve só a página que aparece (busca, situação e ordem são feitas lá).
    const companiesList = usePagedResource<RawCompany>(
        (params) => getCompaniesPage({ ...params, situation: status === 'ALL' ? undefined : status, sort }),
        { filters: { status, sort, reloadKey } },
    );
    const { search, setSearch, error } = companiesList;
    const companies = companiesList.items;
    const rawCompanies = companies;

    const handleCompanySaved = (updated: CompanyItem) => {
        companiesList.reload();
        onCompanyUpdated?.(updated);
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

    const hasFilter = search.trim().length > 0 || status !== 'ALL';

    const clear = () => {
        setSearch('');
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
                            variant="outline"
                            size="sm"
                            className="text-[var(--clay-ink)]"
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

    return (
        <div className="flex flex-col">
            <DataTableToolbar>
                <TableSearch
                    value={search}
                    onChange={setSearch}
                    placeholder="Buscar empresa ou contato..."
                    label="Buscar"
                />
                <div className="grow flex flex-wrap items-center gap-2">
                    {counts && counts.companies > 0 && (
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
                    <TableViewControls sort={sort} onSortChange={setSort} view={view} onViewChange={setView} />
                </div>
            </DataTableToolbar>

            {error && <p className="mb-3 text-sm text-destructive">Erro: {error}</p>}
            {actionError && <p className="mb-3 rounded-xl bg-[#f3e0d9] px-3.5 py-2 text-sm text-[#8a432f]">{actionError}</p>}

            <DataTable
                label="Empresas"
                columns={companyColumns}
                rows={companies}
                getRowKey={(c) => c.id}
                loading={companiesList.loading}
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

            {allowActions && (
                <EditarEmpresaDialog
                    company={editingCompany}
                    onOpenChange={(open) => { if (!open) setEditingCompany(null); }}
                    onSaved={handleCompanySaved}
                />
            )}
        </div>
    );
}
