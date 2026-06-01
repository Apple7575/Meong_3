import { isOnboardingComplete, normalizePhone, isValidPhone } from './profile';

describe('profile validation', () => {
  test('onboarding incomplete when nickname or phone missing', () => {
    expect(isOnboardingComplete({ nickname: null, phone: '01012345678' })).toBe(false);
    expect(isOnboardingComplete({ nickname: '철수', phone: null })).toBe(false);
    expect(isOnboardingComplete({ nickname: '철수', phone: '01012345678' })).toBe(true);
  });
  test('normalizePhone strips hyphens/spaces', () => {
    expect(normalizePhone('010-1234-5678')).toBe('01012345678');
    expect(normalizePhone('010 1234 5678')).toBe('01012345678');
  });
  test('isValidPhone accepts KR mobile, rejects junk', () => {
    expect(isValidPhone('010-1234-5678')).toBe(true);
    expect(isValidPhone('123')).toBe(false);
    expect(isValidPhone('')).toBe(false);
  });
});
