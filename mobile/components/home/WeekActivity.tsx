import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { Brand } from '@/constants/brand';
import type { DayStat } from './homeStats';

const CHART_HEIGHT = 140;

/** Barra de um dia no gráfico da semana, animada ao aparecer. */
function Bar({ day, ratio, index }: { day: DayStat; ratio: number; index: number }) {
    const grow = useSharedValue(0);

    useEffect(() => {
        grow.value = withDelay(index * 55, withTiming(ratio, { duration: 650, easing: Easing.out(Easing.cubic) }));
    }, [ratio, index, grow]);

    const fill = useAnimatedStyle(() => ({ height: `${grow.value * 100}%` }));

    return (
        <View style={styles.col} accessible accessibilityLabel={`${day.count} coletas${day.isToday ? ' hoje' : ''}`}>
            <Text style={[styles.count, day.count === 0 && styles.hidden]}>{day.count}</Text>
            <View style={styles.track}>
                <Animated.View style={[styles.fill, day.isToday && styles.fillToday, fill]} />
            </View>
            <Text style={[styles.day, day.isToday && styles.dayToday]}>{day.label}</Text>
        </View>
    );
}

/** Coletas dos últimos 7 dias em barras que crescem; hoje fica em destaque. */
export default function WeekActivity({ days }: { days: DayStat[] }) {
    const max = Math.max(1, ...days.map((d) => d.count));
    const total = days.reduce((sum, d) => sum + d.count, 0);

    return (
        <View style={styles.card}>
            <View style={styles.chart}>
                {days.map((day, index) => (
                    <Bar
                        key={day.key}
                        day={day}
                        index={index}
                        ratio={day.count === 0 ? 0 : Math.max(0.16, day.count / max)}
                    />
                ))}
            </View>
            {total === 0 ? <Text style={styles.empty}>Nenhuma coleta nos últimos 7 dias. Que tal começar hoje?</Text> : null}
        </View>
    );
}

const styles = StyleSheet.create({
    card: {
        backgroundColor: Brand.card,
        borderWidth: 1,
        borderColor: Brand.line,
        borderRadius: 22,
        paddingHorizontal: 14,
        paddingTop: 14,
        paddingBottom: 12,
        gap: 10,
    },
    chart: { flexDirection: 'row', height: CHART_HEIGHT, gap: 8 },
    col: { flex: 1, alignItems: 'center', gap: 6 },
    count: { height: 16, fontSize: 12, fontWeight: '600', color: Brand.greenDeep, fontVariant: ['tabular-nums'] },
    hidden: { opacity: 0 },
    track: {
        flex: 1,
        width: '100%',
        maxWidth: 34,
        borderRadius: 12,
        backgroundColor: Brand.trackLight,
        overflow: 'hidden',
        justifyContent: 'flex-end',
    },
    fill: { width: '100%', borderRadius: 12, backgroundColor: '#8fbba5' },
    fillToday: { backgroundColor: Brand.forest },
    day: { height: 16, fontSize: 12, color: Brand.muted },
    dayToday: { color: Brand.ink, fontWeight: '700' },
    empty: { fontSize: 12.5, color: Brand.muted, textAlign: 'center' },
});
