import { confirmDialog } from "@/components/ui/confirm-dialog";
import { resetUserPassword } from "@/lib/user";
import toast from "react-hot-toast";

/**
 * Fluxo "esqueci a senha" assistido: quem gerencia a conta confirma, a API gera uma senha
 * temporária aleatória e ela
 * aparece UMA vez para ser repassada à pessoa, que precisa trocá-la no primeiro acesso. Devolve
 * true se redefiniu.
 */
export async function confirmAndResetPassword(user: { name: string; username: string }): Promise<boolean> {
    const confirmed = await confirmDialog({
        title: "Redefinir senha",
        description: `Gerar uma senha temporária para "${user.name}"? A senha atual deixa de funcionar, as sessões abertas são encerradas e a pessoa precisará escolher uma nova senha no próximo acesso.`,
        confirmLabel: "Gerar senha temporária",
    });
    if (!confirmed) return false;

    try {
        const { temporaryPassword } = await resetUserPassword(user.username);

        const copy = await confirmDialog({
            title: "Senha temporária gerada",
            description: `Repasse esta senha a "${user.name}" por um canal seguro. Ela só aparece agora: ${temporaryPassword}`,
            confirmLabel: "Copiar senha",
            cancelLabel: "Fechar",
        });

        if (copy) {
            try {
                await navigator.clipboard.writeText(temporaryPassword);
                toast.success("Senha copiada.");
            } catch {
                toast.error("Não foi possível copiar. Anote a senha antes de fechar.");
            }
        }

        return true;
    } catch (error) {
        toast.error(error instanceof Error ? error.message : "Falha ao redefinir a senha");
        return false;
    }
}
