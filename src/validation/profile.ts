export function normalizePhone(raw: string): string {
  return raw.replace(/[\s-]/g, '');
}
export function isValidPhone(raw: string): boolean {
  const p = normalizePhone(raw);
  return /^01[016789]\d{7,8}$/.test(p);
}
export function isOnboardingComplete(p: { nickname: string | null; phone: string | null }): boolean {
  return !!p.nickname?.trim() && !!p.phone?.trim();
}
