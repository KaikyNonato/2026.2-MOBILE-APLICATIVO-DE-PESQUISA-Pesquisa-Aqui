import * as Haptics from 'expo-haptics';
import { Calendar, Check, Clock } from 'lucide-react-native';
import React, { useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import AudioAnswer, { type AudioBridge } from '@/components/AudioAnswer';
import DateTimePickerModal from '@/components/DateTimePickerModal';
import LocationAnswer from '@/components/LocationAnswer';
import PhotoAnswer from '@/components/PhotoAnswer';
import type { AnswerValue, PackageQuestion } from '@/lib/displayRules';
import {
    describeSelectionRange,
    getQuestionLimits,
    isQuestionTypeSupported,
    validateAnswer,
    type SupportedQuestionType,
} from '@/lib/questionTypes';

interface QuestionInputProps {
    question: PackageQuestion;
    value: AnswerValue;
    onChange: (value: AnswerValue) => void;
    /** UUID da coleta em andamento: as fotos tiradas ficam guardadas ligadas a ela. */
    collectionId: string;
    /** Liga a questão de áudio à gravação da entrevista e trava a navegação enquanto grava. */
    audioBridge?: AudioBridge;
}

interface InputProps extends QuestionInputProps {
    /** Mensagem do que era esperado (ou null). Já vem calculada com os limites do pacote. */
    error: string | null;
    /** Avisa que o pesquisador saiu do campo: só então o erro de digitação passa a aparecer. */
    onBlur: () => void;
}

/** Deixa passar só número: dígitos, um separador decimal e (se o mínimo permitir) o sinal de menos. */
function sanitizeNumeric(text: string, allowNegative: boolean): string {
    let out = text.replace(/[^0-9.,-]/g, '');
    const negative = allowNegative && out.startsWith('-');
    out = out.replace(/-/g, '');
    const firstSeparator = out.search(/[.,]/);
    if (firstSeparator !== -1) {
        out = out.slice(0, firstSeparator + 1) + out.slice(firstSeparator + 1).replace(/[.,]/g, '');
    }
    return (negative ? '-' : '') + out;
}

/** Valor da resposta como texto (vazio se não for texto). */
const asText = (value: AnswerValue) => (typeof value === 'string' ? value : '');

// ---------- Um desenhista por tipo ----------

/** Campo de texto. */
function TextAnswer({ question, value, onChange, error, onBlur }: InputProps) {
    const { maxLength } = getQuestionLimits(question);
    const text = asText(value);
    const atLimit = maxLength !== undefined && text.length >= maxLength;

    return (
        <View style={styles.column}>
            <TextInput
                style={[styles.input, styles.multiline, error ? styles.inputError : null]}
                value={text}
                onChangeText={onChange}
                onBlur={onBlur}
                placeholder="Digite a resposta"
                placeholderTextColor="#a1a1aa"
                maxLength={maxLength}
                multiline
                textAlignVertical="top"
            />
            {maxLength !== undefined ? (
                <Text style={[styles.counter, atLimit && styles.counterLimit]}>
                    {text.length}/{maxLength} caracteres{atLimit ? ' — limite atingido' : ''}
                </Text>
            ) : null}
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
        </View>
    );
}

/** Campo numérico, respeitando o mínimo e o máximo. */
function NumericAnswer({ question, value, onChange, error, onBlur }: InputProps) {
    const { minValue, maxValue } = getQuestionLimits(question);
    const allowNegative = minValue === undefined || minValue < 0;

    const hint =
        minValue !== undefined && maxValue !== undefined
            ? `Entre ${minValue} e ${maxValue}`
            : minValue !== undefined
                ? `Mínimo ${minValue}`
                : maxValue !== undefined
                    ? `Máximo ${maxValue}`
                    : null;

    return (
        <View style={styles.column}>
            <TextInput
                style={[styles.input, error ? styles.inputError : null]}
                value={asText(value)}
                onChangeText={(t) => onChange(sanitizeNumeric(t, allowNegative))}
                onBlur={onBlur}
                placeholder="0"
                placeholderTextColor="#a1a1aa"
                keyboardType={allowNegative ? 'numbers-and-punctuation' : 'decimal-pad'}
            />
            {hint ? <Text style={styles.hint}>{hint}</Text> : null}
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
        </View>
    );
}

/** Campo de data ou hora, que abre o seletor. */
function PickerAnswer({
    mode,
    question,
    value,
    onChange,
    error,
}: InputProps & { mode: 'date' | 'time' }) {
    const [open, setOpen] = useState(false);
    const { minDate, maxDate } = getQuestionLimits(question);
    const text = asText(value);
    const Icon = mode === 'date' ? Calendar : Clock;

    return (
        <View style={styles.column}>
            <TouchableOpacity
                style={[styles.input, styles.pickerField, error ? styles.inputError : null]}
                onPress={() => setOpen(true)}
            >
                <Icon size={18} color="#447762" />
                <Text style={[styles.pickerText, !text && styles.pickerPlaceholder]}>
                    {text || (mode === 'date' ? 'Selecionar data' : 'Selecionar horário')}
                </Text>
            </TouchableOpacity>
            {error ? <Text style={styles.errorText}>{error}</Text> : null}

            <DateTimePickerModal
                visible={open}
                mode={mode}
                title={mode === 'date' ? 'Selecione a data' : 'Selecione o horário'}
                value={text}
                minDate={minDate}
                maxDate={maxDate}
                onConfirm={(picked) => {
                    onChange(picked);
                    setOpen(false);
                }}
                onClear={() => {
                    onChange('');
                    setOpen(false);
                }}
                onCancel={() => setOpen(false)}
            />
        </View>
    );
}

/** Opções na ordem definida no servidor (campo `order`). */
const sortedOptions = (question: PackageQuestion) =>
    [...(question.options ?? [])].sort((a, b) => a.order - b.order);

/** Dois botões grandes, Sim e Não. */
function YesNoAnswer({ value, onChange }: InputProps) {
    // Dois botões grandes, lado a lado, com altura para o polegar: dá para responder com uma mão.
    // É o tipo que mais dispara pulo, então o toque aqui precisa ser fácil e sem erro.
    return (
        <View style={styles.row}>
            {[
                { label: 'Sim', val: true },
                { label: 'Não', val: false },
            ].map((opt) => {
                const selected = value === opt.val;
                return (
                    <TouchableOpacity
                        key={opt.label}
                        style={[styles.choice, styles.yesNoButton, styles.flex, selected && styles.choiceSelected]}
                        onPress={() => onChange(opt.val)}
                        activeOpacity={0.7}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                    >
                        <Text style={[styles.yesNoText, selected && styles.choiceTextSelected]}>{opt.label}</Text>
                    </TouchableOpacity>
                );
            })}
        </View>
    );
}

/** Escolha única: uma alternativa. */
function SingleChoiceAnswer({ question, value, onChange }: InputProps) {
    const options = sortedOptions(question);
    return (
        <View style={styles.column} accessibilityRole="radiogroup">
            {options.map((opt) => {
                const selected = value === opt.id;
                return (
                    <TouchableOpacity
                        key={opt.id}
                        style={[styles.choice, styles.optionRow, selected && styles.choiceSelected]}
                        // Escolher outra opção troca a marcada: só uma fica marcada por vez
                        onPress={() => onChange(opt.id)}
                        activeOpacity={0.7}
                        accessibilityRole="radio"
                        accessibilityState={{ selected }}
                    >
                        <View style={[styles.radio, selected && styles.radioSelected]}>
                            {selected ? <View style={styles.radioDot} /> : null}
                        </View>
                        <Text style={[styles.optionText, selected && styles.choiceTextSelected]}>{opt.text}</Text>
                    </TouchableOpacity>
                );
            })}
        </View>
    );
}

/** Escolha múltipla, com mínimo e máximo de seleções. */
function MultipleChoiceAnswer({ question, value, onChange }: InputProps) {
    const options = sortedOptions(question);
    const { minSelections, maxSelections } = getQuestionLimits(question);
    const selectedIds = Array.isArray(value) ? value : [];
    const atMax = maxSelections !== undefined && selectedIds.length >= maxSelections;
    const range = describeSelectionRange(minSelections, maxSelections);

    const toggle = (id: number) => {
        if (selectedIds.includes(id)) {
            onChange(selectedIds.filter((x) => x !== id));
            return;
        }
        if (atMax) {
            // Não ignora o toque: avisa o pesquisador de que o entrevistado já marcou o máximo
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
            Alert.alert(
                'Limite de opções atingido',
                `Já foram marcadas ${maxSelections} ${maxSelections === 1 ? 'opção' : 'opções'}, que é o máximo permitido. Desmarque uma para escolher outra.`,
            );
            return;
        }
        // Guarda os ids na ordem das opções do servidor, não na ordem dos toques
        const next = [...selectedIds, id];
        onChange(options.map((o) => o.id).filter((optionId) => next.includes(optionId)));
    };

    return (
        <View style={styles.column}>
            {range ? (
                <Text style={[styles.hint, atMax && styles.counterLimit]}>
                    {range} · {selectedIds.length} marcada{selectedIds.length === 1 ? '' : 's'}
                    {atMax ? ' — máximo atingido' : ''}
                </Text>
            ) : null}
            {options.map((opt) => {
                const selected = selectedIds.includes(opt.id);
                return (
                    <TouchableOpacity
                        key={opt.id}
                        style={[
                            styles.choice,
                            styles.optionRow,
                            selected && styles.choiceSelected,
                            atMax && !selected && styles.choiceBlocked,
                        ]}
                        onPress={() => toggle(opt.id)}
                        activeOpacity={0.7}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: selected }}
                    >
                        <View style={[styles.checkbox, selected && styles.checkboxSelected]}>
                            {selected ? <Check size={16} color="#fff" strokeWidth={3} /> : null}
                        </View>
                        <Text style={[styles.optionText, selected && styles.choiceTextSelected]}>{opt.text}</Text>
                    </TouchableOpacity>
                );
            })}
        </View>
    );
}

