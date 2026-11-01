import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, generateToken, hashToken } from './crypto.js';

describe('crypto', () => {
  describe('hashPassword', () => {
    it('хэширует пароль и возвращает строку', async () => {
      const password = 'test_password_123';
      const hash = await hashPassword(password);
      expect(typeof hash).toBe('string');
      expect(hash).not.toBe(password);
    });

    it('создаёт уникальный хеш для одинаковых паролей', async () => {
      const password = 'test_password_123';
      const hash1 = await hashPassword(password);
      const hash2 = await hashPassword(password);
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('verifyPassword', () => {
    it('возвращает true для правильного пароля', async () => {
      const password = 'test_password_123';
      const hash = await hashPassword(password);
      const result = await verifyPassword(password, hash);
      expect(result).toBe(true);
    });

    it('возвращает false для неправильного пароля', async () => {
      const correctPassword = 'correct_password';
      const wrongPassword = 'wrong_password';
      const hash = await hashPassword(correctPassword);
      const result = await verifyPassword(wrongPassword, hash);
      expect(result).toBe(false);
    });
  });

  describe('generateToken', () => {
    it('генерирует токен длиной 44 символа (32 байта в base64)', () => {
      const token = generateToken();
      expect(token).toHaveLength(44);
    });

    it('генерирует уникальные токены', () => {
      const token1 = generateToken();
      const token2 = generateToken();
      expect(token1).not.toBe(token2);
    });
  });

  describe('hashToken', () => {
    it('хеширует токен и возвращает hex-строку', () => {
      const token = 'test_token_123';
      const hashed = hashToken(token);
      expect(typeof hashed).toBe('string');
      expect(hashed).toHaveLength(64); // SHA-256 в hex
    });

    it('создаёт одинаковый хеш для одинакового токена', () => {
      const token = 'test_token_123';
      const hash1 = hashToken(token);
      const hash2 = hashToken(token);
      expect(hash1).toBe(hash2);
    });

    it('создаёт разный хеш для разных токенов', () => {
      const token1 = 'token_123';
      const token2 = 'token_456';
      const hash1 = hashToken(token1);
      const hash2 = hashToken(token2);
      expect(hash1).not.toBe(hash2);
    });
  });
});
