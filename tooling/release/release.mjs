import { readFile, writeFile, mkdir, copyFile, readdir, lstat, mkdtemp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { resolve, dirname, basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

export const PLATFORMS = {
  'linux-x86_64': {installer:'.AppImage',update:'.AppImage',updaterPlatform:'linux-x86_64'},
  'linux-aarch64': {installer:'.AppImage',update:'.AppImage',updaterPlatform:'linux-aarch64'},
  'macos-aarch64': {installer:'.dmg',update:'.app.tar.gz',updaterPlatform:'darwin-aarch64'},
  'windows-x86_64': {installer:'.exe',update:'.exe',updaterPlatform:'windows-x86_64'},
};

function versioned(version) {
  if (!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(version)) throw new Error('invalid release version');
}
function formatsFor(platform) {
  const formats=Object.hasOwn(PLATFORMS,platform) && PLATFORMS[platform];
  if (!formats) throw new Error(`unknown release platform: ${platform}`);
  return formats;
}
async function record(path,name) {
  const metadata=await lstat(path);
  if (!metadata.isFile() || !metadata.size) throw new Error(`release artifact is not a nonempty regular file: ${name}`);
  const bytes=await readFile(path);
  return {name,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
}
function one(paths,extension,kind) {
  const matching=[...new Set(paths)].filter(path=>path.endsWith(extension));
  if (matching.length!==1) throw new Error(`${matching.length?'ambiguous':'missing'} ${kind} ${extension}`);
  return matching[0];
}
/** A build job only prepares local artifacts; it never modifies shared release metadata. */
export async function preparePlatform({platform,version,paths,output}) {
  versioned(version);
  const formats=formatsFor(platform);
  if (!Array.isArray(paths) || paths.some(path=>typeof path!=='string')) throw new Error('artifact paths must be strings');
  const installer=one(paths,formats.installer,'installer');
  const update=one(paths,formats.update,'updater');
  const signature=one(paths,`${formats.update}.sig`,'signature');
  if (resolve(signature)!==resolve(`${update}.sig`)) throw new Error('signature must belong to the selected updater');
  const sources=new Map([
    [`study-${platform}${formats.installer}`,installer],
    [`study-${platform}${formats.update}`,update],
    [`study-${platform}${formats.update}.sig`,signature],
  ]);
  const files=[];
  for (const [name,path] of sources) files.push(await record(path,name));
  await mkdir(output,{recursive:true});
  for (const [name,path] of sources) await copyFile(path,join(output,name));
  const manifest={schemaVersion:1,platform,version,installer:`study-${platform}${formats.installer}`,update:`study-${platform}${formats.update}`,signature:`study-${platform}${formats.update}.sig`,files};
  const path=join(output,'manifest.json');
  await writeFile(path,JSON.stringify(manifest,null,2)+'\n');
  return path;
}
function minisignText(value) {
  const text=value.trim();
  return text.startsWith('untrusted comment:') ? text+'\n' : Buffer.from(text,'base64').toString('utf8');
}
async function verifiedSignature(update,signature,publicKey) {
  const temporary=await mkdtemp(join(tmpdir(),'study-verify-update-'));
  try {
    const publicFile=join(temporary,'public');
    const signatureFile=join(temporary,'signature');
    const decoded=minisignText(await readFile(signature,'utf8'));
    await writeFile(publicFile,minisignText(publicKey));
    await writeFile(signatureFile,decoded);
    try { execFileSync('minisign',['-V','-m',update,'-p',publicFile,'-x',signatureFile],{stdio:'pipe'}); }
    catch { throw new Error(`invalid updater signature: ${basename(update)}`); }
    return Buffer.from(decoded).toString('base64');
  } finally { await rm(temporary,{recursive:true,force:true}); }
}
/** The only feed writer runs after every platform build. Fail before publishing a partial set. */
export async function assembleRelease({manifests,version,repository,tag,publicKey,output,date=new Date().toISOString()}) {
  versioned(version);
  if(tag!==`v${version}`) throw new Error('release tag does not match version');
  if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('invalid release repository');
  if(!publicKey?.trim()) throw new Error('release signature public key is required');
  const found=new Set();
  const copies=[];
  const platforms={};
  for(const path of manifests) {
    const manifest=JSON.parse(await readFile(path,'utf8'));
    const formats=formatsFor(manifest.platform);
    if(found.has(manifest.platform)) throw new Error(`duplicate platform: ${manifest.platform}`);
    found.add(manifest.platform);
    if(manifest.schemaVersion!==1 || manifest.version!==version) throw new Error('release manifest version mismatch');
    const expected=new Set([`study-${manifest.platform}${formats.installer}`,`study-${manifest.platform}${formats.update}`,`study-${manifest.platform}${formats.update}.sig`]);
    if(manifest.installer!==`study-${manifest.platform}${formats.installer}` || manifest.update!==`study-${manifest.platform}${formats.update}` || manifest.signature!==`${manifest.update}.sig`) throw new Error('release artifact name contract mismatch');
    if(!Array.isArray(manifest.files)||manifest.files.length!==expected.size) throw new Error('release artifact set mismatch');
    for(const file of manifest.files) {
      if(!expected.delete(file.name)) throw new Error('unexpected or duplicate release artifact');
      const source=join(dirname(path),file.name);
      const actual=await record(source,file.name);
      if(actual.size!==file.size || actual.sha256!==file.sha256) throw new Error(`release artifact integrity mismatch: ${file.name}`);
      copies.push([source,file.name]);
    }
    const signature=await verifiedSignature(join(dirname(path),manifest.update),join(dirname(path),manifest.signature),publicKey);
    platforms[formats.updaterPlatform]={signature,url:`https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(manifest.update)}`};
  }
  if(found.size!==Object.keys(PLATFORMS).length || Object.keys(PLATFORMS).some(platform=>!found.has(platform))) throw new Error('release is missing required platforms');
  const feed={version,notes:`Study ${version}`,pub_date:date,platforms};
  await mkdir(output,{recursive:true});
  for(const [source,name] of copies) await copyFile(source,join(output,name));
  await writeFile(join(output,'latest.json'),JSON.stringify(feed,null,2)+'\n');
  return feed;
}
export function validateConfig(version,config,{publicKey}={}) {
  versioned(version);
  if(config.version!==version) throw new Error('native configuration version does not match workspace');
  if(!config.bundle?.targets?.includes('nsis')) throw new Error('Windows stable .exe download requires the NSIS installer');
  if(!config.bundle.macOS?.entitlements) throw new Error('macOS microphone entitlement configuration is required');
  if(config.bundle.createUpdaterArtifacts!==true) throw new Error('signed updater artifacts must be enabled');
  if(publicKey!==undefined && (!publicKey || config.plugins?.updater?.pubkey!==publicKey)) throw new Error('effective bundler public key differs from release verification key');
}

/** One effective configuration is consumed by the CLI, embedded app and feed verifier. */
export function releaseConfig(config,{publicKey,endpoint,unsigned=false}={}) {
  if(!unsigned) {
    if(!publicKey || !/^[A-Za-z0-9+/]+={0,2}$/.test(publicKey) || !Buffer.from(publicKey,'base64').toString().startsWith('untrusted comment:')) throw new Error('Tauri base64 encoded public key is required');
    const url=new URL(endpoint ?? config.plugins.updater.endpoints[0]);
    if(url.protocol!=='https:') throw new Error('release updater endpoint must use HTTPS');
    endpoint=url.href;
  }
  return {...config,bundle:{...config.bundle,createUpdaterArtifacts:!unsigned},plugins:{...config.plugins,updater:{...config.plugins.updater,pubkey:unsigned?'':publicKey,...(endpoint?{endpoints:[endpoint]}:{})}}};
}
export const APPLE_VARIABLES=['APPLE_SIGNING_IDENTITY','APPLE_CERTIFICATE','APPLE_CERTIFICATE_PASSWORD','APPLE_ID','APPLE_PASSWORD','APPLE_TEAM_ID'];
/** Empty optional secrets must be absent, except a supplied certificate may have an empty password. */
export function appleEnvironment(environment) {
  const selected={};
  for(const name of APPLE_VARIABLES) if(environment[name]?.trim()) selected[name]=environment[name];
  if(selected.APPLE_CERTIFICATE) selected.APPLE_CERTIFICATE_PASSWORD=environment.APPLE_CERTIFICATE_PASSWORD??'';
  else delete selected.APPLE_CERTIFICATE_PASSWORD;
  // A credential-free Apple Silicon bundle still needs ad-hoc signing to embed
  // its audio entitlement. With a certificate, let Tauri infer its real identity.
  if(!selected.APPLE_CERTIFICATE && !selected.APPLE_SIGNING_IDENTITY) selected.APPLE_SIGNING_IDENTITY='-';
  return selected;
}
async function configuredFile(version,output,unsigned) {
  const base=JSON.parse(await readFile(new URL('../../apps/desktop/src-tauri/tauri.conf.json',import.meta.url),'utf8'));
  const config=releaseConfig(base,{publicKey:process.env.STUDY_UPDATE_PUBLIC_KEY,endpoint:process.env.STUDY_UPDATE_ENDPOINT,unsigned});
  if(!unsigned) validateConfig(version,config,{publicKey:process.env.STUDY_UPDATE_PUBLIC_KEY});
  await mkdir(dirname(output),{recursive:true});
  await writeFile(output,JSON.stringify(config,null,2)+'\n');
  return resolve(output).replaceAll('\\','/');
}

/** Check actual signed-bundle metadata as well as source configuration. */
export function validateMacosMetadata(entitlements,info) {
  const script=`import base64,json,plistlib,sys
payload=json.load(sys.stdin)
entitlements=plistlib.loads(base64.b64decode(payload["entitlements"]))
info=plistlib.loads(base64.b64decode(payload["info"]))
assert entitlements.get("com.apple.security.device.audio-input") is True
assert isinstance(info.get("NSMicrophoneUsageDescription"),str) and info["NSMicrophoneUsageDescription"].strip()
`;
  try {
    execFileSync('python3',['-c',script],{input:JSON.stringify({entitlements:Buffer.from(entitlements).toString('base64'),info:Buffer.from(info).toString('base64')}),stdio:['pipe','pipe','pipe']});
  } catch {throw new Error('macOS microphone entitlement or privacy description is missing');}
}
export async function verifyMacosApp(paths) {
  const app=one(paths,'.app','macOS application');
  if(!(await lstat(app)).isDirectory()) throw new Error('macOS application bundle is missing');
  const entitlements=execFileSync('codesign',['--display','--entitlements','-','--xml',app],{stdio:['ignore','pipe','pipe']});
  validateMacosMetadata(entitlements,await readFile(join(app,'Contents','Info.plist')));
}

async function findManifests(root) {
  const found=[];
  for(const entry of await readdir(root,{withFileTypes:true})) {
    const path=join(root,entry.name);
    if(entry.isDirectory()) found.push(...await findManifests(path));
    else if(entry.isFile()&&entry.name==='manifest.json') found.push(path);
  }
  return found;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const [command,...args]=process.argv.slice(2);
  if(command==='verify-macos') {
    await verifyMacosApp(JSON.parse(process.env.STUDY_ARTIFACT_PATHS??'[]'));
  } else if(command==='configure') {
    const path=await configuredFile(args[0],args[1],args.includes('--unsigned'));
    process.stdout.write(path+'\n');
  } else if(command==='apple-environment') {
    if(!process.env.GITHUB_ENV) throw new Error('GITHUB_ENV is required');
    const environment=appleEnvironment(process.env);
    const lines=Object.entries(environment).map(([name,value])=>{
      const delimiter='STUDY_'+createHash('sha256').update(name+value).digest('hex');
      return `${name}<<${delimiter}\n${value}\n${delimiter}\n`;
    }).join('');
    await writeFile(process.env.GITHUB_ENV,lines,{flag:'a'});
  } else if(command==='build') {
    const platform=args[0];formatsFor(platform);
    const targets={'linux-x86_64':'x86_64-unknown-linux-gnu','linux-aarch64':'aarch64-unknown-linux-gnu','macos-aarch64':'aarch64-apple-darwin','windows-x86_64':'x86_64-pc-windows-msvc'};
    const base=JSON.parse(await readFile(new URL('../../apps/desktop/src-tauri/tauri.conf.json',import.meta.url),'utf8'));
    const config=await configuredFile(base.version,'target/local-bundle-config.json',args.includes('--unsigned'));
    const environment={...process.env};
    for(const name of APPLE_VARIABLES) delete environment[name];
    Object.assign(environment,appleEnvironment(process.env));
    const result=spawnSync(process.platform==='win32'?'npm.cmd':'npm',['run','desktop:build','--','--config',config,'--target',targets[platform],...(args.includes('--unsigned')?['--no-sign']:[]),'--','--locked'],{env:environment,stdio:'inherit',shell:process.platform==='win32'});
    if(result.error) throw result.error;
    process.exitCode=result.status??1;
  } else if(command==='check-config') {
    validateConfig(args[0],JSON.parse(await readFile(new URL('../../apps/desktop/src-tauri/tauri.conf.json',import.meta.url),'utf8')));
  } else if(command==='prepare') {
    const [platform,version,output]=args;
    await preparePlatform({platform,version,output,paths:JSON.parse(process.env.STUDY_ARTIFACT_PATHS??'[]')});
  } else if(command==='assemble') {
    const [input,output,version,repository,tag]=args;
    await assembleRelease({manifests:await findManifests(input),output,version,repository,tag,publicKey:process.env.STUDY_UPDATE_PUBLIC_KEY});
  } else {throw new Error('usage: release.mjs prepare PLATFORM VERSION OUTPUT | assemble INPUT OUTPUT VERSION OWNER/REPO TAG');}
}
