import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { useState } from "react";
import {
    Button
} from "@/components/ui/button";

type DialogLayoutProps = {
    triggerButtonVariant?: "link" | "default" | "outline" | "secondary" | "ghost" | "destructive";
    dialogTrigger?: React.ReactNode;
    /** Conteúdo do diálogo. Pode ser uma função que recebe `close` para fechar o diálogo (ex.: depois de salvar). */
    dialogContent?: React.ReactNode | ((close: () => void) => React.ReactNode);
    dialogTitle?: React.ReactNode;
    dialogDescription?: React.ReactNode;
    dialogContentClassName?: React.ReactNode;
    triggerButtonSize?: "default" | "sm" | "lg" | "xs";
};

/** Caixa de diálogo pronta: botão que abre, título, descrição e conteúdo. */
export default function DialogLayout({ triggerButtonVariant, dialogTrigger, dialogTitle, dialogDescription, dialogContent, dialogContentClassName, triggerButtonSize }: DialogLayoutProps) {
    const [open, setOpen] = useState(false);

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger render={<Button variant={triggerButtonVariant} size={triggerButtonSize} />}>
                {dialogTrigger}
            </DialogTrigger>

            <DialogContent className="w-[95vw] max-w-4xl md:min-w-[50vw] max-h-[90vh] p-6 flex flex-col overflow-hidden">

                <DialogHeader className="shrink-0">
                    <DialogTitle className="text-2xl tracking-tight">{dialogTitle}</DialogTitle>
                    <DialogDescription>
                        {dialogDescription}
                    </DialogDescription>
                </DialogHeader>

                <div className={`${dialogContentClassName} max-h-200 flex-1 overflow-y-auto pr-2 custom-scrollbar`}>
                    {typeof dialogContent === "function" ? dialogContent(() => setOpen(false)) : dialogContent}
                </div>
            </DialogContent>
        </Dialog>
    );
}
