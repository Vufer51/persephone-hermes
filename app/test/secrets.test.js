import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import {
  decryptSecret,
  encryptSecret,
  FORMAT_VERSION,
  readSecretKeyVersion,
} from '../src/utils/secrets.js';
import { TEST_ENCRYPTION_KEY } from './helpers/env.js';

const key = Buffer.from(TEST_ENCRYPTION_KEY, 'base64');

describe('AES-256-GCM шифрование секретов', () => {
  it('расшифровывает то, что зашифровал', () => {
    const payload = encryptSecret('lastfm-session-key-value', key);

    expect(Buffer.isBuffer(payload)).toBe(true);
    expect(decryptSecret(payload, key)).toBe('lastfm-session-key-value');
    expect(readSecretKeyVersion(payload)).toBe(1);
    expect(payload[0]).toBe(FORMAT_VERSION);
  });

  it('использует случайный IV для каждого вызова', () => {
    const first = encryptSecret('same-secret', key);
    const second = encryptSecret('same-secret', key);

    expect(first.equals(second)).toBe(false);
    expect(decryptSecret(first, key)).toBe('same-secret');
    expect(decryptSecret(second, key)).toBe('same-secret');
  });

  it('сохраняет версию ключа', () => {
    const payload = encryptSecret('secret', key, { keyVersion: 7 });

    expect(readSecretKeyVersion(payload)).toBe(7);
    expect(decryptSecret(payload, key)).toBe('secret');
  });

  it('не расшифровывает чужим ключом', () => {
    const payload = encryptSecret('secret', key);
    const otherKey = Buffer.alloc(32, 9);

    expect(() => decryptSecret(payload, otherKey)).toThrow();
  });

  it('обнаруживает повреждение ciphertext, IV, tag и заголовка', () => {
    const payload = encryptSecret('secret', key);

    for (const offset of [0, 1, 3, 20, payload.length - 1]) {
      const tampered = Buffer.from(payload);
      tampered[offset] ^= 0xff;
      expect(() => decryptSecret(tampered, key), `смещение ${offset}`).toThrow();
    }
  });

  it('отклоняет некорректный ключ', () => {
    expect(() => encryptSecret('secret', Buffer.alloc(16, 1))).toThrow(/32 байт/);
  });

  it('отклоняет пустой секрет', () => {
    expect(() => encryptSecret('', key)).toThrow(TypeError);
  });

  it('отклоняет слишком короткий payload', () => {
    expect(() => decryptSecret(Buffer.from([1, 1, 2, 3]), key)).toThrow(/повреждён/);
  });

  it('отклоняет неизвестную версию формата', () => {
    const payload = encryptSecret('secret', key);
    payload[0] = 99;

    expect(() => decryptSecret(payload, key)).toThrow(/версия формата/);
  });
});
