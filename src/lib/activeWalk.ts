import { WalkSession } from './walkSession';
import { asyncStorageAdapter } from './walkStorage';

// 앱 전역에서 단 하나의 산책 세션. 백그라운드 태스크·모든 화면·복구가 이 인스턴스를 공유한다.
export const walkSession = new WalkSession(asyncStorageAdapter);
