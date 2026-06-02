import { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, Alert, StyleSheet } from 'react-native';
import ClusteredMapView from 'react-native-map-clustering';
import MapView, { Marker, Region } from 'react-native-maps';
import { router } from 'expo-router';
import * as Location from 'expo-location';
import { reportsInBounds } from '../../src/services/neighborhoodMap';
import { NeighborhoodReport } from '../../src/types/db';

const NOWON = { latitude: 37.6542, longitude: 127.0568, latitudeDelta: 0.05, longitudeDelta: 0.05 };

export default function NeighborhoodMap() {
  const [reports, setReports] = useState<NeighborhoodReport[]>([]);
  const [recentOnly, setRecentOnly] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Cast to MapView (react-native-maps) because the clustering lib forwards the ref to the
  // inner MapView instance (forwardRef in JS), but its TS declaration is a class not forwardRef.
  const mapRef = useRef<MapView | null>(null);

  useEffect(() => {
    Location.getForegroundPermissionsAsync().then(async (p) => {
      if (!p.granted) return;
      const pos = await Location.getCurrentPositionAsync({});
      const region = { latitude: pos.coords.latitude, longitude: pos.coords.longitude, latitudeDelta: 0.05, longitudeDelta: 0.05 };
      mapRef.current?.animateToRegion(region, 500); // initialRegion is mount-only; animate to the real location
      fetchFor(region);
    });
  }, []);
  // clear the debounce timer on unmount so we don't setReports after leaving
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function fetchFor(region: Region) {
    const minLat = region.latitude - region.latitudeDelta / 2;
    const maxLat = region.latitude + region.latitudeDelta / 2;
    const minLng = region.longitude - region.longitudeDelta / 2;
    const maxLng = region.longitude + region.longitudeDelta / 2;
    reportsInBounds({ minLng, minLat, maxLng, maxLat }).then(setReports).catch((e: Error) => Alert.alert('오류', e.message));
  }
  function onRegionChange(region: Region) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => fetchFor(region), 400); // debounce viewport queries
  }
  useEffect(() => { fetchFor(NOWON); }, []); // initial load (geolocation effect re-fetches the real region)

  const cutoff = Date.now() - 3 * 24 * 3600 * 1000;
  const shown = recentOnly ? reports.filter((r) => Date.parse(r.last_seen_at) >= cutoff) : reports;

  return (
    <View style={styles.c}>
      <ClusteredMapView
        ref={mapRef as React.Ref<MapView>}
        style={{ flex: 1 }}
        initialRegion={NOWON}
        onRegionChangeComplete={onRegionChange}
      >
        {shown.map((r) => (
          <Marker key={r.id} coordinate={{ latitude: r.lat, longitude: r.lng }} title={r.dog_name ?? '실종견'}
            pinColor="#ef4444" onCalloutPress={() => router.push(`/(app)/report/${r.id}`)}
            onPress={() => router.push(`/(app)/report/${r.id}`)} />
        ))}
      </ClusteredMapView>
      <View style={styles.bar}>
        <Text style={styles.count}>활성 신고 {shown.length}건</Text>
        <Pressable style={[styles.filter, recentOnly && styles.filterOn]} onPress={() => setRecentOnly((v) => !v)}>
          <Text style={recentOnly ? styles.filterOnText : styles.filterText}>최근 3일</Text>
        </Pressable>
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  c: { flex: 1 },
  bar: { position: 'absolute', top: 48, left: 12, right: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  count: { backgroundColor: '#fff', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, fontWeight: '700', overflow: 'hidden' },
  filter: { backgroundColor: '#fff', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: '#cbd5e1' },
  filterOn: { backgroundColor: '#7c3aed', borderColor: '#7c3aed' },
  filterText: { color: '#334155', fontWeight: '700' }, filterOnText: { color: '#fff', fontWeight: '700' },
});
