import { useEffect } from 'react';
import { Platform } from 'react-native';
import * as Location from 'expo-location';
import messaging from '@react-native-firebase/messaging';
import { registerPushToken } from '../services/push';
import { upsertMyLocation } from '../services/location';

/** 로그인+온보딩 완료 후 1회 실행: 푸시 토큰 등록 + 위치 적재. 실패해도 앱은 진행. */
export function useBootstrapPermissions(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    (async () => {
      try {
        await messaging().registerDeviceForRemoteMessages();
        const authStatus = await messaging().requestPermission();
        const granted =
          authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
          authStatus === messaging.AuthorizationStatus.PROVISIONAL;
        if (granted) {
          const token = await messaging().getToken();
          await registerPushToken(token, Platform.OS === 'ios' ? 'ios' : 'android');
          messaging().onTokenRefresh((t) =>
            registerPushToken(t, Platform.OS === 'ios' ? 'ios' : 'android').catch(() => {}),
          );
        }
      } catch { /* 푸시 실패는 무시, 나중에 설정에서 재시도 */ }

      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const pos = await Location.getCurrentPositionAsync({});
          await upsertMyLocation(pos.coords.latitude, pos.coords.longitude);
        }
      } catch { /* 위치 실패는 무시 */ }
    })();
  }, [enabled]);
}
