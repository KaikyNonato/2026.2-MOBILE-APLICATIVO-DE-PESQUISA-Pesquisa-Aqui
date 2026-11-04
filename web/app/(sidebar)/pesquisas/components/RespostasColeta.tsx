'use client';

import { UserAvatar } from "@/components/ui/user-avatar";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LoadingState } from "@/components/ui/loadingState";
import {
    formatAnswer,
    getCollection,
    getCollectionMedia,
    type CollectionDetail,
    type CollectionMediaFile,
    type CollectionQuestion,
    type CollectionSummary,
    type FormattedAnswer,
} from "@/lib/collection";
import { useEffect, useState } from "react";

/** Formata data e hora curtas em pt-BR (`-` se vazia). */
const formatDateTime = (value: string | null) =>
    value ? new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '-';

/** Endereço do OpenStreetMap com o ponto da coleta marcado. */
const mapUrl = (latitude: number, longitude: number) =>
    `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=17/${latitude}/${longitude}`;

// Códigos de erro do elemento <audio> (MediaError.code)
const AUDIO_ERRORS: Record<number, string> = {
    1: 'O carregamento do áudio foi interrompido.',
    2: 'Falha de rede ao carregar o áudio.',
    3: 'O navegador não conseguiu decodificar o áudio: o arquivo pode estar incompleto ou corrompido.',
    4: 'O navegador não reconhece o formato deste áudio (gravado antes da atualização do aplicativo?).',
};

