'use client';

import { useState } from "react";

/** Iniciais (até duas letras) de um nome. */
const initialsOf = (name: string) =>
    name
        .split(" ")
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase())
        .join("") || "?";

// A API devolve as imagens como caminhos dela (`/media/avatars/7?v=123`): o painel as pede pelo próprio domínio
// (o Next repassa /api/* para a API) e quem entrega é a API, então o endereço do Cloudinary nunca aparece.
const MEDIA_BASE = "/api";

/**
 * Endereço da imagem já no tamanho pedido. `width` e `height` em pixels. O recorte (rosto, logo inteiro, capa) é
 * decidido pela API conforme o tipo da imagem. Endereços que não são `/media/...` voltam como estão.
 */
export function imageSrc(url: string, { width, height }: { width: number; height?: number }): string {
    if (!url.startsWith("/media/")) return url;

    const separator = url.includes("?") ? "&" : "?";
    const size = `w=${Math.round(width)}${height ? `&h=${Math.round(height)}` : ""}`;

    return `${MEDIA_BASE}${url}${separator}${size}`;
}

/** Foto de perfil no tamanho pedido (`size` em pixels de tela; pede o dobro para telas nítidas). */
export function avatarSrc(url: string, size: number): string {
    return imageSrc(url, { width: size * 2 });
}

/**
 * Foto do usuário (ou logo da empresa), ou as iniciais quando não há imagem (ou ela não carrega).
 * O formato e o tamanho vêm de `className`, então serve para o menu, o perfil e as listas.
 */
export function UserAvatar({
    name,
    src,
    size = 38,
    className = "",
    title,
    ariaHidden = false,
    fit = "cover",
    inline = false,
}: {
    name: string;
    src?: string | null;
    /** Lado da imagem, em px, usado para pedir ao Cloudinary a imagem no tamanho certo. */
    size?: number;
    className?: string;
    title?: string;
    /** Avatar decorativo (o nome já aparece ao lado): some para leitores de tela. */
    ariaHidden?: boolean;
    /** `cover` preenche e recorta (fotos de pessoas); `contain` mostra a imagem inteira (logos). */
    fit?: "cover" | "contain";
    /** Renderiza um `span` (para ficar dentro de um parágrafo ou de um texto corrido). */
    inline?: boolean;
}) {
    // Guarda qual endereço falhou: ao trocar a imagem o novo endereço volta a ser tentado.
    const [failed, setFailed] = useState<string | null>(null);
    const showImage = !!src && failed !== src;
    const resized = src ? avatarSrc(src, size) : "";
    const Tag = inline ? "span" : "div";

    return (
        <Tag className={`${className} overflow-hidden`} title={title} aria-hidden={ariaHidden || undefined}>
            {showImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                    src={resized}
                    alt=""
                    width={size}
                    height={size}
                    loading="lazy"
                    decoding="async"
                    onError={() => setFailed(src)}
                    className={`size-full ${fit === "contain" ? "object-contain" : "object-cover"}`}
                />
            ) : (
                initialsOf(name)
            )}
        </Tag>
    );
}
