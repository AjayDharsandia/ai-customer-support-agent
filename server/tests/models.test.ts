import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { createDatabase } from '../src/database/database.js';

const db = createDatabase('mongodb://unused.invalid/unit_test');
const pair = () => [
  { role: 'user', content: 'Hello', createdAt: new Date() },
  { role: 'assistant', content: 'Welcome', createdAt: new Date() },
];
describe('approved database model invariants', () => {
  it('normalizes user email, hides selected hashes and rejects plaintext storage', async () => {
    const user = new db.users({ email: ' A@EXAMPLE.COM ', passwordHash: 'plaintext' });
    expect(user.email).toBe('a@example.com');
    await expect(user.validate()).rejects.toThrow();
    expect(user.toObject()).not.toHaveProperty('passwordHash');
    expect(user.toJSON()).not.toHaveProperty('passwordHash');
  });
  it('supports ordered pairs with independent message IDs', async () => {
    const conversation = new db.conversations({ userId: new Types.ObjectId(), title: 'Hello', messages: pair() });
    await expect(conversation.validate()).resolves.toBeUndefined();
    expect(conversation.messages[0]?._id).not.toEqual(conversation.messages[1]?._id);
  });
  it.each([[], pair().slice(0, 1), pair().reverse(), Array.from({ length: 101 }, pair).flat()])('rejects incomplete, unordered or overflowing exchanges', async (messages) => {
    const conversation = new db.conversations({ userId: new Types.ObjectId(), title: 'Hello', messages });
    await expect(conversation.validate()).rejects.toThrow();
  });
  it('enforces title and role-specific Unicode content limits', async () => {
    for (const [title, messages] of [
      ['\u{1F600}'.repeat(81), pair()],
      ['Hello', [{ role: 'user', content: '\u{1F600}'.repeat(4001), createdAt: new Date() }, pair()[1]]],
      ['Hello', [pair()[0], { role: 'assistant', content: 'a'.repeat(16001), createdAt: new Date() }]],
    ] as const) {
      await expect(new db.conversations({ userId: new Types.ObjectId(), title, messages }).validate()).rejects.toThrow();
    }
  });
});
