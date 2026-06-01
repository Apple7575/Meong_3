export function cleanMessageBody(raw: string): string {
  return raw.trim();
}
export function isValidMessage(raw: string): boolean {
  return cleanMessageBody(raw).length > 0;
}
