import { describe, expect, it } from 'vitest';
import mongoose from 'mongoose';

describe('test environment', () => {
  it('connects to Mongo memory', async () => {
    expect(mongoose.connection.readyState).toBe(1);
    expect(mongoose.connection.db).toBeDefined();

    const result = await mongoose.connection.db!
      .collection('smoke_tests')
      .insertOne({ ok: true });

    expect(result.acknowledged).toBe(true);
  });
});
