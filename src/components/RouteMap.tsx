import MapView, { Polyline, Marker } from 'react-native-maps';
import { StyleSheet, View } from 'react-native';
import { LatLng } from '../lib/geo';

type Props = { points: LatLng[] };
export function RouteMap({ points }: Props) {
  const center = points.length ? points[points.length - 1] : { lat: 37.6542, lng: 127.0568 }; // 노원 기본
  return (
    <View style={styles.fill}>
      <MapView
        style={styles.fill}
        region={{ latitude: center.lat, longitude: center.lng, latitudeDelta: 0.005, longitudeDelta: 0.005 }}
      >
        {points.length > 1 && (
          <Polyline coordinates={points.map((p) => ({ latitude: p.lat, longitude: p.lng }))} strokeColor="#7c3aed" strokeWidth={5} />
        )}
        {points.length > 0 && <Marker coordinate={{ latitude: center.lat, longitude: center.lng }} />}
      </MapView>
    </View>
  );
}
const styles = StyleSheet.create({ fill: { flex: 1 } });
