import '@testing-library/jest-dom';
import { TextEncoder, TextDecoder } from 'text-encoding';

// Polyfill for TextEncoder/TextDecoder
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

// Mock crypto.subtle for encryption tests
global.crypto = {
  getRandomValues: (arr) => {
    for (let i = 0; i < arr.length; i++) {
      arr[i] = Math.floor(Math.random() * 256);
    }
    return arr;
  },
  subtle: {
    importKey: jest.fn(() => Promise.resolve({})),
    encrypt: jest.fn((params, key, data) => Promise.resolve(new ArrayBuffer(data.byteLength + 12))),
    decrypt: jest.fn((params, key, data) => Promise.resolve(new ArrayBuffer(data.byteLength - 12))),
  },
};

// Mock window.fetch
global.fetch = jest.fn();

// Mock localStorage
const localStorageMock = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
};
global.localStorage = localStorageMock;
