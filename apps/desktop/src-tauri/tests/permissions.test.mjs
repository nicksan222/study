import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('every registered native adapter command is granted to the production main window',()=>{
  const source=readFileSync(new URL('../src/lib.rs',import.meta.url),'utf8');
  const registered=source.match(/generate_handler!\[([\s\S]*?)\]/)[1].split(',').map(command=>command.trim().split('::').at(-1)).filter(Boolean);
  const permissions=readFileSync(new URL('../permissions/desktop.toml',import.meta.url),'utf8');
  const grants=new Map([...permissions.matchAll(/identifier\s*=\s*"([^"]+)"\s+commands.allow\s*=\s*\[([^\]]*)\]/g)].map(([,id,commands])=>[id,[...commands.matchAll(/"([^"]+)"/g)].map(([,command])=>command)]));
  const capability=JSON.parse(readFileSync(new URL('../capabilities/default.json',import.meta.url),'utf8'));
  assert.ok(capability.windows.includes('main'));
  const allowed=new Set(capability.permissions.flatMap(id=>grants.get(id)??[]));
  assert.deepEqual(registered.filter(command=>!allowed.has(command)),[], 'registered adapters must have an explicit enabled production capability');
});

test('the complete recording actor command set is registered and used by its frontend consumer',()=>{
  const source=readFileSync(new URL('../src/lib.rs',import.meta.url),'utf8');
  const client=readFileSync(new URL('../../src/rpc/native.ts',import.meta.url),'utf8');
  const registered=new Set([...source.matchAll(/audio::(recording_\w+)/g)].map(([,command])=>command));
  const consumed=new Set([...client.matchAll(/recordingCommand\(\s*"(recording_\w+)"/g)].map(([,command])=>command));
  const expected=['recording_ack','recording_discard','recording_send','recording_start','recording_status','recording_stop'];
  assert.deepEqual([...registered].sort(),expected);
  assert.deepEqual([...consumed].sort(),expected);
});
