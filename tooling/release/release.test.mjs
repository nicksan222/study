import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { preparePlatform, assembleRelease, validateConfig, PLATFORMS } from './release.mjs';

async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), 'study-release-test-'));
  try {
    execFileSync('minisign', ['-G','-W','-p',join(root,'public'),'-s',join(root,'secret')], {stdio:'ignore'});
    const publicKey = (await readFile(join(root,'public'))).toString('base64');
    const manifests = [];
    for (const [platform, formats] of Object.entries(PLATFORMS)) {
      const directory = join(root, platform); await mkdir(directory);
      const installer = join(directory, `Study_0.1.1${formats.installer}`);
      const update = formats.update === formats.installer ? installer : join(directory, `Study_0.1.1${formats.update}`);
      await writeFile(installer, `installer ${platform}`);
      if (update !== installer) await writeFile(update, `updater ${platform}`);
      execFileSync('minisign', ['-S','-s',join(root,'secret'),'-m',update,'-x',`${update}.sig`], {stdio:'ignore'});
      manifests.push(await preparePlatform({platform,version:'0.1.1',paths:[installer,update,`${update}.sig`],output:join(root,`stage-${platform}`)}));
    }
    await fn({root,publicKey,manifests});
  } finally { await rm(root,{recursive:true,force:true}); }
}

test('one assembly preserves every stable download name and all four verified updater platforms', () => fixture(async ({root,publicKey,manifests}) => {
  const feed = await assembleRelease({manifests,version:'0.1.1',repository:'nicksan222/study',tag:'v0.1.1',publicKey,output:join(root,'final')});
  assert.deepEqual(Object.keys(feed.platforms).sort(), ['darwin-aarch64','linux-aarch64','linux-x86_64','windows-x86_64']);
  for (const [platform,formats] of Object.entries(PLATFORMS)) {
    assert.ok((await readFile(join(root,'final',`study-${platform}${formats.installer}`))).length);
    const entry = feed.platforms[formats.updaterPlatform];
    assert.equal(entry.url,`https://github.com/nicksan222/study/releases/download/v0.1.1/study-${platform}${formats.update}`);
    assert.ok(Buffer.from(entry.signature,'base64').toString().startsWith('untrusted comment:'));
  }
}));

test('assembly refuses a missing platform, mixed version, duplicate platform and mismatched release tag', () => fixture(async ({root,publicKey,manifests}) => {
  const options = {manifests,version:'0.1.1',repository:'nicksan222/study',tag:'v0.1.1',publicKey,output:join(root,'final')};
  await assert.rejects(assembleRelease({...options,manifests:manifests.slice(1)}), /platform/i);
  await assert.rejects(assembleRelease({...options,manifests:[...manifests,manifests[0]]}), /duplicate/i);
  await assert.rejects(assembleRelease({...options,version:'0.1.2',tag:'v0.1.2'}), /version/i);
  await assert.rejects(assembleRelease({...options,tag:'v0.1.2'}), /tag/i);
}));

test('tampering and a different signing key prevent feed publication', () => fixture(async ({root,publicKey,manifests}) => {
  execFileSync('minisign',['-G','-W','-p',join(root,'other-public'),'-s',join(root,'other-secret')],{stdio:'ignore'});
  const otherKey=(await readFile(join(root,'other-public'))).toString('base64');
  await assert.rejects(assembleRelease({manifests,version:'0.1.1',repository:'nicksan222/study',tag:'v0.1.1',publicKey:otherKey,output:join(root,'wrong-key')}), /signature/i);
  const manifest = JSON.parse(await readFile(manifests[0],'utf8'));
  const source = join(root,'stage-linux-x86_64',manifest.update);
  await writeFile(source,'tampered update');
  const options = {manifests,version:'0.1.1',repository:'nicksan222/study',tag:'v0.1.1',publicKey,output:join(root,'final')};
  await assert.rejects(assembleRelease(options), /integrity|digest|size/i);
  // The signature is checked too, independently of the transport manifest's hash.
  const {createHash} = await import('node:crypto');
  const record = manifest.files.find(file=>file.name===manifest.update);
  record.size=15; record.sha256=createHash('sha256').update('tampered update').digest('hex');
  await writeFile(manifests[0],JSON.stringify(manifest));
  await assert.rejects(assembleRelease(options), /signature/i);
}));

test('a platform cannot be prepared without its signed updater or with ambiguous installers', async () => {
  const root=await mkdtemp(join(tmpdir(),'study-release-missing-'));
  try {
    const installer=join(root,'Study.exe');await writeFile(installer,'installer');
    await assert.rejects(preparePlatform({platform:'windows-x86_64',version:'0.1.1',paths:[installer],output:join(root,'stage')}), /signature/i);
    const second=join(root,'Other.exe');await writeFile(second,'other');
    await assert.rejects(preparePlatform({platform:'windows-x86_64',version:'0.1.1',paths:[installer,second],output:join(root,'stage')}), /ambiguous/i);
  } finally {await rm(root,{recursive:true,force:true});}
});

