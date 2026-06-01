import { validateDogForm } from './dogs';

describe('dog form validation', () => {
  test('name is required', () => {
    expect(validateDogForm({ name: '' }).valid).toBe(false);
    expect(validateDogForm({ name: '  ' }).valid).toBe(false);
  });
  test('valid with just a name', () => {
    expect(validateDogForm({ name: '초코' }).valid).toBe(true);
  });
  test('rejects invalid gender', () => {
    const r = validateDogForm({ name: '초코', gender: 'cat' as any });
    expect(r.valid).toBe(false);
  });
});
