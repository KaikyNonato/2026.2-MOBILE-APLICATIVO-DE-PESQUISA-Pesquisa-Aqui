import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { useAuth } from '@/context/AuthContext';
import {
    authenticateWithBiometrics,
    isBiometricAvailable,
    isBiometricEnabled,
    setBiometricEnabled,
} from '@/lib/biometric';

/** Tempo fora do aplicativo a partir do qual ele volta bloqueado. Trocar de app por um instante não pede biometria. */
const LOCK_AFTER_MS = 30_000;

interface BiometricLockValue {
    /** O aparelho tem biometria cadastrada (o interruptor só aparece se tiver). */
    available: boolean;
    enabled: boolean;
    /** O aplicativo está bloqueado, esperando a biometria. */
    locked: boolean;
    /** Liga ou desliga. Para ligar, a biometria é confirmada antes. Devolve se ficou no estado pedido. */
    setEnabled: (enabled: boolean) => Promise<boolean>;
    /** Pede a biometria e, se confirmada, desbloqueia. */
    unlock: () => Promise<boolean>;
}

const BiometricLockContext = createContext<BiometricLockValue | null>(null);

export function BiometricLockProvider({ children }: { children: ReactNode }) {
    const { isAuthenticated, isLoading } = useAuth();
    const [available, setAvailable] = useState(false);
    const [enabled, setEnabledState] = useState(false);
    const [locked, setLocked] = useState(false);
    const started = useRef(false);
    const leftAt = useRef<number | null>(null);
    const prompting = useRef(false);

    // Lê a preferência na abertura do app e a cada entrada/saída de conta (sair apaga a preferência, em lib/auth).
    // Só na PRIMEIRA leitura o app já começa bloqueado: depois de um login novo ele nunca abre bloqueado.
    useEffect(() => {
        if (isLoading) return;
        let cancelled = false;
        (async () => {
            const [isAvailable, isEnabled] = await Promise.all([isBiometricAvailable(), isBiometricEnabled()]);
            if (cancelled) return;
            // Biometria apagada do aparelho depois de ligar: não trava a pessoa fora do app.
            const active = isEnabled && isAvailable;
            setAvailable(isAvailable);
            setEnabledState(active);
            if (!started.current) {
                started.current = true;
                setLocked(active && isAuthenticated);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [isLoading, isAuthenticated]);

    // Voltou depois de um tempo fora do app: bloqueia de novo.
    useEffect(() => {
        const subscription = AppState.addEventListener('change', (state) => {
            if (state === 'background') {
                leftAt.current = Date.now();
            } else if (state === 'active') {
                const away = leftAt.current === null ? 0 : Date.now() - leftAt.current;
                leftAt.current = null;
                // O próprio pedido de biometria tira o app do primeiro plano em alguns aparelhos: não conta.
                if (!prompting.current && enabled && isAuthenticated && away >= LOCK_AFTER_MS) setLocked(true);
            }
        });
        return () => subscription.remove();
    }, [enabled, isAuthenticated]);

    const unlock = useCallback(async () => {
        if (prompting.current) return false;
        prompting.current = true;
        try {
            const ok = await authenticateWithBiometrics('Confirme sua identidade para abrir o aplicativo');
            if (ok) setLocked(false);
            return ok;
        } finally {
            prompting.current = false;
        }
    }, []);

    const setEnabled = useCallback(async (next: boolean) => {
        if (next) {
            if (prompting.current) return false;
            prompting.current = true;
            try {
                const ok = await authenticateWithBiometrics('Confirme para ligar o desbloqueio por biometria');
                if (!ok) return false;
            } finally {
                prompting.current = false;
            }
        }
        await setBiometricEnabled(next);
        setEnabledState(next);
        if (!next) setLocked(false);
        return true;
    }, []);

    // Sem sessão aberta não há o que bloquear.
    const value = useMemo(
        () => ({ available, enabled: enabled && isAuthenticated, locked: locked && isAuthenticated, setEnabled, unlock }),
        [available, enabled, locked, isAuthenticated, setEnabled, unlock],
    );

    return <BiometricLockContext.Provider value={value}>{children}</BiometricLockContext.Provider>;
}

export function useBiometricLock() {
    const ctx = useContext(BiometricLockContext);
    if (!ctx) throw new Error('useBiometricLock deve ser usado dentro de BiometricLockProvider');
    return ctx;
}