/** Escala de 1 a 5, com rótulos nas pontas. */
function ScaleAnswer({ question, value, onChange }: InputProps) {
    // Rótulos das pontas (1 e 5) cadastrados na web e entregues no pacote
    const left = question.scaleLeftLabel?.trim();
    const right = question.scaleRightLabel?.trim();
    return (
        <View style={styles.column}>
            <View style={styles.row}>
                {[1, 2, 3, 4, 5].map((n) => (
                    <TouchableOpacity
                        key={n}
                        style={[styles.choice, styles.scaleButton, styles.flex, value === n && styles.choiceSelected]}
                        onPress={() => onChange(n)}
                        activeOpacity={0.7}
                        accessibilityRole="button"
                        accessibilityState={{ selected: value === n }}
                        accessibilityLabel={
                            n === 1 && left ? `1, ${left}` : n === 5 && right ? `5, ${right}` : String(n)
                        }
                    >
                        <Text style={[styles.choiceText, value === n && styles.choiceTextSelected]}>{n}</Text>
                    </TouchableOpacity>
                ))}
            </View>
            {left || right ? (
                <View style={styles.scaleLabels}>
                    <Text style={[styles.scaleLabel, styles.scaleLabelLeft]}>{left ?? ''}</Text>
                    <Text style={[styles.scaleLabel, styles.scaleLabelRight]}>{right ?? ''}</Text>
                </View>
            ) : null}
        </View>
    );
}

