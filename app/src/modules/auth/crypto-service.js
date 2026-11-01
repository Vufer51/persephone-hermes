import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

/**
 * Создаёт сервис симметричного шифрования (AES-256-GCM) для секретов.
 * @param {Buffer|string} masterKey — мастер-ключ (32 байта, base64 или Buffer)
 * @param {number} keyVersion — версия ключа
 * @returns {{ encrypt: Function, decrypt: Function }}
 */
export function createCryptoService(masterKey, keyVersion = 1) {
  const key = Buffer.isBuffer(masterKey) ? masterKey : Buffer.from(masterKey, 'base64');

  if (key.length !== KEY_LENGTH) {
    throw new Error(`Master key must be ${KEY_LENGTH} bytes (got ${key.length})`);
  }

  /**
   * Шифрует plaintext.
   * @param {string} plaintext
   * @returns {string} base64: iv + ciphertext + authTag
   */
  function encrypt(plaintext) {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    // Формат: version(1 byte) + iv + ciphertext + authTag
    const versionBuf = Buffer.alloc(1);
    versionBuf.writeUInt8(keyVersion, 0);

    return Buffer.concat([versionBuf, iv, ciphertext, authTag]).toString('base64');
  }

  /**
   * Расшифровывает ciphertext.
   * @param {string} encrypted — base64: version + iv + ciphertext + authTag
   * @param {number} expectedVersion — ожидаемая версия ключа
   * @returns {string|null} plaintext или null при ошибке
   */
  function decrypt(encrypted, expectedVersion = keyVersion) {
    try {
      const data = Buffer.from(encrypted, 'base64');
      if (data.length < 1 + IV_LENGTH + AUTH_TAG_LENGTH) {
        return null;
      }

      const version = data.readUInt8(0);
      if (version !== expectedVersion) {
        // Неподдерживаемая версия ключа
        return null;
      }

      const iv = data.subarray(1, 1 + IV_LENGTH);
      const authTag = data.subarray(data.length - AUTH_TAG_LENGTH);
      const ciphertext = data.subarray(1 + IV_LENGTH, data.length - AUTH_TAG_LENGTH);

      const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
      decipher.setAuthTag(authTag);

      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      return plaintext.toString('utf8');
    } catch {
      return null;
    }
  }

  return { encrypt, decrypt };
}