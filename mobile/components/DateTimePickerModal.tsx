import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import {
    dateKey,
    daysInMonth,
    formatBrDate,
    formatTime,
    parseBrDate,
    parseIsoDate,
    parseTime,
    type DateParts,
} from '@/lib/questionTypes';

const ITEM_HEIGHT = 44;
const VISIBLE_ITEMS = 5;

const MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

interface DateTimePickerModalProps {
    visible: boolean;
    mode: 'date' | 'time';
    title: string;
    /** Resposta atual: "DD/MM/AAAA" ou "HH:MM". Vazia = abre na data/hora de agora. */
    value: string;
    /** Intervalo permitido ("AAAA-MM-DD"), vindo da questão. Só vale para o modo de data. */
    minDate?: string;
    maxDate?: string;
    onConfirm: (value: string) => void;
    onClear?: () => void;
    onCancel: () => void;
}

interface ColumnItem {
    value: number;
    label: string;
    disabled?: boolean;
}

/** Coluna rolável de opções do seletor. */
function Column({
    items,
    selected,
    onSelect,
    flex = 1,
}: {
    items: ColumnItem[];
    selected: number;
    onSelect: (value: number) => void;
    flex?: number;
}) {
    const scrollRef = useRef<ScrollView>(null);
    const index = Math.max(
        0,
        items.findIndex((item) => item.value === selected),
    );

    const scrollToSelected = () => scrollRef.current?.scrollTo({ y: index * ITEM_HEIGHT, animated: false });

    // Mantém o item escolhido no centro (inclusive quando a seleção muda sozinha por causa do intervalo)
    useEffect(scrollToSelected, [index]);

    return (
        <ScrollView
            ref={scrollRef}
            style={{ flex, height: ITEM_HEIGHT * VISIBLE_ITEMS }}
            contentContainerStyle={{ paddingVertical: ITEM_HEIGHT * Math.floor(VISIBLE_ITEMS / 2) }}
            showsVerticalScrollIndicator={false}
            onContentSizeChange={scrollToSelected}
            nestedScrollEnabled
        >
            {items.map((item) => {
                const isSelected = item.value === selected;
                return (
                    <Pressable
                        key={item.value}
                        style={styles.item}
                        disabled={item.disabled}
                        onPress={() => onSelect(item.value)}
                    >
                        <Text
                            style={[
                                styles.itemText,
                                isSelected && styles.itemTextSelected,
                                item.disabled && styles.itemTextDisabled,
                            ]}
                        >
                            {item.label}
                        </Text>
                    </Pressable>
                );
            })}
        </ScrollView>
    );
}

/** Dia, mês e ano de hoje. */
function todayParts(): DateParts {
    const now = new Date();
    return { day: now.getDate(), month: now.getMonth() + 1, year: now.getFullYear() };
}

/** Só existe enquanto aberto: a cada abertura o estado nasce da resposta atual (ou de agora). */
export default function DateTimePickerModal(props: DateTimePickerModalProps) {
    if (!props.visible) return null;
    return <PickerSheet {...props} />;
}

