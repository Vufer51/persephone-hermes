import { describe, it, expect } from 'vitest';
import { validateEmail, validatePassword, validateUsername } from './registration.js';

describe('registration validators', () => {
  describe('validateEmail', () => {
    it('возвращает error для пустого email', () => {
      const result = validateEmail('');
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('возвращает error для некорректного email', () => {
      const result = validateEmail('not-an-email');
      expect(result.valid).toBe(false);
    });

    it('возвращает error для слишком длинного email', () => {
      const result = validateEmail('a'.repeat(255) + '@test.com');
      expect(result.valid).toBe(false);
    });

    it('возвращает valid для корректного email', () => {
      const result = validateEmail('test@example.com');
      expect(result.valid).toBe(true);
    });

    it('принимает email с точками и плюсами', () => {
      const result = validateEmail('user.name+tag@example.com');
      expect(result.valid).toBe(true);
    });
  });

  describe('validatePassword', () => {
    it('возвращает error для пустого пароля', () => {
      const result = validatePassword('');
      expect(result.valid).toBe(false);
    });

    it('возвращает error для короткого пароля', () => {
      const result = validatePassword('short');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('не менее 8');
    });

    it('возвращает error для слишком длинного пароля', () => {
      const result = validatePassword('a'.repeat(129));
      expect(result.valid).toBe(false);
    });

    it('возвращает valid для пароля минимум 8 символов', () => {
      const result = validatePassword('12345678');
      expect(result.valid).toBe(true);
    });

    it('принимает пароль с спецсимволами', () => {
      const result = validatePassword('password123!@#');
      expect(result.valid).toBe(true);
    });
  });

  describe('validateUsername', () => {
    it('возвращает valid для пустого username', () => {
      const result = validateUsername('');
      expect(result.valid).toBe(true);
    });

    it('возвращает error для слишком короткого username', () => {
      const result = validateUsername('ab');
      expect(result.valid).toBe(false);
    });

    it('возвращает error для слишком длинного username', () => {
      const result = validateUsername('a'.repeat(65));
      expect(result.valid).toBe(false);
    });

    it('возвращает error для username с спецсимволами', () => {
      const result = validateUsername('user@name');
      expect(result.valid).toBe(false);
    });

    it('возвращает valid для корректного username', () => {
      const result = validateUsername('user_name123');
      expect(result.valid).toBe(true);
    });
  });
});
