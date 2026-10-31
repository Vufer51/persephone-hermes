import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Buffer } from 'node:buffer';

const ALGORITHM = 'aes-256-gcm';
export const KEY_BYTES = 32;
export const FORMAT_VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;

const HEADER_BYTES = 2;
const MIN_PAYLOAD_BYTES = HEADER_BYTES + IV_BYTES + TAG_BYTES;

/**
 * Шифрует секрет алгоритмом AES-256-GCM.
 *
 * Формат результата:
 *   [formatVersion:1][keyVersion:1][iv:12][authTag:16][ciphertext:N]
 *
 * @param {string} plaintext
 * @param {Buffer} key 32 байта
 * @param {{ keyVersion?: number }} [options]
 * @returns {Buffer}
 */
export function encryptSecret(plaintext, key, { keyVersion = 1 } = {}) {
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    throw new TypeError('Секрет должен быть непустой строкой');
  }
  assertKey(key);
  assertKeyVersion(keyVersion);

  const header = Buffer.from([FORMAT_VERSION, keyVersion]);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(header);

  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([header, iv, authTag, ciphertext]);
}

/**
 * Расшифровывает секрет, созданный encryptSecret.
 *
 * @param {Buffer} payload
 * @param {Buffer} key 32 байта
 * @returns {string}
 */
export function decryptSecret(payload, key) {
  if (!Buffer.isBuffer(payload)) {
    throw new TypeError('Зашифрованный секрет должен быть Buffer');
  }
  if (payload.length < MIN_PAYLOAD_BYTES) {
    throw new Error('Зашифрованный секрет повреждён: слишком короткий payload');
  }
  assertKey(key);

  const formatVersion = payload[0];
  if (formatVersion !== FORMAT_VERSION) {
    throw new Error(`Неподдерживаемая версия формата секрета: ${formatVersion}`);
  }

  const header = payload.subarray(0, HEADER_BYTES);
  const iv = payload.subarray(HEADER_BYTES, HEADER_BYTES + IV_BYTES);
  const authTag = payload.subarray(HEADER_BYTES + IV_BYTES, MIN_PAYLOAD_BYTES);
  const ciphertext = payload.subarray(MIN_PAYLOAD_BYTES);

  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
  decipher.setAAD(header);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/**
 * Возвращает версию ключа, сохранённую вместе с секретом.
 * @param {Buffer} payload
 */
export function readSecretKeyVersion(payload) {
  if (!Buffer.isBuffer(payload) || payload.length < MIN_PAYLOAD_BYTES) {
    throw new Error('Зашифрованный секрет повреждён: слишком короткий payload');
  }
  return payload[1];
}

function assertKey(key) {
  if (!Buffer.isBuffer(key) || key.length !== KEY_BYTES) {
    throw new TypeError(`Ключ шифрования должен быть Buffer длиной ${KEY_BYTES} байт`);
  }
}

function assertKeyVersion(keyVersion) {
  if (!Number.isInteger(keyVersion) || keyVersion < 1 || keyVersion > 255) {
    throw new TypeError('Версия ключа шифрования должна быть целым числом 1..255');
  }
}
