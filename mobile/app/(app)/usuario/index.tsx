import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { AtSign, Building2, IdCard, LogOut, Pencil, ShieldCheck, Smartphone } from 'lucide-react-native';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, {
    Easing,
    FadeInDown,
    useAnimatedStyle,
    useSharedValue,
    withRepeat,
    withTiming,
} from 'react-native-reanimated';
import Chip from '@/components/Chip';
import Contour from '@/components/Contour';
import { Brand, Radius, TAB_BAR_CLEARANCE } from '@/constants/brand';
import { useAuth } from '@/context/AuthContext';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { avatarSrc, logoSrc, useImageHeaders } from '@/lib/avatar';
import MenuCard from './_components/MenuCard';

const APP_VERSION = '1.0.2';

const PROFILE_LABELS: Record<string, string> = {
    SUPERADMINISTRATOR: 'Superadministrador',
    ADMINISTRATOR: 'Administrador',
    RESEARCHER: 'Pesquisador',
};

const initialsOf = (name?: string) =>
    (name ?? '')
        .split(' ')
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase())
        .join('') || '?';

/** Entrada escalonada, igual à da Home: cada bloco sobe e aparece um pouco depois do anterior. */
const enter = (index: number) =>
    FadeInDown.delay(120 + index * 80)
        .duration(480)
        .easing(Easing.out(Easing.cubic));

function SectionHeader({ title }: { title: string }) {
    return (
        <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{title}</Text>
        </View>
    );
}

/** Uma linha de dado da conta: ícone, rótulo pequeno e o valor. */
function InfoRow({ icon, label, value, last = false }: { icon: ReactNode; label: string; value: string; last?: boolean }) {
    return (
        <View style={[styles.infoRow, !last && styles.infoRowDivider]}>
            <View style={styles.infoIcon}>{icon}</View>
            <View style={styles.infoText}>
                <Text style={styles.infoLabel}>{label}</Text>
                <Text style={styles.infoValue} numberOfLines={1}>{value}</Text>
            </View>
        </View>
    );
}

