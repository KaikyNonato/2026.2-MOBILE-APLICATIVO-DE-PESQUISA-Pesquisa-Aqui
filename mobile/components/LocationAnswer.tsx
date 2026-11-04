import * as Haptics from 'expo-haptics';
import { AlertTriangle, CheckCircle2, MapPin, Settings } from 'lucide-react-native';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { AnswerValue, PackageQuestion } from '@/lib/displayRules';
import { captureLocationAnswer } from '@/lib/locationCapture';
import { LOW_ACCURACY_THRESHOLD_METERS, parseLocationAnswer, serializeLocationAnswer } from '@/lib/questionTypes';

interface LocationAnswerProps {
    question: PackageQuestion;
    value: AnswerValue;
    onChange: (value: AnswerValue) => void;
    error: string | null;
}

type LocationProblem =
    | { kind: 'denied'; canAskAgain: boolean }
    | { kind: 'services-off' }
    | { kind: 'unavailable' };

/** Formata uma coordenada com 6 casas decimais. */
const formatCoordinate = (n: number) => n.toFixed(6);

/** Formata a hora da captura (`null` se for inválida). */
function formatTime(iso: string | null): string | null {
    if (!iso) return null;
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? null : date.toLocaleTimeString('pt-BR');
}

/**
 * Questão de localização. Lê o GPS do aparelho (sem internet), guarda latitude, longitude e a precisão
 * informada pelo aparelho e mostra tudo na tela para o pesquisador conferir antes de avançar.
 * Precisão ruim avisa e deixa tentar de novo, mas não bloqueia: o ponto é gravado como "de baixa precisão".
 */
