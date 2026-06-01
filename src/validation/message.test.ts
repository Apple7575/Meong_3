import { cleanMessageBody, isValidMessage } from './message';

test('isValidMessage rejects empty/whitespace, accepts real text', () => {
  expect(isValidMessage('')).toBe(false);
  expect(isValidMessage('   ')).toBe(false);
  expect(isValidMessage('안녕하세요')).toBe(true);
});
test('cleanMessageBody trims', () => {
  expect(cleanMessageBody('  hi  ')).toBe('hi');
});
