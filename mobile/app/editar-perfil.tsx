import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { Building2, Camera, ChevronLeft, ImageIcon, Trash2, User } from 'lucide-react-native';
import {
    ActivityIndicator,
    Alert,
    Linking,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import Animated, { Easing, FadeInDown, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import Chip from '@/components/Chip';
import Contour from '@/components/Contour';
import { Brand, Radius } from '@/constants/brand';
import { useAuth } from '@/context/AuthContext';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { removeAvatar, uploadAvatar } from '@/lib/auth';
import { avatarSrc, useImageHeaders } from '@/lib/avatar';
import { discardAvatarFile, pickAvatar } from '@/lib/avatarPicker';

const initialsOf = (name?: string) =>
    (name ?? '')
        .split(' ')
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase())
        .join('') || '?';

const enter = (index: number) =>
    FadeInDown.delay(120 + index * 80)
        .duration(480)
        .easing(Easing.out(Easing.cubic));

interface ActionRowProps {
    label: string;
    hint?: string;
    icon: ReactNode;
    onPress: () => void;
    disabled?: boolean;
    danger?: boolean;
}

function ActionRow({ label, hint, icon, onPress, disabled, danger }: ActionRowProps) {
    return (
        <Pressable
            onPress={onPress}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ disabled: !!disabled }}
            style={({ pressed }) => [
                styles.row,
                danger && styles.rowDanger,
                pressed && styles.rowPressed,
                disabled && styles.rowDisabled,
            ]}
        >
            <View style={[styles.rowIcon, danger && styles.rowIconDanger]}>{icon}</View>
            <View style={styles.rowText}>
                <Text style={[styles.rowLabel, danger && styles.rowLabelDanger]}>{label}</Text>
                {hint ? <Text style={styles.rowHint}>{hint}</Text> : null}
            </View>
        </Pressable>
    );
}

