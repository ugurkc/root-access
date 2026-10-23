import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VERSION } from '../model/core.mjs';
test('core module loads', () => { assert.equal(typeof VERSION, 'string'); });
