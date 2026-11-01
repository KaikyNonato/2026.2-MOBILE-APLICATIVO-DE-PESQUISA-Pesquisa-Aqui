import React from 'react';
import { View, ActivityIndicator } from 'react-native';
import { Stack } from 'expo-router';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Brand } from '@/constants/brand';

function RootLayoutNav() {
    const { isAuthenticated, isLoading } = useAuth();

    if (isLoading) {
        return (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Brand.forest }}>
                <ActivityIndicator size="large" color={Brand.mint} />
            </View>
        );
    }

    // Se NÃO estiver logado, retorna apenas as telas públicas
    if (!isAuthenticated) {
        return (
            <Stack screenOptions={{ headerShown: false }}>
                <Stack.Screen name="index" />
                <Stack.Screen name="login" />
            </Stack>
        );
    }

    // Se ESTIVER logado, retorna apenas o grupo protegido com as abas
    return (
        <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(app)" options={{ gestureEnabled: false }} />
            {/* Entrevista em tela cheia, sem a barra de abas; o gesto de voltar fica desligado para não fechar a coleta por engano */}
            <Stack.Screen name="coleta/[researchId]" options={{ gestureEnabled: false }} />
            <Stack.Screen name="editar-perfil" />
            <Stack.Screen name="trocar-senha" options={{ gestureEnabled: false }} />
        </Stack>
    );
}

export default function RootLayout() {
    return (
        <AuthProvider>
            <SafeAreaProvider>
                <RootLayoutNav />
            </SafeAreaProvider>
        </AuthProvider>
    );
}