export default function Usuario() {
    const router = useRouter();
    const { user, logout } = useAuth();
    // Se a foto não carregar (sem rede, por exemplo), voltam as iniciais.
    const [photoFailed, setPhotoFailed] = useState(false);
    const [logoFailed, setLogoFailed] = useState(false);
    const isOnline = useNetworkStatus();
    const imageHeaders = useImageHeaders();

    // As curvas de nível "respiram" devagar, como na Home.
    const breathe = useSharedValue(0);
    useEffect(() => {
        breathe.value = withRepeat(withTiming(1, { duration: 9000, easing: Easing.inOut(Easing.sin) }), -1, true);
    }, [breathe]);
    const contourStyle = useAnimatedStyle(() => ({
        transform: [{ scale: 1 + breathe.value * 0.07 }, { translateX: breathe.value * -6 }],
    }));

    const handleLogout = () => {
        Alert.alert(
            'Sair da conta',
            'Ao sair, os dados salvos neste aparelho serão apagados. Deseja continuar?',
            [
                { text: 'Cancelar', style: 'cancel' },
                {
                    text: 'Sair',
                    style: 'destructive',
                    onPress: async () => {
                        await logout();
                        router.replace('/login');
                    },
                },
            ]
        );
    };

    const profileLabel = user?.profile ? PROFILE_LABELS[user.profile] ?? user.profile : 'Sem perfil';
    let sectionIndex = 0;

    return (
        <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            {/* Cabeçalho: só quem é a pessoa (foto, nome, login e perfil). Números de coleta ficam na Home e em Sinc. */}
            <View style={styles.hero}>
                <Animated.View style={[StyleSheet.absoluteFill, contourStyle]} pointerEvents="none">
                    <Contour seed={3.6} rings={10} cx={0.85} cy={0.35} size={1} opacity={0.8} color={Brand.green} />
                </Animated.View>

                <View style={styles.identity}>
                    <Pressable
                        onPress={() => router.push('/editar-perfil')}
                        accessibilityRole="button"
                        accessibilityLabel="Editar foto de perfil"
                        style={styles.avatarRing}
                    >
                        <View style={styles.avatar}>
                            {user?.avatarUrl && !photoFailed && imageHeaders ? (
                                <Image
                                    source={{ uri: avatarSrc(user.avatarUrl, 128), headers: imageHeaders }}
                                    style={styles.avatarImage}
                                    contentFit="cover"
                                    transition={150}
                                    accessibilityLabel="Foto de perfil"
                                    onError={() => setPhotoFailed(true)}
                                />
                            ) : (
                                <Text style={styles.avatarText}>{initialsOf(user?.name)}</Text>
                            )}
                        </View>
                        <View style={styles.avatarBadge}>
                            <Pencil size={13} color={Brand.forest} strokeWidth={2.2} />
                        </View>
                    </Pressable>

                    <Text style={styles.name} numberOfLines={2}>{user?.name ?? 'Usuário'}</Text>
                    {user?.sub ? <Text style={styles.login} numberOfLines={1}>@{user.sub}</Text> : null}

                    <View style={styles.chips}>
                        <Chip label={profileLabel} tone="dark" />
                        <Chip label={isOnline ? 'Online' : 'Offline'} tone={isOnline ? 'dark' : 'clay'} />
                    </View>
                </View>
            </View>

            <View style={styles.body}>
                <Animated.View entering={enter(++sectionIndex)} style={styles.section}>
                    <SectionHeader title="Dados da conta" />
                    <View style={styles.infoCard}>
                        <InfoRow icon={<IdCard size={18} color={Brand.greenDeep} strokeWidth={1.8} />} label="Nome" value={user?.name ?? '—'} />
                        <InfoRow icon={<AtSign size={18} color={Brand.greenDeep} strokeWidth={1.8} />} label="Usuário" value={user?.sub ? `@${user.sub}` : '—'} />
                        <InfoRow icon={<ShieldCheck size={18} color={Brand.greenDeep} strokeWidth={1.8} />} label="Perfil de acesso" value={profileLabel} last />
                    </View>
                </Animated.View>

                {user?.companyName ? (
                    <Animated.View entering={enter(++sectionIndex)} style={styles.section}>
                        <SectionHeader title="Empresa" />
                        <View style={styles.company}>
                            <View style={styles.companyLogo}>
                                {user.companyLogoUrl && !logoFailed && imageHeaders ? (
                                    <Image
                                        source={{ uri: logoSrc(user.companyLogoUrl, 44), headers: imageHeaders }}
                                        style={styles.companyLogoImage}
                                        contentFit="contain"
                                        transition={150}
                                        accessibilityLabel="Logo da empresa"
                                        onError={() => setLogoFailed(true)}
                                    />
                                ) : (
                                    <Building2 size={24} color={Brand.greenDeep} strokeWidth={1.7} />
                                )}
                            </View>
                            <View style={styles.companyText}>
                                <Text style={styles.companyCaption}>Você faz parte de</Text>
                                <Text style={styles.companyName} numberOfLines={2}>{user.companyName}</Text>
                            </View>
                        </View>
                    </Animated.View>
                ) : null}

                <Animated.View entering={enter(++sectionIndex)} style={styles.section}>
                    <SectionHeader title="Conta" />
                    <MenuCard
                        label="Editar perfil"
                        onPress={() => router.push('/editar-perfil')}
                        icon={<Pencil size={18} color={Brand.greenDeep} strokeWidth={1.8} />}
                    />
                </Animated.View>

                <Animated.View entering={enter(++sectionIndex)} style={styles.section}>
                    <SectionHeader title="Aplicativo" />
                    <MenuCard
                        label="Sobre o aplicativo"
                        value={`v${APP_VERSION}`}
                        icon={<Smartphone size={18} color={Brand.greenDeep} strokeWidth={1.8} />}
                    />
                </Animated.View>

                <Animated.View entering={enter(++sectionIndex)}>
                    <Pressable
                        style={({ pressed }) => [styles.logout, pressed && styles.logoutPressed]}
                        onPress={handleLogout}
                        accessibilityRole="button"
                        accessibilityLabel="Sair da conta"
                    >
                        <LogOut size={18} color={Brand.clayInk} strokeWidth={1.8} />
                        <Text style={styles.logoutText}>Sair da conta</Text>
                    </Pressable>
                </Animated.View>
            </View>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: Brand.paper },
    content: { flexGrow: 1, paddingBottom: TAB_BAR_CLEARANCE },
    hero: {
        backgroundColor: Brand.forest,
        paddingHorizontal: 22,
        paddingTop: 36,
        paddingBottom: 30,
        borderBottomLeftRadius: Radius.hero,
        borderBottomRightRadius: Radius.hero,
        overflow: 'hidden',
    },
    identity: { alignItems: 'center' },
    avatarRing: {
        width: 116,
        height: 116,
        borderRadius: 58,
        borderWidth: 1,
        borderColor: Brand.lineDark,
        alignItems: 'center',
        justifyContent: 'center',
    },
    avatar: {
        width: 102,
        height: 102,
        borderRadius: 51,
        backgroundColor: Brand.mint,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
    },
    avatarImage: { width: '100%', height: '100%' },
    avatarText: { color: Brand.forest, fontWeight: '700', fontSize: 36 },
    avatarBadge: {
        position: 'absolute',
        right: 2,
        bottom: 4,
        width: 30,
        height: 30,
        borderRadius: 15,
        backgroundColor: Brand.mint,
        borderWidth: 2,
        borderColor: Brand.forest,
        alignItems: 'center',
        justifyContent: 'center',
    },
    name: { color: Brand.fgDark, fontSize: 26, fontWeight: '600', letterSpacing: -0.6, marginTop: 16, textAlign: 'center' },
    login: { color: Brand.mutedDark, marginTop: 2, fontSize: 14.5 },
    chips: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 16 },
    body: { padding: 18, gap: 22 },
    section: { gap: 12 },
    sectionHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
    sectionTitle: { fontSize: 16, fontWeight: '600', letterSpacing: -0.3, color: Brand.ink },
    infoCard: {
        borderRadius: 22,
        borderWidth: 1,
        borderColor: Brand.line,
        backgroundColor: Brand.card,
        paddingHorizontal: 14,
    },
    infoRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
    infoRowDivider: { borderBottomWidth: 1, borderBottomColor: Brand.line },
    infoIcon: {
        width: 38,
        height: 38,
        borderRadius: 12,
        backgroundColor: Brand.chipLight,
        alignItems: 'center',
        justifyContent: 'center',
    },
    infoText: { flex: 1, minWidth: 0 },
    infoLabel: { fontSize: 12.5, color: Brand.muted },
    infoValue: { fontSize: 15, fontWeight: '500', color: Brand.ink, marginTop: 1 },
    company: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        padding: 14,
        borderRadius: 22,
        borderWidth: 1,
        borderColor: Brand.line,
        backgroundColor: Brand.card,
    },
    companyLogo: {
        width: 46,
        height: 46,
        borderRadius: 16,
        backgroundColor: Brand.chipLight,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
    },
    companyLogoImage: { width: 36, height: 36 },
    companyText: { flex: 1, minWidth: 0 },
    companyCaption: { fontSize: 12.5, color: Brand.muted },
    companyName: { fontSize: 15, fontWeight: '600', letterSpacing: -0.2, color: Brand.ink, marginTop: 2 },
    logout: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        height: 50,
        borderRadius: 999,
        backgroundColor: Brand.clayLight,
    },
    logoutPressed: { backgroundColor: '#ecd0c5' },
    logoutText: { fontSize: 15, fontWeight: '500', color: Brand.clayInk },
});
