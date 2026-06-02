import Constants from 'expo-constants';

export function flyerUrl(supabaseUrl: string, reportId: string): string {
  return `${supabaseUrl.replace(/\/$/, '')}/functions/v1/flyer?report=${reportId}`;
}
export function buildFlyerUrl(reportId: string): string {
  const base = (Constants.expoConfig?.extra?.supabaseUrl as string) ?? '';
  return flyerUrl(base, reportId);
}
export function shareMessage(dogName: string, url: string): string {
  return `우리 강아지 ${dogName}를 찾고 있어요 🐶 보신 분은 멍백홈으로 알려주세요!\n${url}`;
}
