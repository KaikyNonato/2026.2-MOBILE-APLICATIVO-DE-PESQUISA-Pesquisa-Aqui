import { useEffect, useState } from "react";
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';

/** Diz se o aparelho está online, acompanhando as mudanças. */
export const useNetworkStatus = (): boolean => {
    const [isOnline, setIsOnline] = useState(true);

    useEffect(() => {
        const unsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
            setIsOnline(!!state.isConnected && state.isInternetReachable !== false);
        });

        return () => unsubscribe();
    }, []);

    return isOnline;
};

export default useNetworkStatus;