/** Painel do seletor de data ou de hora, conforme `mode`. */
function PickerSheet({
    mode,
    title,
    value,
    minDate,
    maxDate,
    onConfirm,
    onClear,
    onCancel,
}: DateTimePickerModalProps) {
    const min = useMemo(() => parseIsoDate(minDate), [minDate]);
    const max = useMemo(() => parseIsoDate(maxDate), [maxDate]);

    /** Leva qualquer data para dentro do intervalo permitido (e para um dia que exista no mês). */
    const clampDate = (d: DateParts): DateParts => {
        let next = { ...d, day: Math.min(d.day, daysInMonth(d.year, d.month)) };
        if (min && dateKey(next) < dateKey(min)) next = min;
        if (max && dateKey(next) > dateKey(max)) next = max;
        return next;
    };

    const [date, setDate] = useState<DateParts>(() => clampDate(parseBrDate(value) ?? todayParts()));
    const [time, setTime] = useState(() => {
        const now = new Date();
        return parseTime(value) ?? { hour: now.getHours(), minute: now.getMinutes() };
    });

    const inRange = (d: DateParts) =>
        (!min || dateKey(d) >= dateKey(min)) && (!max || dateKey(d) <= dateKey(max));

    const years = useMemo<ColumnItem[]>(() => {
        const thisYear = new Date().getFullYear();
        const lo = min?.year ?? (max ? max.year - 100 : thisYear - 100);
        const hi = max?.year ?? Math.max(thisYear + 10, lo);
        const list: ColumnItem[] = [];
        for (let y = hi; y >= lo; y--) list.push({ value: y, label: String(y) });
        return list;
    }, [min, max]);

    const months = useMemo<ColumnItem[]>(
        () =>
            MONTHS.map((label, i) => {
                const month = i + 1;
                const first = { year: date.year, month, day: 1 };
                const last = { year: date.year, month, day: daysInMonth(date.year, month) };
                // Mês só pode ser escolhido se tiver algum dia dentro do intervalo
                const disabled = (min && dateKey(last) < dateKey(min)) || (max && dateKey(first) > dateKey(max));
                return { value: month, label, disabled: !!disabled };
            }),
        [date.year, min, max],
    );

    const days = useMemo<ColumnItem[]>(() => {
        const list: ColumnItem[] = [];
        for (let day = 1; day <= daysInMonth(date.year, date.month); day++) {
            list.push({
                value: day,
                label: String(day).padStart(2, '0'),
                disabled: !inRange({ year: date.year, month: date.month, day }),
            });
        }
        return list;
    }, [date.year, date.month, min, max]); // eslint-disable-line react-hooks/exhaustive-deps

    const hours = useMemo<ColumnItem[]>(
        () => Array.from({ length: 24 }, (_, h) => ({ value: h, label: String(h).padStart(2, '0') })),
        [],
    );
    const minutes = useMemo<ColumnItem[]>(
        () => Array.from({ length: 60 }, (_, m) => ({ value: m, label: String(m).padStart(2, '0') })),
        [],
    );

    const confirm = () => onConfirm(mode === 'date' ? formatBrDate(date) : formatTime(time.hour, time.minute));

    return (
        <Modal visible transparent animationType="fade" onRequestClose={onCancel} statusBarTranslucent>
            <View style={styles.overlay}>
                <Pressable style={styles.backdrop} onPress={onCancel} />
                <View style={styles.sheet}>
                    <Text style={styles.title}>{title}</Text>
                    <Text style={styles.preview}>
                        {mode === 'date' ? formatBrDate(date) : formatTime(time.hour, time.minute)}
                    </Text>

                    <View style={styles.columns}>
                        <View pointerEvents="none" style={styles.selectionBand} />
                        {mode === 'date' ? (
                            <>
                                <Column
                                    items={days}
                                    selected={date.day}
                                    onSelect={(day) => setDate((d) => clampDate({ ...d, day }))}
                                />
                                <Column
                                    items={months}
                                    selected={date.month}
                                    onSelect={(month) => setDate((d) => clampDate({ ...d, month }))}
                                    flex={1.2}
                                />
                                <Column
                                    items={years}
                                    selected={date.year}
                                    onSelect={(year) => setDate((d) => clampDate({ ...d, year }))}
                                    flex={1.4}
                                />
                            </>
                        ) : (
                            <>
                                <Column
                                    items={hours}
                                    selected={time.hour}
                                    onSelect={(hour) => setTime((t) => ({ ...t, hour }))}
                                />
                                <Text style={styles.timeSeparator}>:</Text>
                                <Column
                                    items={minutes}
                                    selected={time.minute}
                                    onSelect={(minute) => setTime((t) => ({ ...t, minute }))}
                                />
                            </>
                        )}
                    </View>

                    <View style={styles.actions}>
                        <TouchableOpacity style={styles.secondaryButton} onPress={onCancel}>
                            <Text style={styles.secondaryButtonText}>Cancelar</Text>
                        </TouchableOpacity>
                        {onClear && value ? (
                            <TouchableOpacity style={styles.secondaryButton} onPress={onClear}>
                                <Text style={styles.secondaryButtonText}>Limpar</Text>
                            </TouchableOpacity>
                        ) : null}
                        <TouchableOpacity style={styles.primaryButton} onPress={confirm}>
                            <Text style={styles.primaryButtonText}>Confirmar</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    overlay: { flex: 1, justifyContent: 'flex-end' },
    backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.4)' },
    sheet: {
        backgroundColor: '#fff',
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
        padding: 20,
        gap: 12,
    },
    title: { fontSize: 16, fontWeight: 'bold', color: '#18181b', textAlign: 'center' },
    preview: { fontSize: 22, fontWeight: 'bold', color: '#447762', textAlign: 'center' },
    columns: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    selectionBand: {
        position: 'absolute',
        left: 0,
        right: 0,
        top: ITEM_HEIGHT * Math.floor(VISIBLE_ITEMS / 2),
        height: ITEM_HEIGHT,
        borderRadius: 8,
        backgroundColor: '#e8f1ed',
    },
    item: { height: ITEM_HEIGHT, alignItems: 'center', justifyContent: 'center' },
    itemText: { fontSize: 18, color: '#52525b' },
    itemTextSelected: { color: '#447762', fontWeight: 'bold' },
    itemTextDisabled: { color: '#d4d4d8' },
    timeSeparator: { fontSize: 22, fontWeight: 'bold', color: '#447762' },
    actions: { flexDirection: 'row', gap: 8, marginTop: 4 },
    primaryButton: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#447762',
        padding: 14,
        borderRadius: 8,
    },
    primaryButtonText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
    secondaryButton: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 14,
        paddingHorizontal: 16,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#447762',
    },
    secondaryButtonText: { color: '#447762', fontWeight: 'bold', fontSize: 16 },
});
