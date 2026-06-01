import Svg, { Polyline } from 'react-native-svg';

type Props = { coordinates: number[][]; size?: number };
// GeoJSON [lng,lat] 배열을 size×size 박스에 정규화해 그린다.
export function RouteThumbnail({ coordinates, size = 40 }: Props) {
  if (!coordinates || coordinates.length < 2) return <Svg width={size} height={size} />;
  const lngs = coordinates.map((c) => c[0]); const lats = coordinates.map((c) => c[1]);
  const minX = Math.min(...lngs), maxX = Math.max(...lngs), minY = Math.min(...lats), maxY = Math.max(...lats);
  const spanX = maxX - minX || 1e-6, spanY = maxY - minY || 1e-6;
  const pad = 4;
  const pts = coordinates.map((c) => {
    const x = pad + ((c[0] - minX) / spanX) * (size - 2 * pad);
    const y = size - pad - ((c[1] - minY) / spanY) * (size - 2 * pad); // y축 반전
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return (
    <Svg width={size} height={size}>
      <Polyline points={pts} fill="none" stroke="#7c3aed" strokeWidth={2} />
    </Svg>
  );
}
