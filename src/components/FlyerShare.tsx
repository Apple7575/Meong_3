import { View, Text, Pressable, Share, StyleSheet } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { buildFlyerUrl, shareMessage } from '../services/flyer';

export function FlyerShare({ reportId, dogName }: { reportId: string; dogName: string }) {
  const url = buildFlyerUrl(reportId);
  return (
    <View style={styles.c}>
      <Text style={styles.h}>전단 공유</Text>
      <View style={styles.qr}><QRCode value={url} size={140} /></View>
      <Pressable style={styles.btn} onPress={() => Share.share({ message: shareMessage(dogName, url) })}>
        <Text style={styles.btnText}>링크 공유하기</Text>
      </Pressable>
    </View>
  );
}
const styles = StyleSheet.create({
  c: { alignItems: 'center', padding: 16, gap: 10 },
  h: { fontWeight: '800', fontSize: 16 },
  qr: { padding: 12, backgroundColor: '#fff', borderRadius: 12 },
  btn: { backgroundColor: '#7c3aed', paddingHorizontal: 20, padding: 12, borderRadius: 12 },
  btnText: { color: '#fff', fontWeight: '700' },
});
