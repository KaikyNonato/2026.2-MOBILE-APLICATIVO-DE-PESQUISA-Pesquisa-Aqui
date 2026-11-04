"use client";

import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { CircleHelp, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

// Caixa de confirmação do painel. Substitui window.confirm / confirm em TODO o front.
//
//   const ok = await confirmDialog({ title: "Excluir pesquisador", description: "...", variant: "destructive" })
//   if (!ok) return
//
// Funciona em qualquer lugar (componentes, hooks e arquivos em /lib), porque <ConfirmDialogHost />
// fica montado uma única vez no layout raiz. Fechar a caixa (Esc, clique fora ou "Cancelar") = false.

export type ConfirmOptions = {
    title: string;
    description?: ReactNode;
    /** Lista curta exibida abaixo da descrição (ex.: regras afetadas). */
    details?: string[];
    confirmLabel?: string;
    cancelLabel?: string;
    /** "destructive" deixa a caixa em tom de alerta (exclusões, perda de dados). */
    variant?: "default" | "destructive";
};

type Pending = ConfirmOptions & { resolve: (value: boolean) => void };

let openHandler: ((options: ConfirmOptions) => Promise<boolean>) | null = null;

/**
 * Abre a caixa de confirmação e devolve `true` se a pessoa confirmar. Sem o `ConfirmDialogHost`
 * montado devolve `false`: não age sem perguntar.
 */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
    // Sem o host montado nada é confirmado: melhor não agir do que apagar sem perguntar.
    if (!openHandler) return Promise.resolve(false);
    return openHandler(options);
}

/**
 * Caixa de confirmação do painel. Precisa ficar montada uma vez no layout para o `confirmDialog`
 * funcionar.
 */
export function ConfirmDialogHost() {
    const [pending, setPending] = useState<Pending | null>(null);
    const [open, setOpen] = useState(false);
    const pendingRef = useRef<Pending | null>(null);

    const settle = useCallback((value: boolean) => {
        pendingRef.current?.resolve(value);
        pendingRef.current = null;
        setOpen(false);
    }, []);

    useEffect(() => {
        openHandler = (options) =>
            new Promise<boolean>((resolve) => {
                // Se já havia uma pergunta aberta, ela é cancelada.
                pendingRef.current?.resolve(false);
                const next: Pending = { ...options, resolve };
                pendingRef.current = next;
                setPending(next);
                setOpen(true);
            });

        return () => {
            openHandler = null;
            pendingRef.current?.resolve(false);
            pendingRef.current = null;
        };
    }, []);

    const destructive = pending?.variant === "destructive";

    return (
        <Dialog open={open} onOpenChange={(next) => { if (!next) settle(false); }}>
            <DialogContent showCloseButton={false} className="sm:max-w-md">
                <DialogHeader className="items-start gap-3">
                    <div
                        className={cn(
                            "flex size-11 items-center justify-center rounded-full",
                            destructive ? "bg-[#f3e0d9] text-[#8a432f]" : "bg-mint text-forest"
                        )}
                    >
                        {destructive ? <TriangleAlert className="size-5" /> : <CircleHelp className="size-5" />}
                    </div>
                    <DialogTitle className="text-xl tracking-tight">{pending?.title}</DialogTitle>
                    {pending?.description && (
                        <DialogDescription className="whitespace-pre-line text-sm leading-relaxed">
                            {pending.description}
                        </DialogDescription>
                    )}
                </DialogHeader>

                {pending?.details && pending.details.length > 0 && (
                    <ul className="max-h-48 list-disc space-y-1 overflow-y-auto rounded-2xl bg-muted/60 py-3 pr-4 pl-8 text-sm text-foreground">
                        {pending.details.map((line, i) => (
                            <li key={i}>{line}</li>
                        ))}
                    </ul>
                )}

                <DialogFooter>
                    <Button variant="outline" onClick={() => settle(false)}>
                        {pending?.cancelLabel ?? "Cancelar"}
                    </Button>
                    <Button variant={destructive ? "destructive" : "default"} onClick={() => settle(true)}>
                        {pending?.confirmLabel ?? "Confirmar"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