function InfoLine({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
    return (
        <View style={styles.infoLine}>
            <View style={styles.rowIcon}>{icon}</View>
            <View style={styles.rowText}>
                <Text style={styles.rowHint}>{label}</Text>
                <Text style={styles.infoValue} numberOfLines={2}>{value}</Text>
            </View>
        </View>
    );
}

export default function EditarPerfil() {
    const router = useRouter();
    const { user, refreshUser } = useAuth();
    const isOnline = useNetworkStatus();
    const imageHeaders = useImageHeaders();
    const [photoFailed, setPhotoFailed] = useState(false);
    const [busy, setBusy] = useState(false);

    // Foto nova: tenta carregar de novo.
    useEffect(() => {
        setPhotoFailed(false);
    }, [user?.avatarUrl]);

    // As curvas de nível "respiram" devagar, como na Home.
    const breathe = useSharedValue(0);
    // Quem pediu menos movimento no aparelho não vê a animação.
    const reduceMotion = useReducedMotion();
    useEffect(() => {
        if (reduceMotion) return;
        breathe.value = withRepeat(withTiming(1, { duration: 9000, easing: Easing.inOut(Easing.sin) }), -1, true);
    }, [breathe, reduceMotion]);
    const contourStyle = useAnimatedStyle(() => ({
        transform: [{ scale: 1 + breathe.value * 0.07 }, { translateX: breathe.value * -6 }],
    }));

    const hasPhoto = !!user?.avatarUrl;
    const canEdit = isOnline && !busy;

    const choose = async (source: 'camera' | 'library') => {
        if (busy) return;
        if (!isOnline) {
            Alert.alert('Sem internet', 'Conecte-se à internet para trocar a foto de perfil.');
            return;
        }

        setBusy(true);
        try {
            const result = await pickAvatar(source);

            if (result.status === 'denied') {
                Alert.alert(
                    'Câmera bloqueada',
                    result.canAskAgain
                        ? 'Permita o uso da câmera para tirar a foto de perfil.'
                        : 'Libere a câmera nas configurações do aparelho para tirar a foto de perfil.',
                    result.canAskAgain
                        ? [{ text: 'OK' }]
                        : [
                              { text: 'Agora não', style: 'cancel' },
                              { text: 'Abrir configurações', onPress: () => Linking.openSettings().catch(() => undefined) },
                          ],
                );
                return;
            }
            if (result.status === 'error') {
                Alert.alert('Não foi possível', result.message);
                return;
            }
            if (result.status !== 'ok') return;

            try {
                await uploadAvatar(result.uri);
                await refreshUser();
            } catch (error) {
                Alert.alert('Não foi possível', error instanceof Error ? error.message : 'Tente novamente.');
            } finally {
                discardAvatarFile(result.uri);
            }
        } finally {
            setBusy(false);
        }
    };

    const confirmRemove = () => {
        if (!isOnline) {
            Alert.alert('Sem internet', 'Conecte-se à internet para remover a foto de perfil.');
            return;
        }
        Alert.alert('Remover foto', 'Sua foto de perfil será removida e o app voltará a mostrar suas iniciais.', [
            { text: 'Cancelar', style: 'cancel' },
            {
                text: 'Remover',
                style: 'destructive',
                onPress: async () => {
                    setBusy(true);
                    try {
                        await removeAvatar();
                        await refreshUser();
                    } catch (error) {
                        Alert.alert('Não foi possível', error instanceof Error ? error.message : 'Tente novamente.');
                    } finally {
                        setBusy(false);
                    }
                },
            },
        ]);
    };

    return (
        <SafeAreaView edges={['top']} style={styles.safe}>
            <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
                <View style={styles.hero}>
                    <Animated.View style={[StyleSheet.absoluteFill, contourStyle]} pointerEvents="none">
                        <Contour seed={3.6} rings={10} cx={0.85} cy={0.35} size={1} opacity={0.8} color={Brand.green} />
                    </Animated.View>

                    <View style={styles.heroRow}>
                        <Pressable
                            onPress={() => router.back()}
                            hitSlop={10}
                            accessibilityRole="button"
                            accessibilityLabel="Voltar"
                            style={styles.back}
                        >
                            <ChevronLeft size={22} color={Brand.fgDark} strokeWidth={2} />
                        </Pressable>
                        <Chip label={isOnline ? 'Online' : 'Offline'} tone={isOnline ? 'dark' : 'clay'} />
                    </View>

                    <Text style={styles.title} accessibilityRole="header">Editar perfil</Text>
                    <Text style={styles.subtitle}>Escolha a foto que aparece no seu perfil.</Text>

                    <View style={styles.avatarWrap}>
                        <View style={styles.avatarRing}>
                            <View style={styles.avatar}>
                                {user?.avatarUrl && !photoFailed && imageHeaders ? (
                                    <Image
                                        source={{ uri: avatarSrc(user.avatarUrl, 120), headers: imageHeaders }}
                                        style={styles.avatarImage}
                                        contentFit="cover"
                                        transition={150}
                                        accessibilityLabel="Foto de perfil"
                                        onError={() => setPhotoFailed(true)}
                                    />
                                ) : (
                                    <Text style={styles.avatarText}>{initialsOf(user?.name)}</Text>
                                )}
                                {busy ? (
                                    <View style={styles.avatarBusy}>
                                        <ActivityIndicator color={Brand.mint} />
                                    </View>
                                ) : null}
                            </View>
                        </View>
                    </View>
                </View>

                <View style={styles.body}>
                    {!isOnline ? (
                        <Animated.View entering={enter(0)} style={styles.offline}>
                            <Text style={styles.offlineText}>Sem internet: a foto só pode ser trocada quando a rede voltar.</Text>
                        </Animated.View>
                    ) : null}

                    <Animated.View entering={enter(1)} style={styles.section}>
                        <Text style={styles.sectionTitle}>Foto de perfil</Text>
                        <View style={styles.stack}>
                            <ActionRow
                                label="Tirar foto"
                                hint="Usar a câmera do aparelho"
                                icon={<Camera size={18} color={Brand.greenDeep} strokeWidth={1.8} />}
                                onPress={() => choose('camera')}
                                disabled={!canEdit}
                            />
                            <ActionRow
                                label="Escolher da galeria"
                                hint="Selecionar uma foto que já está no aparelho"
                                icon={<ImageIcon size={18} color={Brand.greenDeep} strokeWidth={1.8} />}
                                onPress={() => choose('library')}
                                disabled={!canEdit}
                            />
                            {hasPhoto ? (
                                <ActionRow
                                    label="Remover foto"
                                    icon={<Trash2 size={18} color={Brand.clayInk} strokeWidth={1.8} />}
                                    onPress={confirmRemove}
                                    disabled={!canEdit}
                                    danger
                                />
                            ) : null}
                        </View>
                    </Animated.View>

                    <Animated.View entering={enter(2)} style={styles.section}>
                        <Text style={styles.sectionTitle}>Seus dados</Text>
                        <View style={styles.info}>
                            <InfoLine
                                icon={<User size={18} color={Brand.greenDeep} strokeWidth={1.8} />}
                                label="Nome"
                                value={user?.name ?? '—'}
                            />
                            {user?.sub ? (
                                <>
                                    <View style={styles.infoDivider} />
                                    <InfoLine
                                        icon={<User size={18} color={Brand.greenDeep} strokeWidth={1.8} />}
                                        label="Usuário"
                                        value={`@${user.sub}`}
                                    />
                                </>
                            ) : null}
                            {user?.companyName ? (
                                <>
                                    <View style={styles.infoDivider} />
                                    <InfoLine
                                        icon={<Building2 size={18} color={Brand.greenDeep} strokeWidth={1.8} />}
                                        label="Empresa"
                                        value={user.companyName}
                                    />
                                </>
                            ) : null}
                        </View>
                        <Text style={styles.note}>Nome e usuário são definidos pelo administrador da sua empresa.</Text>
                    </Animated.View>
                </View>
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safe: { flex: 1, backgroundColor: Brand.forest },
    container: { flex: 1, backgroundColor: Brand.paper },
    content: { flexGrow: 1, paddingBottom: 40 },
    hero: {
        backgroundColor: Brand.forest,
        paddingHorizontal: 22,
        paddingTop: 18,
        paddingBottom: 26,
        borderBottomLeftRadius: Radius.hero,
        borderBottomRightRadius: Radius.hero,
        overflow: 'hidden',
    },
    heroRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    back: {
        width: 40,
        height: 40,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: Brand.lineDark,
        alignItems: 'center',
        justifyContent: 'center',
    },
    title: { color: Brand.fgDark, marginTop: 22, fontSize: 28, fontWeight: '600', letterSpacing: -0.8 },
    subtitle: { color: Brand.mutedDark, marginTop: 4, fontSize: 14, lineHeight: 20 },
    avatarWrap: { alignItems: 'center', marginTop: 24 },
    avatarRing: {
        width: 136,
        height: 136,
        borderRadius: 68,
        borderWidth: 1,
        borderColor: Brand.lineDark,
        alignItems: 'center',
        justifyContent: 'center',
    },
    avatar: {
        width: 120,
        height: 120,
        borderRadius: 60,
        backgroundColor: Brand.mint,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
    },
    avatarImage: { width: '100%', height: '100%' },
    avatarText: { color: Brand.forest, fontWeight: '700', fontSize: 40 },
    avatarBusy: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(10, 20, 16, 0.55)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    body: { padding: 18, gap: 22 },
    section: { gap: 12 },
    sectionTitle: { fontSize: 16, fontWeight: '600', letterSpacing: -0.3, color: Brand.ink },
    stack: { gap: 10 },
    offline: {
        padding: 14,
        borderRadius: 18,
        backgroundColor: Brand.clayLight,
    },
    offlineText: { fontSize: 13, lineHeight: 18, color: Brand.clayInk },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        padding: 14,
        borderRadius: 22,
        borderWidth: 1,
        borderColor: Brand.line,
        backgroundColor: Brand.card,
    },
    rowDanger: { backgroundColor: Brand.clayLight, borderColor: 'transparent' },
    rowPressed: { backgroundColor: '#f5f8f5' },
    rowDisabled: { opacity: 0.5 },
    rowIcon: {
        width: 38,
        height: 38,
        borderRadius: 12,
        backgroundColor: Brand.chipLight,
        alignItems: 'center',
        justifyContent: 'center',
    },
    rowIconDanger: { backgroundColor: 'rgba(171, 96, 73, 0.16)' },
    rowText: { flex: 1, minWidth: 0, gap: 2 },
    rowLabel: { fontSize: 15, fontWeight: '600', letterSpacing: -0.2, color: Brand.ink },
    rowLabelDanger: { color: Brand.clayInk },
    rowHint: { fontSize: 12.5, color: Brand.muted },
    info: {
        borderRadius: 22,
        borderWidth: 1,
        borderColor: Brand.line,
        backgroundColor: Brand.card,
        paddingHorizontal: 14,
    },
    infoLine: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12 },
    infoValue: { fontSize: 15, fontWeight: '500', color: Brand.ink },
    infoDivider: { height: 1, backgroundColor: Brand.line },
    note: { fontSize: 12.5, lineHeight: 18, color: Brand.muted, marginLeft: 4 },
});
