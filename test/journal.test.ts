import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FileJournal } from '../src-executor/journal.js';

test('an untouched disabled journal binds its first wallet, then rejects replacement', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'polyagent-journal-test-'));
  try {
    await new FileJournal(directory).load('');
    const wallet = '0x' + '2'.repeat(40);
    const journal = new FileJournal(directory);
    await journal.load(wallet);
    assert.equal(journal.data.wallet, wallet);
    await assert.rejects(new FileJournal(directory).load('0x' + '3'.repeat(40)), /another wallet/);
    const reopened = new FileJournal(directory);
    await reopened.load(wallet);
    assert.equal(reopened.data.wallet, wallet);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
