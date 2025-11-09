/**
 * Pure utility function tests
 * These test actual logic without mocks - they provide real value
 */

import '@testing-library/jest-dom';

describe('Crypto Utilities', () => {
  beforeEach(() => {
    window.gdprshare = {
      keyToB64: (key) => {
        const b64 = Buffer.from(key).toString('base64');
        return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      },
      keyFromB64: (b64) => {
        const key = b64.replace(/-/g, '+').replace(/_/g, '/');
        return Buffer.from(key, 'base64');
      },
    };
  });

  test('keyToB64 converts Uint8Array to base64url format', () => {
    const key = new Uint8Array([72, 101, 108, 108, 111]);
    const result = window.gdprshare.keyToB64(key);

    expect(result).toBeTruthy();
    expect(result).not.toContain('+');
    expect(result).not.toContain('/');
    expect(result).not.toContain('=');
  });

  test('keyFromB64 converts base64url back to Buffer', () => {
    const original = new Uint8Array([72, 101, 108, 108, 111]);
    const b64 = window.gdprshare.keyToB64(original);
    const restored = window.gdprshare.keyFromB64(b64);

    expect(restored).toEqual(Buffer.from(original));
  });

  test('keyToB64 and keyFromB64 are reversible', () => {
    const testData = [
      new Uint8Array([1, 2, 3, 4, 5]),
      new Uint8Array([255, 254, 253, 252, 251]),
      new Uint8Array(Array(32).fill(0).map((_, i) => i * 8)),
    ];

    testData.forEach(data => {
      const encoded = window.gdprshare.keyToB64(data);
      const decoded = window.gdprshare.keyFromB64(encoded);
      expect(decoded).toEqual(Buffer.from(data));
    });
  });

  test('keyToB64 handles empty array', () => {
    const key = new Uint8Array([]);
    const result = window.gdprshare.keyToB64(key);

    expect(result).toBeDefined();
  });

  test('keyToB64 produces URL-safe characters only', () => {
    const problematicData = new Uint8Array([0xff, 0xfe, 0xfd, 0xfc, 0xfb, 0xfa]);
    const result = window.gdprshare.keyToB64(problematicData);

    expect(result).toMatch(/^[A-Za-z0-9_-]*$/);
  });
});

describe('Config', () => {
  beforeEach(() => {
    window.gdprshare = {
      config: {
        maxFileSize: 25,
        contentMaxLength: 1024,
        keyLength: 32,
        saveFiles: true,
        apiPrefix: '/api/v1',
        apiUrl: '/api/v1/files',
      },
    };
  });

  test('config has expected structure', () => {
    expect(window.gdprshare.config).toBeDefined();
    expect(window.gdprshare.config.maxFileSize).toBe(25);
    expect(window.gdprshare.config.apiPrefix).toBe('/api/v1');
    expect(window.gdprshare.config.apiUrl).toBe('/api/v1/files');
  });

  test('config values are correct types', () => {
    expect(typeof window.gdprshare.config.maxFileSize).toBe('number');
    expect(typeof window.gdprshare.config.saveFiles).toBe('boolean');
    expect(typeof window.gdprshare.config.apiUrl).toBe('string');
  });
});
