import { forwardRef, useImperativeHandle, useRef } from 'react';
import { StyleSheet } from 'react-native';
import MapView, { Circle, Marker, PROVIDER_DEFAULT } from 'react-native-maps';
import { Brand } from '@/constants/brand';
import type { FieldMapHandle, FieldMapProps } from './FieldMap.types';

/** Mapa do modo campo (Android e iOS): área da pesquisa, posição atual e entrevistas do dia. */
const FieldMap = forwardRef<FieldMapHandle, FieldMapProps>(function FieldMap({ initialRegion, area, markers }, ref) {
    const mapRef = useRef<MapView>(null);

    useImperativeHandle(ref, () => ({
        animateToRegion: (region, durationMs = 400) => mapRef.current?.animateToRegion(region, durationMs),
    }));

    return (
        <MapView
            ref={mapRef}
            style={StyleSheet.flatten({ flex: 1 })}
            provider={PROVIDER_DEFAULT}
            initialRegion={initialRegion}
            showsUserLocation
            showsMyLocationButton={false}
            toolbarEnabled={false}
        >
            {area ? (
                <Circle
                    center={area.center}
                    radius={area.radiusMeters}
                    strokeColor={Brand.green}
                    fillColor="rgba(68, 119, 98, 0.14)"
                    strokeWidth={2}
                />
            ) : null}
            {markers.map((m) => (
                <Marker key={m.key} coordinate={m.coordinate} pinColor={m.color} title={m.title} />
            ))}
        </MapView>
    );
});

export default FieldMap;
