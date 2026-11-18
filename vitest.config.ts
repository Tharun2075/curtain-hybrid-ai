// Copyright 2026 Agri Group. Licensed under the Apache License, Version 2.0.
// Unit tests only. The Firestore rules check needs the emulator: `npm run test:rules`.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/rules/**', 'node_modules/**', 'dist/**'],
  },
});
