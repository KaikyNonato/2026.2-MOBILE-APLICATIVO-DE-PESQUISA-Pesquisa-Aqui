"use client";

import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { updateUser, type UserItem } from "@/lib/user";
import { useState, type FormEvent } from "react";
import toast from "react-hot-toast";

// Caixa para editar nome, usuário e (opcionalmente) a senha de um administrador ou pesquisador.
// Uso: <EditUserDialog user={editando} role="pesquisador" onOpenChange={...} onSaved={...} />
// "user" nulo = caixa fechada.

type Role = "administrador" | "pesquisador";

type EditUserDialogProps = {
    user: UserItem | null;
    role: Role;
    onOpenChange: (open: boolean) => void;
    onSaved: (updated: UserItem) => void;
};

/** Caixa para editar um administrador ou pesquisador. */
export default function EditUserDialog({ user, role, onOpenChange, onSaved }: EditUserDialogProps) {
    // Mantém o último usuário enquanto a caixa fecha, para o conteúdo não sumir no meio da animação.
    const [shown, setShown] = useState<UserItem | null>(user);
    if (user && user !== shown) setShown(user);

    return (
        <Dialog open={!!user} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="text-xl tracking-tight">Editar {role}</DialogTitle>
                    <DialogDescription>
                        Altere os dados de acesso. Deixe a senha em branco para mantê-la como está.
                    </DialogDescription>
                </DialogHeader>

                {shown && (
                    <EditUserForm
                        key={shown.username}
                        user={shown}
                        role={role}
                        onCancel={() => onOpenChange(false)}
                        onSaved={(updated) => {
                            onSaved(updated);
                            onOpenChange(false);
                        }}
                    />
                )}
            </DialogContent>
        </Dialog>
    );
}

/** Formulário de edição do usuário, usado dentro do `EditUserDialog`. */
function EditUserForm({
    user,
    role,
    onCancel,
    onSaved,
}: {
    user: UserItem;
    role: Role;
    onCancel: () => void;
    onSaved: (updated: UserItem) => void;
}) {
    const [name, setName] = useState(user.name);
    const [username, setUsername] = useState(user.username);
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [saving, setSaving] = useState(false);

    const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();

        const nextName = name.trim();
        const nextUsername = username.trim();

        if (!nextName || !nextUsername) {
            toast.error("Informe o nome e o usuário");
            return;
        }

        if (password && password.length < 6) {
            toast.error("A senha deve ter pelo menos 6 caracteres");
            return;
        }

        if (password !== confirmPassword) {
            toast.error("As senhas não coincidem");
            return;
        }

        // Só envia o que mudou.
        const changes: { name?: string; username?: string; password?: string } = {};
        if (nextName !== user.name) changes.name = nextName;
        if (nextUsername !== user.username) changes.username = nextUsername;
        if (password) changes.password = password;

        if (Object.keys(changes).length === 0) {
            toast("Nenhuma alteração para salvar");
            onCancel();
            return;
        }

        setSaving(true);
        try {
            const updated = await updateUser(user.username, changes);
            toast.success(`${role === "administrador" ? "Administrador" : "Pesquisador"} atualizado com sucesso!`);
            onSaved(updated);
        } catch (error) {
            console.error(error);
            toast.error(error instanceof Error ? error.message : "Erro ao salvar alterações");
        } finally {
            setSaving(false);
        }
    };

    return (
        <form onSubmit={handleSubmit}>
            <div className="flex flex-col gap-5">
                <div>
                    <label htmlFor="edit-user-name">Nome*</label>
                    <Input
                        required
                        id="edit-user-name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        disabled={saving}
                    />
                </div>

                <div>
                    <label htmlFor="edit-user-username">Usuário*</label>
                    <Input
                        required
                        id="edit-user-username"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        disabled={saving}
                    />
                </div>

                <div>
                    <label htmlFor="edit-user-password">Nova senha</label>
                    <Input
                        type="password"
                        id="edit-user-password"
                        placeholder="Deixe em branco para manter"
                        autoComplete="new-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        disabled={saving}
                    />
                </div>

                {password && (
                    <div>
                        <label htmlFor="edit-user-cpassword">Confirmar nova senha*</label>
                        <Input
                            type="password"
                            required
                            id="edit-user-cpassword"
                            autoComplete="new-password"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            disabled={saving}
                        />
                    </div>
                )}

                <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
                        Cancelar
                    </Button>
                    <Button type="submit" disabled={saving}>
                        {saving ? (
                            <span className="flex items-center gap-2">
                                <Spinner />
                                Salvando...
                            </span>
                        ) : (
                            "Salvar alterações"
                        )}
                    </Button>
                </div>
            </div>
        </form>
    );
}