/** Mostra uma resposta de acordo com o tipo (vazio, texto, escolhas, localização, foto, áudio...). */
function AnswerView({ answer }: { answer: FormattedAnswer }) {
    switch (answer.kind) {
        case 'empty':
            return <p className="text-sm italic text-muted-foreground">Sem resposta</p>;

        case 'text':
            return <p className="whitespace-pre-wrap break-words text-sm">{answer.text}</p>;

        case 'list':
            return (
                <ul className="list-disc pl-5 text-sm">
                    {answer.items.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}
                </ul>
            );

        case 'scale':
            return (
                <div className="flex flex-col gap-0.5 text-sm">
                    <p>{answer.value} de 5</p>
                    {(answer.leftLabel || answer.rightLabel) && (
                        <p className="text-xs text-muted-foreground">
                            1 = {answer.leftLabel ?? '-'} · 5 = {answer.rightLabel ?? '-'}
                        </p>
                    )}
                </div>
            );

        case 'location':
            return (
                <div className="flex flex-col gap-1 text-sm">
                    <p>
                        {answer.latitude.toFixed(6)}, {answer.longitude.toFixed(6)}
                        {answer.accuracy !== null && (
                            <span className="text-muted-foreground"> · precisão de ±{Math.round(answer.accuracy)} m</span>
                        )}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                        <a
                            href={mapUrl(answer.latitude, answer.longitude)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs underline"
                        >
                            Abrir no mapa
                        </a>
                        {answer.lowAccuracy && <Badge variant="outline">Baixa precisão</Badge>}
                    </div>
                </div>
            );

        case 'file':
            return (
                <div className="flex flex-col gap-0.5 text-sm">
                    {answer.names.map((name) => <p key={name} className="break-all">{name}</p>)}
                    <p className="text-xs text-muted-foreground">
                        Arquivo não recebido pelo servidor: a coleta foi enviada antes de o aplicativo passar a enviar fotos e áudios, ou o arquivo já não estava no aparelho.
                    </p>
                </div>
            );
    }
}

type MediaState =
    | { status: 'loading' }
    | { status: 'error'; message: string }
    | { status: 'ready'; url: string };

/**
 * Baixa o arquivo pela API autenticada e mostra como imagem ou player. O endereço temporário é
 * liberado ao sair.
 */
function MediaItem({ collectionId, file }: { collectionId: number; file: CollectionMediaFile }) {
    const [state, setState] = useState<MediaState>({ status: 'loading' });
    const [playError, setPlayError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        let objectUrl: string | null = null;

        getCollectionMedia(collectionId, file.name)
            .then((blob) => {
                // Sem tipo no cabeçalho o navegador não toca nem desenha: usa o que a API informou.
                const typed = blob.type ? blob : new Blob([blob], { type: file.mimeType });
                objectUrl = URL.createObjectURL(typed);
                if (cancelled) URL.revokeObjectURL(objectUrl);
                else setState({ status: 'ready', url: objectUrl });
            })
            .catch((err) => {
                if (!cancelled) {
                    setState({ status: 'error', message: err instanceof Error ? err.message : 'Erro ao carregar o arquivo' });
                }
            });

        return () => {
            cancelled = true;
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [collectionId, file.name, file.mimeType]);

    if (state.status === 'loading') {
        return <LoadingState label="Carregando arquivo..." shape="inline" />;
    }

    if (state.status === 'error') {
        return <p className="text-xs text-destructive">{state.message}</p>;
    }

    if (file.mimeType.startsWith('image/')) {
        return (
            <a href={state.url} target="_blank" rel="noopener noreferrer" title="Abrir em tamanho original">
                {/* Endereço temporário (blob:) de um arquivo autenticado: o next/image não otimiza esse caso. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                    src={state.url}
                    alt="Foto da resposta"
                    className="max-h-64 max-w-full rounded-md border object-contain"
                />
            </a>
        );
    }

    // Largura própria: dentro do contêiner flex-wrap o player encolheria ao mínimo e esconderia os controles.
    return (
        <div className="flex w-full max-w-md flex-col gap-1">
            <audio
                controls
                preload="metadata"
                src={state.url}
                className="w-full min-w-64"
                onError={(event) => {
                    const code = event.currentTarget.error?.code;
                    setPlayError((code && AUDIO_ERRORS[code]) || 'Não foi possível reproduzir o áudio.');
                }}
            />
            {playError && <p className="text-xs text-destructive">{playError}</p>}
            <a href={state.url} download={file.name} className="text-xs underline">Baixar áudio</a>
        </div>
    );
}

/** Uma questão com a resposta dela e a situação dos arquivos esperados. */
function QuestionItem({ number, question, collectionId }: { number: number; question: CollectionQuestion; collectionId: number }) {
    const answer = formatAnswer(question);
    const expected = question.expectedFiles ?? [];
    const missing = expected.filter((file) => !file.received).length;
    const showFiles = answer.kind === 'file' && question.files.length > 0;

    return (
        <li className="flex flex-col gap-1 rounded-lg border bg-card p-3">
            <p className="text-sm font-medium">
                {number}. {question.statement}
                {question.isRequired && <span className="text-destructive" title="Obrigatória"> *</span>}
            </p>
            {showFiles ? (
                <div className="flex flex-wrap gap-3">
                    {question.files.map((file) => <MediaItem key={file.name} collectionId={collectionId} file={file} />)}
                </div>
            ) : (
                <AnswerView answer={answer} />
            )}
            {missing > 0 && (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                    {missing === 1
                        ? '1 arquivo desta resposta ainda não chegou (o aplicativo envia sozinho quando tiver rede).'
                        : `${missing} arquivos desta resposta ainda não chegaram (o aplicativo envia sozinho quando tiver rede).`}
                </p>
            )}
        </li>
    );
}

type DetailState =
    | { status: 'loading' }
    | { status: 'error'; message: string }
    | { status: 'ready'; detail: CollectionDetail };

/** Carrega e mostra as respostas de uma coleta (carregando, erro ou lista de questões). */
function RespostasConteudo({ collectionId }: { collectionId: number }) {
    const [state, setState] = useState<DetailState>({ status: 'loading' });

    useEffect(() => {
        let cancelled = false;

        getCollection(collectionId)
            .then((detail) => { if (!cancelled) setState({ status: 'ready', detail }); })
            .catch((err) => {
                if (!cancelled) {
                    setState({ status: 'error', message: err instanceof Error ? err.message : 'Erro ao carregar as respostas' });
                }
            });

        return () => { cancelled = true; };
    }, [collectionId]);

    if (state.status === 'loading') {
        return <LoadingState label="Carregando respostas..." shape="answers" />;
    }

    if (state.status === 'error') {
        return (
            <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">
                <p className="font-medium">Erro ao carregar as respostas</p>
                <p>{state.message}</p>
            </div>
        );
    }

    const { sections, filesSummary } = state.detail;
    const questions = sections.flatMap((section) => section.questions);
    const answered = questions.filter((question) => formatAnswer(question).kind !== 'empty').length;

    if (questions.length === 0) {
        return <p className="p-4 text-center text-sm text-muted-foreground">Esta pesquisa não tem perguntas.</p>;
    }

    // Numeração corrida do questionário, sem mutar variável durante a renderização.
    const numbered = sections
        .filter((section) => section.questions.length > 0)
        .map((section, index, visible) => ({
            section,
            firstNumber: 1 + visible.slice(0, index).reduce((total, previous) => total + previous.questions.length, 0),
        }));

    return (
        <div className="flex flex-col gap-5">
            <p className="text-sm text-muted-foreground">{answered} de {questions.length} pergunta(s) respondida(s)</p>
            {filesSummary && filesSummary.expected > 0 && (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Badge variant={filesSummary.complete ? 'default' : 'secondary'}>
                        {filesSummary.complete
                            ? 'Todos os arquivos chegaram'
                            : `${filesSummary.missing} arquivo(s) ainda não chegaram`}
                    </Badge>
                    <span className="text-muted-foreground">
                        {filesSummary.received} de {filesSummary.expected} arquivo(s) recebido(s)
                        {filesSummary.interviewAudio.expected && !filesSummary.interviewAudio.received
                            ? ' · falta o áudio da entrevista'
                            : ''}
                    </span>
                </div>
            )}
            {numbered.map(({ section, firstNumber }) => (
                <section key={section.id} className="flex flex-col gap-2">
                    <h3 className="text-base font-semibold">{section.title}</h3>
                    <ul className="flex flex-col gap-2">
                        {section.questions.map((question, index) => (
                            <QuestionItem key={question.id} number={firstNumber + index} question={question} collectionId={state.detail.id} />
                        ))}
                    </ul>
                </section>
            ))}
        </div>
    );
}

interface RespostasColetaProps {
    collection: CollectionSummary | null;
    onClose: () => void;
}

/** Caixa que mostra as respostas de uma coleta. */
export default function RespostasColeta({ collection, onClose }: RespostasColetaProps) {
    return (
        <Dialog open={collection !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
            <DialogContent className="flex max-h-[90vh] w-[95vw] flex-col overflow-hidden p-5 sm:max-w-3xl">
                <DialogHeader className="shrink-0">
                    <DialogTitle className="text-2xl">Respostas da coleta #{collection?.id}</DialogTitle>
                    <DialogDescription>
                        {collection?.researcherName && (
                            <UserAvatar
                                inline
                                ariaHidden
                                name={collection.researcherName}
                                src={collection.researcherAvatarUrl}
                                size={20}
                                className="mr-1.5 inline-grid size-5 place-items-center rounded-full bg-[var(--mint)] align-middle text-[9px] font-semibold text-[var(--forest)]"
                            />
                        )}
                        {collection?.researcherName ?? '-'} · início em {formatDateTime(collection?.startedAt ?? null)} · fim em{' '}
                        {formatDateTime(collection?.finishedAt ?? null)}
                    </DialogDescription>
                </DialogHeader>

                <div className="custom-scrollbar flex-1 overflow-y-auto pr-2">
                    {collection && <RespostasConteudo key={collection.id} collectionId={collection.id} />}
                </div>
            </DialogContent>
        </Dialog>
    );
}