export default function LocationAnswer({ question, value, onChange, error }: LocationAnswerProps) {
    const location = parseLocationAnswer(value);

    const [capturing, setCapturing] = useState(false);
    const [problem, setProblem] = useState<LocationProblem | null>(null);

    // Sempre o onChange mais novo, mesmo que a tela tenha re-renderizado enquanto o GPS procurava sinal
    const latestOnChange = useRef(onChange);
    useEffect(() => {
        latestOnChange.current = onChange;
    });

    // Se o pesquisador saiu da questão enquanto o GPS procurava sinal, o resultado não pode cair noutra questão
    const mounted = useRef(true);
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);

    const capture = async () => {
        if (capturing) return;
        setProblem(null);
        setCapturing(true);
        try {
            const result = await captureLocationAnswer();
            if (!mounted.current) return;

            if (result.status === 'ok') {
                latestOnChange.current(serializeLocationAnswer(result.location));
                if (result.location.lowAccuracy) {
                    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
                }
            } else if (result.status === 'denied') {
                setProblem({ kind: 'denied', canAskAgain: result.canAskAgain });
            } else if (result.status === 'services-off') {
                setProblem({ kind: 'services-off' });
            } else {
                setProblem({ kind: 'unavailable' });
            }
        } finally {
            if (mounted.current) setCapturing(false);
        }
    };

    const openSettings = () => {
        Linking.openSettings().catch(() => undefined);
    };

    // Uma tentativa que falha não apaga o ponto já capturado: ele continua valendo.
    const requiredHint = question.isRequired
        ? ' Esta questão é obrigatória: só dá para avançar depois de capturar a localização.'
        : ' Como esta questão não é obrigatória, você pode avançar sem a localização.';

    const buttonLabel = location ? 'Capturar novamente' : 'Capturar localização atual';
    const capturedTime = location ? formatTime(location.capturedAt) : null;

    return (
        <View style={styles.column}>
            <TouchableOpacity
                style={styles.captureButton}
                onPress={capture}
                disabled={capturing}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={buttonLabel}
            >
                {capturing ? <ActivityIndicator size="small" color="#447762" /> : <MapPin size={20} color="#447762" />}
                <Text style={styles.captureButtonText}>{capturing ? 'Buscando sinal do GPS…' : buttonLabel}</Text>
            </TouchableOpacity>

            {capturing ? (
                <Text style={styles.hint}>
                    Pode levar alguns segundos. Fique em um lugar aberto. A leitura é feita pelo GPS do aparelho e não
                    precisa de internet.
                </Text>
            ) : null}

            {location ? (
                <View
                    style={[styles.result, location.lowAccuracy ? styles.resultLow : styles.resultGood]}
                    accessibilityLabel={`Localização capturada. Latitude ${formatCoordinate(location.latitude)}, longitude ${formatCoordinate(location.longitude)}.`}
                >
                    <View style={styles.resultHeader}>
                        {location.lowAccuracy ? (
                            <AlertTriangle size={18} color="#92400e" />
                        ) : (
                            <CheckCircle2 size={18} color="#447762" />
                        )}
                        <Text style={[styles.resultTitle, location.lowAccuracy && styles.resultTitleLow]}>
                            {location.lowAccuracy ? 'Localização de baixa precisão' : 'Localização capturada'}
                        </Text>
                    </View>

                    <View style={styles.line}>
                        <Text style={styles.lineLabel}>Latitude</Text>
                        <Text style={styles.lineValue}>{formatCoordinate(location.latitude)}</Text>
                    </View>
                    <View style={styles.line}>
                        <Text style={styles.lineLabel}>Longitude</Text>
                        <Text style={styles.lineValue}>{formatCoordinate(location.longitude)}</Text>
                    </View>
                    <View style={styles.line}>
                        <Text style={styles.lineLabel}>Precisão</Text>
                        <Text style={styles.lineValue}>
                            {location.accuracy !== null ? `± ${Math.round(location.accuracy)} m` : 'não informada'}
                        </Text>
                    </View>
                    {capturedTime ? (
                        <View style={styles.line}>
                            <Text style={styles.lineLabel}>Capturada às</Text>
                            <Text style={styles.lineValue}>{capturedTime}</Text>
                        </View>
                    ) : null}

                    {location.lowAccuracy ? (
                        <Text style={styles.warningText}>
                            {location.accuracy !== null
                                ? `O aparelho informa que este ponto pode estar a até ${Math.round(location.accuracy)} m de onde você está (o ideal é até ${LOW_ACCURACY_THRESHOLD_METERS} m).`
                                : 'O aparelho não informou a precisão deste ponto.'}{' '}
                            Você pode tocar em "Capturar novamente" (ao ar livre, longe de prédios, costuma melhorar) ou
                            seguir com este ponto: ele será gravado como de baixa precisão.
                        </Text>
                    ) : null}
                </View>
            ) : null}

            {problem?.kind === 'denied' ? (
                <View style={styles.notice}>
                    <Text style={styles.noticeText}>
                        {problem.canAskAgain
                            ? 'Sem a permissão de localização não dá para registrar onde o dado foi coletado. Toque em "Capturar localização atual" e permita o acesso quando o aparelho perguntar.'
                            : 'A permissão de localização está desligada para este aplicativo. Abra as configurações, libere a localização, volte ao app e toque em "Capturar localização atual".'}
                        {requiredHint}
                    </Text>
                    {!problem.canAskAgain ? (
                        <TouchableOpacity style={styles.settingsButton} onPress={openSettings} accessibilityRole="button">
                            <Settings size={16} color="#92400e" />
                            <Text style={styles.settingsButtonText}>Abrir configurações</Text>
                        </TouchableOpacity>
                    ) : null}
                </View>
            ) : null}

            {problem?.kind === 'services-off' ? (
                <View style={styles.notice}>
                    <Text style={styles.noticeText}>
                        O GPS (localização) do aparelho está desligado.{' '}
                        {Platform.OS === 'ios'
                            ? 'Abra Ajustes > Privacidade e Segurança > Serviços de Localização e ligue a opção.'
                            : 'Deslize a barra superior da tela e toque em "Localização" (ou "GPS") para ligar.'}{' '}
                        Depois volte ao app e toque em "Capturar localização atual". Não precisa de internet.
                        {requiredHint}
                    </Text>
                </View>
            ) : null}

            {problem?.kind === 'unavailable' ? (
                <View style={styles.notice}>
                    <Text style={styles.noticeText}>
                        Não foi possível obter o sinal do GPS. Vá para um lugar aberto, longe de paredes e coberturas, e
                        toque em "Capturar localização atual" de novo.
                        {requiredHint}
                    </Text>
                </View>
            ) : null}

            {error ? <Text style={styles.errorText}>{error}</Text> : null}
        </View>
    );
}

const styles = StyleSheet.create({
    column: { gap: 8 },
    hint: { fontSize: 13, color: '#71717a', lineHeight: 18 },
    errorText: { fontSize: 14, color: '#b91c1c' },
    captureButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        minHeight: 56,
        borderWidth: 1,
        borderColor: '#d4d4d8',
        borderRadius: 8,
        backgroundColor: '#fff',
        paddingHorizontal: 16,
    },
    captureButtonText: { fontSize: 16, color: '#18181b' },
    result: { borderRadius: 8, borderWidth: 1, padding: 14, gap: 6 },
    resultGood: { backgroundColor: '#e8f1ed', borderColor: '#447762' },
    resultLow: { backgroundColor: '#fef3c7', borderColor: '#92400e' },
    resultHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
    resultTitle: { fontSize: 15, fontWeight: '700', color: '#447762' },
    resultTitleLow: { color: '#92400e' },
    line: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
    lineLabel: { fontSize: 14, color: '#52525b' },
    lineValue: { fontSize: 14, fontWeight: '600', color: '#18181b' },
    warningText: { marginTop: 6, fontSize: 14, lineHeight: 20, color: '#92400e' },
    notice: { backgroundColor: '#fef3c7', borderRadius: 8, padding: 14, gap: 10 },
    noticeText: { color: '#92400e', fontSize: 14, lineHeight: 20 },
    settingsButton: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
    settingsButtonText: { color: '#92400e', fontSize: 14, fontWeight: '600', textDecorationLine: 'underline' },
});