test('the native bundle and website agree on stable signed download formats', async () => {
  const config=JSON.parse(await readFile(new URL('../../apps/desktop/src-tauri/tauri.conf.json',import.meta.url),'utf8'));
  const workspace=(await readFile(new URL('../../Cargo.toml',import.meta.url),'utf8')).match(/^version = "([^"]+)"$/m)[1];
  validateConfig(workspace,config);
  const site=await readFile(new URL('../../apps/landing/src/i18n/strings.ts',import.meta.url),'utf8');
  for(const [platform,formats] of Object.entries(PLATFORMS)) assert.ok(site.includes(`study-${platform}${formats.installer}`));
  assert.throws(()=>validateConfig('999.0.0',config),/version/);
  assert.throws(()=>validateConfig(workspace,{...config,bundle:{...config.bundle,targets:['msi']}}),/NSIS/);
});

test('release builds require an effective canonical key and normalize optional Apple credentials', () => fixture(async ({publicKey}) => {
  const { releaseConfig, appleEnvironment } = await import('./release.mjs');
  const config=JSON.parse(await readFile(new URL('../../apps/desktop/src-tauri/tauri.conf.json',import.meta.url),'utf8'));
  assert.throws(()=>validateConfig('0.1.1',config,{publicKey}), /key/i);
  const effective=releaseConfig(config,{publicKey,endpoint:'https://github.com/example/study/releases/latest/download/latest.json'});
  validateConfig('0.1.1',effective,{publicKey});
  assert.equal(effective.plugins.updater.pubkey,publicKey);
  assert.deepEqual(effective.plugins.updater.endpoints,['https://github.com/example/study/releases/latest/download/latest.json']);
  assert.throws(()=>releaseConfig(config,{publicKey:Buffer.from(publicKey,'base64').toString()}),/encoded/i);
  assert.throws(()=>validateConfig('0.1.1',effective,{publicKey:publicKey+'wrong'}),/key/i);
  const unsigned=releaseConfig(config,{unsigned:true});
  assert.equal(unsigned.bundle.createUpdaterArtifacts,false);
  assert.equal(unsigned.plugins.updater.pubkey,'');
  const empty={APPLE_SIGNING_IDENTITY:'',APPLE_CERTIFICATE:'',APPLE_CERTIFICATE_PASSWORD:'',APPLE_ID:'',APPLE_PASSWORD:'',APPLE_TEAM_ID:''};
  assert.deepEqual(appleEnvironment(empty),{APPLE_SIGNING_IDENTITY:'-'});
  assert.deepEqual(appleEnvironment({...empty,APPLE_CERTIFICATE:'certificate'}),{APPLE_CERTIFICATE:'certificate',APPLE_CERTIFICATE_PASSWORD:''});
  assert.deepEqual(appleEnvironment({...empty,APPLE_SIGNING_IDENTITY:'Developer ID',APPLE_CERTIFICATE:'certificate',APPLE_CERTIFICATE_PASSWORD:'password'}),{APPLE_SIGNING_IDENTITY:'Developer ID',APPLE_CERTIFICATE:'certificate',APPLE_CERTIFICATE_PASSWORD:'password'});
}));

test('inherited property platform names cannot create an incomplete update feed', () => fixture(async ({root,publicKey,manifests}) => {
  for(const platform of ['constructor','toString','__proto__']) {
    const path=manifests[1];
    const manifest=JSON.parse(await readFile(path,'utf8'));
    manifest.platform=platform;
    await writeFile(path,JSON.stringify(manifest));
    const output=join(root,`bad-${platform}`);
    await assert.rejects(assembleRelease({manifests,version:'0.1.1',repository:'nicksan222/study',tag:'v0.1.1',publicKey,output}), /unknown.*platform/i);
    await assert.rejects(readFile(join(output,'latest.json')),/ENOENT/);
  }
}));

test('base and effective macOS bundles retain audio entitlement and microphone privacy metadata', () => fixture(async ({publicKey})=>{
  const {releaseConfig,validateMacosMetadata}=await import('./release.mjs');
  const root=new URL('../../apps/desktop/src-tauri/',import.meta.url);
  const config=JSON.parse(await readFile(new URL('tauri.conf.json',root),'utf8'));
  assert.equal(typeof config.bundle.macOS.entitlements,'string');
  assert.equal(config.bundle.macOS.minimumSystemVersion,'12.0');
  const effective=releaseConfig(config,{publicKey});
  assert.equal(effective.bundle.macOS.entitlements,config.bundle.macOS.entitlements);
  const entitlements=await readFile(new URL(effective.bundle.macOS.entitlements,root));
  const info=await readFile(new URL(effective.bundle.macOS.infoPlist,root));
  validateMacosMetadata(entitlements,info);
  assert.throws(()=>validateMacosMetadata(Buffer.from(entitlements.toString().replace('<true/>','<false/>')),info),/microphone/i);
  assert.throws(()=>validateMacosMetadata(entitlements,Buffer.from('<?xml version="1.0"?><plist version="1.0"><dict/></plist>')),/microphone/i);
}));
