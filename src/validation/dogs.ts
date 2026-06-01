import { Gender } from '../types/db';

export type DogFormInput = {
  name: string; breed?: string; gender?: Gender;
  is_neutered?: boolean | null; features?: string; emergency_contact?: string;
};
const GENDERS: Gender[] = ['male', 'female', 'unknown'];

export function validateDogForm(input: DogFormInput): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!input.name?.trim()) errors.push('이름은 필수입니다.');
  if (input.gender && !GENDERS.includes(input.gender)) errors.push('성별 값이 올바르지 않습니다.');
  return { valid: errors.length === 0, errors };
}