// O tipo da questão (como veio no pacote) escolhe o desenhista. O tipo `SupportedQuestionType`
// vem de lib/questionTypes: se um tipo for acrescentado lá e faltar aqui, o TypeScript reclama.
const ANSWER_COMPONENTS: Record<SupportedQuestionType, React.ComponentType<InputProps>> = {
    FREE_TEXT: TextAnswer,
    NUMERIC: NumericAnswer,
    DATE: (props) => <PickerAnswer {...props} mode="date" />,
    TIME: (props) => <PickerAnswer {...props} mode="time" />,
    YES_NO: YesNoAnswer,
    SINGLE_CHOICE: SingleChoiceAnswer,
    MULTIPLE_CHOICE: MultipleChoiceAnswer,
    SCALE_1_5: ScaleAnswer,
    PHOTO: PhotoAnswer,
    MULTIPLE_PHOTOS: PhotoAnswer,
    LOCATION: LocationAnswer,
    AUDIO: AudioAnswer,
};

// Tipos em que o erro só aparece depois que o pesquisador sai do campo (digitar "1" para chegar
// em "12" não pode gritar "mínimo 10" no meio do caminho). Seletores validam na hora de escolher.
const TYPED_TYPES = new Set<string>(['FREE_TEXT', 'NUMERIC']);

