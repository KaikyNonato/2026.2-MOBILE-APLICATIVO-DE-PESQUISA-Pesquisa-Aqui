import React, { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { Brand } from '@/constants/brand';

interface MenuCardProps {
    label: string;
    icon: ReactNode;
    onPress?: () => void;
    /** Texto curto à direita (ex.: a versão do aplicativo). */
    value?: string;
}

/** Item de menu da tela de usuário (ícone, rótulo e valor). */
export default function MenuCard({ label, icon, onPress, value }: MenuCardProps) {
    return (
        <Pressable
            onPress={onPress}
            disabled={!onPress}
            accessibilityRole={onPress ? 'button' : 'text'}
            style={({ pressed }) => [styles.card, pressed && styles.pressed]}
        >
            <View style={styles.iconBox}>{icon}</View>
            <Text style={styles.label}>{label}</Text>
            {value ? <Text style={styles.value}>{value}</Text> : null}
            {onPress ? <ChevronRight size={18} color={Brand.muted} strokeWidth={1.8} /> : null}
        </Pressable>
    );
}

const styles = StyleSheet.create({
    card: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        padding: 12,
        borderRadius: 22,
        borderWidth: 1,
        borderColor: Brand.line,
        backgroundColor: Brand.card,
    },
    pressed: { backgroundColor: '#f5f8f5' },
    iconBox: {
        width: 38,
        height: 38,
        borderRadius: 12,
        backgroundColor: Brand.chipLight,
        alignItems: 'center',
        justifyContent: 'center',
    },
    label: { flex: 1, fontSize: 15, color: Brand.ink, fontWeight: '500' },
    value: { fontSize: 13, color: Brand.muted, fontWeight: '500', marginRight: 4 },
});
