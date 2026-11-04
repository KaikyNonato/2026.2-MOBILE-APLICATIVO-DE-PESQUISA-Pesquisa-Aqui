import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { FileText, Home, User, CloudSync } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Brand } from '@/constants/brand';

/** Barra de abas personalizada do app. */
export function CustomTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
    const insets = useSafeAreaInsets();
    const router = useRouter();

    return (
        <View pointerEvents="box-none" style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, 12) }]}>
            <View style={styles.bar}>
                {state.routes.map((route, index) => {
                    // Ignora a renderização se a rota for de componentes ou interna
                    if (route.name.includes('_components')) {
                        return null;
                    }

                    const { options } = descriptors[route.key];
                    const label = options.title !== undefined ? options.title : route.name;
                    const isFocused = state.index === index;

                    const onPress = () => {
                        // `navigation` pode não chegar em algumas versões do expo-router; por isso é opcional
                        const event = navigation?.emit?.({
                            type: 'tabPress',
                            target: route.key,
                            canPreventDefault: true,
                        });
                        if (isFocused || event?.defaultPrevented) return;

                        if (navigation?.navigate) {
                            navigation.navigate(route.name);
                        } else {
                            // "(home)/index" -> "/(app)/(home)", "pesquisas/index" -> "/(app)/pesquisas"
                            router.navigate(`/(app)/${route.name.replace(/\/index$/, '')}` as any);
                        }
                    };

                    const color = isFocused ? Brand.mint : Brand.mutedDark;

                    let IconComponent = Home;
                    if (route.name.includes('pesquisas')) IconComponent = FileText;
                    if (route.name.includes('usuario')) IconComponent = User;
                    if (route.name.includes('sincronizacao')) IconComponent = CloudSync;

                    return (
                        <TouchableOpacity
                            key={route.key}
                            onPress={onPress}
                            style={[styles.tabButton, isFocused && styles.tabButtonOn]}
                            accessibilityRole="tab"
                            accessibilityLabel={label as string}
                            accessibilityState={{ selected: isFocused }}
                        >
                            <IconComponent color={color} size={20} strokeWidth={1.8} />
                            <Text style={[styles.label, { color }]} maxFontSizeMultiplier={1.3} numberOfLines={1}>{label as string}</Text>
                        </TouchableOpacity>
                    );
                })}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    wrap: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        paddingHorizontal: 18,
    },
    bar: {
        minHeight: 62,
        borderRadius: 999,
        backgroundColor: Brand.forest,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-around',
        paddingHorizontal: 8,
        elevation: 12,
        shadowColor: '#0a1410',
        shadowOpacity: 0.45,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: 10 },
    },
    tabButton: {
        flex: 1,
        minHeight: 48,
        borderRadius: 999,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 3,
    },
    tabButtonOn: { backgroundColor: 'rgba(191, 227, 208, 0.14)' },
    label: { fontSize: 10.5, fontWeight: '500' },
});