/** Mostra o campo certo para cada tipo de questão e exibe o erro depois do primeiro toque. */
export default function QuestionInput({ question, value, onChange, collectionId, audioBridge }: QuestionInputProps) {
    const [touched, setTouched] = useState(false);

    if (!isQuestionTypeSupported(question.type)) {
        return (
            <View style={styles.notice}>
                <Text style={styles.noticeText}>
                    Este tipo de questão ({question.type}) ainda não é suportado nesta versão do app. Pode avançar.
                </Text>
            </View>
        );
    }

    const Answer = ANSWER_COMPONENTS[question.type];
    const showError = !TYPED_TYPES.has(question.type) || touched;
    const error = showError ? validateAnswer(question, value) : null;

    return (
        <Answer
            question={question}
            value={value}
            onChange={onChange}
            collectionId={collectionId}
            audioBridge={audioBridge}
            error={error}
            onBlur={() => setTouched(true)}
        />
    );
}

const styles = StyleSheet.create({
    input: {
        borderWidth: 1,
        borderColor: '#d4d4d8',
        borderRadius: 8,
        backgroundColor: '#fff',
        padding: 14,
        fontSize: 16,
        color: '#18181b',
    },
    inputError: { borderColor: '#b91c1c' },
    multiline: { minHeight: 120 },
    pickerField: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    pickerText: { fontSize: 16, color: '#18181b' },
    pickerPlaceholder: { color: '#a1a1aa' },
    row: { flexDirection: 'row', gap: 8 },
    column: { gap: 8 },
    flex: { flex: 1 },
    choice: {
        borderWidth: 1,
        borderColor: '#d4d4d8',
        borderRadius: 8,
        backgroundColor: '#fff',
        paddingVertical: 14,
        paddingHorizontal: 16,
        alignItems: 'center',
    },
    choiceSelected: { borderColor: '#447762', backgroundColor: '#e8f1ed' },
    choiceBlocked: { opacity: 0.55 },
    yesNoButton: { minHeight: 120, justifyContent: 'center', borderWidth: 2, borderRadius: 14 },
    yesNoText: { fontSize: 28, fontWeight: '600', color: '#18181b' },
    optionRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56 },
    // flex: 1 + flexShrink: o texto quebra em várias linhas e nunca é cortado
    optionText: { flex: 1, flexShrink: 1, fontSize: 16, color: '#18181b', lineHeight: 22 },
    radio: {
        width: 22,
        height: 22,
        borderRadius: 11,
        borderWidth: 2,
        borderColor: '#a1a1aa',
        alignItems: 'center',
        justifyContent: 'center',
    },
    radioSelected: { borderColor: '#447762' },
    radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#447762' },
    checkbox: {
        width: 22,
        height: 22,
        borderRadius: 6,
        borderWidth: 2,
        borderColor: '#a1a1aa',
        alignItems: 'center',
        justifyContent: 'center',
    },
    checkboxSelected: { borderColor: '#447762', backgroundColor: '#447762' },
    scaleButton: { minHeight: 64, justifyContent: 'center', paddingHorizontal: 0 },
    scaleLabels: { flexDirection: 'row', justifyContent: 'space-between', gap: 16 },
    scaleLabel: { flex: 1, fontSize: 13, color: '#52525b' },
    scaleLabelLeft: { textAlign: 'left' },
    scaleLabelRight: { textAlign: 'right' },
    choiceText: { fontSize: 16, color: '#18181b' },
    choiceTextSelected: { color: '#447762', fontWeight: 'bold' },
    notice: { backgroundColor: '#fef3c7', borderRadius: 8, padding: 14 },
    noticeText: { color: '#92400e', fontSize: 14 },
    counter: { fontSize: 13, color: '#71717a', textAlign: 'right' },
    counterLimit: { color: '#92400e', fontWeight: '600' },
    hint: { fontSize: 13, color: '#71717a' },
    errorText: { fontSize: 14, color: '#b91c1c' },
});
