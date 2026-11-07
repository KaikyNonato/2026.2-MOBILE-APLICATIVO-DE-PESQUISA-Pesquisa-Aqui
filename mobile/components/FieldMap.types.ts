import type { Coordinate, TargetArea } from '@/lib/fieldMode';

export interface FieldMapRegion extends Coordinate {
    latitudeDelta: number;
    longitudeDelta: number;
}

export interface FieldMapMarker {
    key: string;
    coordinate: Coordinate;
    color: string;
    title: string;
}

export interface FieldMapProps {
    initialRegion: FieldMapRegion;
    area: TargetArea | null;
    markers: FieldMapMarker[];
}

export interface FieldMapHandle {
    animateToRegion: (region: FieldMapRegion, durationMs?: number) => void;
}
