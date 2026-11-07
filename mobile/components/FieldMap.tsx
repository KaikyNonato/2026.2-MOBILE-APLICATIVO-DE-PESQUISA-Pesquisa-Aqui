import { forwardRef, useImperativeHandle } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { MapPin } from 'lucide-react-native';
import { Brand } from '@/constants/brand';
import type { FieldMapHandle, FieldMapProps } from './FieldMap.types';

/** Versão web do mapa: o react-native-maps só existe no Android/iOS, então aqui aparece um aviso no lugar. */
const FieldMap = forwardRef<FieldMapHandle, FieldMapProps>(function FieldMap(_props, ref) {
    useImperativeHandle(ref, () => ({ animateToRegion: () => {} }));

    return (
        <View style={styles.box}>
            <MapPin size={28} color={Brand.muted} />
            <Text style={styles.text}>O mapa está disponível apenas no aplicativo do celular.</Text>
        </View>
    );
});

const styles = StyleSheet.create({
    box: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 16 },
    text: { color: Brand.muted, textAlign: 'center', fontSize: 13 },
});

export default FieldMap;
