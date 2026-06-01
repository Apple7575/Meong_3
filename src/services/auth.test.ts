import { signInWithEmail, signUpWithEmail, signOut } from './auth';

const mockSignInWithPassword = jest.fn();
const mockSignUp = jest.fn();
const mockSignOutFn = jest.fn();
jest.mock('../lib/supabase', () => ({
  supabase: { auth: {
    signInWithPassword: (...a: any[]) => (mockSignInWithPassword as (...args: any[]) => any)(...a),
    signUp: (...a: any[]) => (mockSignUp as (...args: any[]) => any)(...a),
    signOut: (...a: any[]) => (mockSignOutFn as (...args: any[]) => any)(...a),
  } },
}));
beforeEach(() => jest.clearAllMocks());

test('signInWithEmail throws friendly error on invalid creds', async () => {
  mockSignInWithPassword.mockResolvedValueOnce({ error: { message: 'Invalid login credentials' } });
  await expect(signInWithEmail('a@b.com', 'x')).rejects.toThrow('이메일 또는 비밀번호가 올바르지 않습니다.');
});

test('signUpWithEmail passes email/password through', async () => {
  mockSignUp.mockResolvedValueOnce({ data: {}, error: null });
  await signUpWithEmail('a@b.com', 'password123');
  expect(mockSignUp).toHaveBeenCalledWith({ email: 'a@b.com', password: 'password123' });
});
