import React, { ReactNode } from 'react';
import { StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Bolt } from 'lucide-react-native';

interface DecoratedCardProps {
    children: ReactNode;
    style?: StyleProp<ViewStyle>; // Permite passar estilos extras (padding, margens, etc)
}

/** Card decorativo com gradiente. */
export default function InfoCard({ children, style }: DecoratedCardProps) {
    return (
        <LinearGradient
            colors={['#B66D561A', '#FFFFFF1A', '#124B521A']}
            locations={[0, 0.5, 1]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.baseCard, style]}
        >
            {children}

            {/* Ícones decorativos nos cantos padronizados */}
            <Bolt size={10} style={styles.bolt1} />
            <Bolt size={10} style={styles.bolt2} />
            <Bolt size={10} style={styles.bolt3} />
            <Bolt size={10} style={styles.bolt4} />
        </LinearGradient>
    );
}

const styles = StyleSheet.create({
    baseCard: {
        backgroundColor: '#fff',
        borderWidth: 1,
        borderColor: '#00000015',
        borderRadius: 8,
        position: 'relative',
        padding: 13,
    },
    bolt1: { position: 'absolute', top: 4, left: 4, opacity: 0.4 },
    bolt2: { position: 'absolute', top: 4, right: 4, opacity: 0.4 },
    bolt3: { position: 'absolute', bottom: 4, left: 4, opacity: 0.4 },
    bolt4: { position: 'absolute', bottom: 4, right: 4, opacity: 0.4 },
});
