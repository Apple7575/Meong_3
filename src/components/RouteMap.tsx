import { StyleSheet, View } from 'react-native';
// NOTE: @react-native-kakao/map 2.2.7 exports only KakaoMapView — no polyline/marker overlay
// components exist in this version. Route shape is handled by RouteThumbnail (SVG).
// The map is centered on the last recorded point (or a default). Route polyline is NOT available;
// this is the marker fallback path — see commit message for details.
import { KakaoMapView } from '@react-native-kakao/map';
import { LatLng } from '../lib/geo';

type Props = { points: LatLng[] };
export function RouteMap({ points }: Props) {
  const center = points.length ? points[points.length - 1] : { lat: 37.6542, lng: 127.0568 }; // 노원 기본
  return (
    <View style={styles.fill}>
      <KakaoMapView
        style={styles.fill}
        initialCamera={{ lat: center.lat, lng: center.lng, zoomLevel: 3 }}
      />
    </View>
  );
}
const styles = StyleSheet.create({ fill: { flex: 1 } });
