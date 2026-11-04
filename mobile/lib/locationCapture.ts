import * as Location from 'expo-location';
import { buildLocationAnswer, type LocationAnswerValue } from './questionTypes';

// Captura da coordenada para a questão de localização.
// Só usa o GPS do aparelho: não faz nenhuma chamada de rede, então funciona sem internet e em modo avião.

/** Quanto esperar o GPS responder antes de desistir (ao ar livre costuma levar poucos segundos). */
const GPS_TIMEOUT_MS = 20000;

/** Se o GPS não responder a tempo, aceita a última posição do aparelho, desde que seja recente. */
const LAST_KNOWN_MAX_AGE_MS = 60000;

export type LocationCaptureResult =
    | { status: 'ok'; location: LocationAnswerValue }
    // Permissão negada. canAskAgain=false: o aparelho não pergunta mais, só as configurações liberam.
    | { status: 'denied'; canAskAgain: boolean }
    // Permissão dada, mas o GPS (serviço de localização) do aparelho está desligado.
    | { status: 'services-off' }
    // Sem sinal do GPS a tempo, ou erro ao ler.
    | { status: 'unavailable' };

/** Marcador devolvido quando a espera estoura o tempo. */
const TIMED_OUT = Symbol('timeout');

/** Espera a promessa, mas devolve `TIMED_OUT` se passar de `ms`. */
function raceTimeout<T>(promise: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve(TIMED_OUT), ms);
        promise.then(
            (value) => {
                clearTimeout(timer);
                resolve(value);
            },
            (error) => {
                clearTimeout(timer);
                reject(error);
            },
        );
    });
}

/**
 * Lê latitude, longitude e a precisão informada pelo aparelho. Nunca lança erro: o que deu errado
 * volta como status, para a tela explicar ao pesquisador o que fazer sem derrubar o app.
 * A marcação de baixa precisão sai da precisão lida (ver LOW_ACCURACY_THRESHOLD_METERS).
 */
export async function captureLocationAnswer(): Promise<LocationCaptureResult> {
    try {
        let permission = await Location.getForegroundPermissionsAsync();
        if (!permission.granted && permission.canAskAgain) {
            permission = await Location.requestForegroundPermissionsAsync();
        }
        if (!permission.granted) return { status: 'denied', canAskAgain: permission.canAskAgain };

        if (!(await Location.hasServicesEnabledAsync())) return { status: 'services-off' };

        let position: Location.LocationObject | null = null;
        try {
            const result = await raceTimeout(
                Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
                GPS_TIMEOUT_MS,
            );
            position = result === TIMED_OUT ? null : result;
        } catch {
            position = null;
        }

        if (!position) {
            position = await Location.getLastKnownPositionAsync({ maxAge: LAST_KNOWN_MAX_AGE_MS }).catch(() => null);
        }
        if (!position) return { status: 'unavailable' };

        return {
            status: 'ok',
            location: buildLocationAnswer({
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
                accuracy: position.coords.accuracy,
                capturedAt: new Date(position.timestamp).toISOString(),
            }),
        };
    } catch {
        return { status: 'unavailable' };
    }
}
