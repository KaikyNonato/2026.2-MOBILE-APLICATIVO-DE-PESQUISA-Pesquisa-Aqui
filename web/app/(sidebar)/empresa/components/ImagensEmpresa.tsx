'use client';

import { ChangeEvent, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Camera, ImageIcon, ImagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { imageSrc, UserAvatar } from "@/components/ui/user-avatar";
import {
    COMPANY_IMAGE_MAX_BYTES,
    COMPANY_IMAGE_TYPES,
    removeCompanyImage,
    uploadCompanyImage,
    type CompanyImageKind,
    type CompanyItem,
} from "@/lib/company";

export interface CompanyImages {
    id: number;
    legalName: string;
    logoUrl?: string | null;
    coverUrl?: string | null;
}

/**
 * Capa da empresa como uma faixa no topo do cartão escuro da página (a imagem aparece inteira, sem texto por cima).
 * Termina em um degradê para a cor do cartão, que emenda com a parte de baixo. Some se a imagem não carregar.
 */
export function CoverBanner({ url }: { url?: string | null }) {
    const [failed, setFailed] = useState<string | null>(null);

    if (!url || failed === url) return null;

    return (
        <div className="relative h-36 w-full overflow-hidden sm:h-48 lg:h-56">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
                src={imageSrc(url, { width: 1600, height: 480 })}
                alt="Capa da empresa"
                onError={() => setFailed(url)}
                className="absolute inset-0 size-full object-cover object-center"
            />
            <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[var(--forest)] to-transparent"
            />
        </div>
    );
}

/** Espaço de uma imagem da empresa (logo ou capa): mostra, troca e remove a imagem. */
function ImageSlot({
    company,
    kind,
    onChanged,
}: {
    company: CompanyImages;
    kind: CompanyImageKind;
    onChanged: (updated: CompanyItem) => void;
}) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [busy, setBusy] = useState<'upload' | 'remove' | null>(null);
    const [coverFailed, setCoverFailed] = useState<string | null>(null);
    const isLogo = kind === 'logo';
    const url = isLogo ? company.logoUrl : company.coverUrl;
    const noun = isLogo ? 'logo' : 'capa';

    const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = ''; // permite escolher o mesmo arquivo de novo depois
        if (!file) return;

        if (!COMPANY_IMAGE_TYPES.includes(file.type)) {
            toast.error('Use uma imagem JPG, PNG ou WebP');
            return;
        }
        if (file.size > COMPANY_IMAGE_MAX_BYTES) {
            toast.error('A imagem deve ter no máximo 5 MB');
            return;
        }

        setBusy('upload');
        try {
            onChanged(await uploadCompanyImage(company.id, kind, file));
            toast.success(isLogo ? 'Logo atualizado!' : 'Capa atualizada!');
        } catch (error) {
            console.error(error);
            toast.error(error instanceof Error ? error.message : 'Erro ao enviar a imagem');
        } finally {
            setBusy(null);
        }
    };

    const handleRemove = async () => {
        setBusy('remove');
        try {
            onChanged(await removeCompanyImage(company.id, kind));
            toast.success(isLogo ? 'Logo removido' : 'Capa removida');
        } catch (error) {
            console.error(error);
            toast.error(error instanceof Error ? error.message : 'Erro ao remover a imagem');
        } finally {
            setBusy(null);
        }
    };

    return (
        <div className="flex flex-col gap-3 rounded-2xl bg-muted/50 p-4">
            <div className="flex flex-wrap items-center gap-4">
                {isLogo ? (
                    <UserAvatar
                        name={company.legalName}
                        src={url}
                        size={80}
                        fit="contain"
                        ariaHidden
                        className={`grid size-20 shrink-0 place-items-center rounded-2xl border border-border text-2xl font-semibold ${url ? 'bg-white p-1.5' : 'bg-[var(--mint)] text-[var(--forest)]'
                            }`}
                    />
                ) : null}

                <div className="min-w-0 grow basis-48">
                    <p className="text-sm font-semibold capitalize">{noun}</p>
                    <p className="text-xs text-muted-foreground">
                        {isLogo
                            ? 'Quadrado ou com fundo transparente funciona melhor. Aparece no painel e no aplicativo.'
                            : 'Imagem larga (proporção 10:3). Aparece no topo da página da empresa.'}{' '}
                        JPG, PNG ou WebP, até 5 MB.
                    </p>
                </div>

                <div className="flex flex-wrap gap-2">
                    <input
                        ref={inputRef}
                        type="file"
                        accept={COMPANY_IMAGE_TYPES.join(',')}
                        className="hidden"
                        onChange={handleFile}
                        aria-label={`Escolher ${noun} da empresa`}
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
                                {url ? `Trocar ${noun}` : `Escolher ${noun}`}
                            </>
                        )}
                    </Button>
                    {url && (
                        <Button type="button" variant="outline" size="sm" disabled={busy !== null} onClick={handleRemove}>
                            {busy === 'remove' ? 'Removendo...' : 'Remover'}
                        </Button>
                    )}
                </div>
            </div>

            {!isLogo && (
                <div className="grid h-28 place-items-center overflow-hidden rounded-xl border border-dashed border-input bg-white/60 sm:h-32">
                    {url && coverFailed !== url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                            src={imageSrc(url, { width: 1200, height: 360 })}
                            alt="Capa da empresa"
                            onError={() => setCoverFailed(url)}
                            className="size-full object-cover"
                        />
                    ) : (
                        <span className="flex items-center gap-2 text-sm text-muted-foreground">
                            <ImageIcon className="size-4" />
                            Sem capa
                        </span>
                    )}
                </div>
            )}
        </div>
    );
}

/** Logo e capa da empresa: escolher, trocar ou remover. As imagens ficam no Cloudinary; o servidor também confere tipo e tamanho. */
function ImagensEmpresa({
    company,
    onChanged,
}: {
    company: CompanyImages;
    onChanged: (updated: CompanyItem) => void;
}) {
    return (
        <div className="flex flex-col gap-4">
            <ImageSlot company={company} kind="logo" onChanged={onChanged} />
            <ImageSlot company={company} kind="cover" onChanged={onChanged} />
        </div>
    );
}

/**
 * Botão "Editar imagens" (para o cartão escuro do topo da página) que abre a janela com o logo e a capa.
 * A janela fica aberta depois de enviar ou remover, para dar para ajustar as duas imagens de uma vez.
 */
export default function EditarImagensEmpresa({
    company,
    onChanged,
    className = '',
}: {
    company: CompanyImages;
    onChanged: (updated: CompanyItem) => void;
    /** Posição do botão (ex.: absoluto no canto do cartão). */
    className?: string;
}) {
    const [open, setOpen] = useState(false);

    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                className={`z-10 inline-flex h-10 items-center gap-2 rounded-full bg-[var(--mint)] px-5 text-sm font-semibold text-[var(--forest)] shadow-[0_10px_24px_-10px_rgba(0,0,0,0.7)] transition-all hover:-translate-y-0.5 hover:bg-white ${className}`}
            >
                <ImagePlus className="size-4" />
                Editar imagens
            </button>

            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
                    <DialogHeader>
                        <DialogTitle className="text-xl tracking-tight">Imagens da empresa</DialogTitle>
                        <DialogDescription>
                            O logo e a capa da sua empresa, mostrados no painel e no aplicativo.
                        </DialogDescription>
                    </DialogHeader>
                    <ImagensEmpresa company={company} onChanged={onChanged} />
                </DialogContent>
            </Dialog>
        </>
    );
}
