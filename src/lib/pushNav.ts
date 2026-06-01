import { useEffect } from 'react';
import { router } from 'expo-router';
import messaging from '@react-native-firebase/messaging';

function routeFromData(data?: Record<string, string | object>) {
  if (data && (data as any).type === 'missing_report' && (data as any).report_id) {
    router.push(`/(app)/report/${(data as any).report_id}`);
  }
}

/** 알림 탭으로 앱이 열렸을 때(백그라운드/종료) 신고 상세로 딥링크. 앱 엔트리에서 1회 설치. */
export function usePushNavigation() {
  useEffect(() => {
    const unsub = messaging().onNotificationOpenedApp((m) => routeFromData(m?.data));
    messaging().getInitialNotification().then((m) => { if (m) routeFromData(m.data); });
    return unsub;
  }, []);
}
