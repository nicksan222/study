import base64
import hashlib
import json
import os
import plistlib
import shutil
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
CLI = ROOT / "tooling/release/release.sh"
PLATFORMS = {"linux-x86_64": (".AppImage", ".AppImage"), "linux-aarch64": (".AppImage", ".AppImage"), "macos-aarch64": (".dmg", ".app.tar.gz"), "windows-x86_64": (".exe", ".exe")}

class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        subprocess.run(["minisign", "-G", "-W", "-p", str(self.root / "public"), "-s", str(self.root / "secret")], check=True, capture_output=True)
        self.env = dict(os.environ, STUDY_UPDATE_PUBLIC_KEY=base64.b64encode((self.root / "public").read_bytes()).decode())

    def cli(self, *args, paths=None, ok=True, **env):
        result = subprocess.run(["bash", str(CLI), *map(str, args)], cwd=ROOT, env=dict(self.env, **env, STUDY_ARTIFACT_PATHS=json.dumps(list(map(str, paths or [])))), text=True, capture_output=True)
        self.assertEqual(result.returncode == 0, ok, result.stdout + result.stderr)
        return result

    def fixtures(self, encoded=False):
        for platform, (installer_ext, update_ext) in PLATFORMS.items():
            folder = self.root / platform
            folder.mkdir()
            installer = folder / ("Study_0.1.1" + installer_ext)
            update = folder / ("Study_0.1.1" + update_ext)
            installer.write_text("installer " + platform)
            if update != installer:
                update.write_text("update " + platform)
            signature = Path(str(update) + ".sig")
            subprocess.run(["minisign", "-S", "-s", str(self.root / "secret"), "-m", str(update), "-x", str(signature)], check=True, capture_output=True)
            if encoded:
                signature.write_bytes(base64.b64encode(signature.read_bytes()))
            self.cli("prepare", platform, "0.1.1", self.root / "input" / platform, paths=list(dict.fromkeys([installer, update, signature])))

    def assemble(self, ok=True, version="0.1.1", tag="v0.1.1", **env):
        self.cli("assemble", self.root / "input", self.root / "final", version, "nicksan222/study", tag, ok=ok, **env)
        if not ok:
            self.assertFalse((self.root / "final").exists())

    def test_complete_release(self):
        self.fixtures()
        self.assemble()
        feed = json.loads((self.root / "final/latest.json").read_text())
        self.assertEqual(set(feed["platforms"]), {"linux-x86_64", "linux-aarch64", "darwin-aarch64", "windows-x86_64"})
        for platform, (installer, update) in PLATFORMS.items():
            self.assertTrue((self.root / "final" / ("study-" + platform + installer)).is_file())
            entry = feed["platforms"][platform.replace("macos", "darwin")]
            self.assertEqual(entry["url"], "https://github.com/nicksan222/study/releases/download/v0.1.1/study-" + platform + update)
            self.assertTrue(base64.b64decode(entry["signature"]).startswith(b"untrusted comment:"))

    def test_base64_artifact_signatures(self):
        self.fixtures(encoded=True)
        self.assemble()

    def test_incomplete_duplicate_versions_and_unknown_platforms(self):
        self.fixtures()
        self.assemble(ok=False, tag="v0.1.2")
        self.assemble(ok=False, version="0.1.2", tag="v0.1.2")
        manifest = self.root / "input/linux-x86_64/manifest.json"
        original = manifest.read_text()
        for platform in ["constructor", "toString", "__proto__", "linux-aarch64"]:
            data = json.loads(original)
            data["platform"] = platform
            manifest.write_text(json.dumps(data))
            self.assemble(ok=False)
        manifest.unlink()
        self.assemble(ok=False)

    def test_integrity_and_signature_failures(self):
        self.fixtures()
        subprocess.run(["minisign", "-G", "-W", "-p", str(self.root / "other"), "-s", str(self.root / "other-secret")], check=True, capture_output=True)
        self.assemble(ok=False, STUDY_UPDATE_PUBLIC_KEY=base64.b64encode((self.root / "other").read_bytes()).decode())
        manifest = self.root / "input/linux-x86_64/manifest.json"
        data = json.loads(manifest.read_text())
        update = manifest.parent / data["update"]
        update.write_bytes(b"tampered update")
        self.assemble(ok=False)
        for record in data["files"]:
            if record["name"] == data["update"]:
                record.update(size=update.stat().st_size, sha256=hashlib.sha256(update.read_bytes()).hexdigest())
        manifest.write_text(json.dumps(data))
        self.assemble(ok=False)

    def test_missing_signature_and_ambiguous_installer(self):
        installer = self.root / "Study.exe"
        installer.write_text("installer")
        self.cli("prepare", "windows-x86_64", "0.1.1", self.root / "stage", paths=[installer], ok=False)
        other = self.root / "Other.exe"
        other.write_text("other")
        self.cli("prepare", "windows-x86_64", "0.1.1", self.root / "stage", paths=[installer, other], ok=False)
        self.assertFalse((self.root / "stage").exists())

    def test_manifest_name_set_and_regular_file_contract(self):
        self.fixtures()
        manifest = self.root / "input/linux-x86_64/manifest.json"
        original = manifest.read_text()
        for change in [lambda data: data.update(installer="../escape"),
                       lambda data: data["files"].append(data["files"][0]),
                       lambda data: data["files"].pop(),
                       lambda data: data.update(schemaVersion=2)]:
            data = json.loads(original)
            change(data)
            manifest.write_text(json.dumps(data))
            self.assemble(ok=False)
        manifest.write_text(original)
        update = manifest.parent / json.loads(original)["update"]
        update.write_bytes(b"")
        self.assemble(ok=False)
        update.unlink()
        update.symlink_to(self.root / "public")
        self.assemble(ok=False)

    def test_macos_metadata_through_cli(self):
        app = self.root / "Study.app"
        (app / "Contents").mkdir(parents=True)
        info = app / "Contents/Info.plist"
        entitlements = self.root / "entitlements.plist"
        binary = self.root / "bin"
        binary.mkdir()
        codesign = binary / "codesign"
        codesign.write_text('#!/usr/bin/env bash\ncat "$TEST_ENTITLEMENTS"\n')
        codesign.chmod(0o755)
        environment = {"PATH": str(binary) + os.pathsep + os.environ["PATH"], "TEST_ENTITLEMENTS": str(entitlements)}
        for audio, privacy, ok in [(True, "Record audio", True), (False, "Record audio", False), (True, "", False), (True, None, False)]:
            entitlements.write_bytes(plistlib.dumps({"com.apple.security.device.audio-input": audio}))
            info.write_bytes(plistlib.dumps({} if privacy is None else {"NSMicrophoneUsageDescription": privacy}))
            self.cli("verify-macos", paths=[app], ok=ok, **environment)
        base = json.loads((ROOT / "apps/desktop/src-tauri/tauri.conf.json").read_text())
        native = ROOT / "apps/desktop/src-tauri"
        subprocess.run(["python3", str(ROOT / "tooling/release/validate_plist.py"), str(native / base["bundle"]["macOS"]["entitlements"]), str(native / base["bundle"]["macOS"]["infoPlist"])], check=True)

    def test_build_uses_local_cli_and_propagates_failure(self):
        checkout = self.root / "checkout"
        cli = checkout / "tooling/release/release.sh"
        cli.parent.mkdir(parents=True)
        shutil.copyfile(CLI, cli)
        native = checkout / "apps/desktop/src-tauri"
        native.mkdir(parents=True)
        shutil.copyfile(ROOT / "apps/desktop/src-tauri/tauri.conf.json", native / "tauri.conf.json")
        tauri = checkout / "node_modules/.bin/tauri"
        tauri.parent.mkdir(parents=True)
        tauri.write_text('#!/usr/bin/env bash\nprintf "%s\\n" "$@" > "$TEST_ARGS"\nenv > "$TEST_ENV"\nexit "${TEST_STATUS:-0}"\n')
        tauri.chmod(0o755)
        args_file, env_file = self.root / "args", self.root / "build-env"
        environment = dict(self.env, TEST_ARGS=str(args_file), TEST_ENV=str(env_file), APPLE_ID="", APPLE_CERTIFICATE="", APPLE_CERTIFICATE_PASSWORD="")
        for unsigned in [False, True]:
            result = subprocess.run(["bash", str(cli), "build", "macos-aarch64"] + (["--unsigned"] if unsigned else []), env=environment, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            args = args_file.read_text().splitlines()
            self.assertEqual(args[0], "build")
            self.assertIn("aarch64-apple-darwin", args)
            self.assertEqual("--no-sign" in args, unsigned)
            self.assertEqual(args[-2:], ["--", "--locked"])
            self.assertIn("APPLE_SIGNING_IDENTITY=-", env_file.read_text())
            self.assertNotIn("APPLE_ID=", env_file.read_text())
        result = subprocess.run(["bash", str(cli), "build", "windows-x86_64"], env=dict(environment, TEST_STATUS="17"), capture_output=True)
        self.assertEqual(result.returncode, 17)

    def test_config_and_apple_environment(self):
        version = json.loads((ROOT / "apps/desktop/src-tauri/tauri.conf.json").read_text())["version"]
        self.cli("check-config", version)
        site = (ROOT / "apps/landing/src/i18n/strings.ts").read_text()
        for platform, (installer, _) in PLATFORMS.items():
            self.assertIn("study-" + platform + installer, site)
        self.assertIn('version = "' + version + '"', (ROOT / "Cargo.toml").read_text())
        self.cli("check-config", "999.0.0", ok=False)
        output = self.root / "config.json"
        self.cli("configure", version, output, STUDY_UPDATE_ENDPOINT="https://github.com/example/study/releases/latest/download/latest.json")
        config = json.loads(output.read_text())
        self.assertEqual(config["plugins"]["updater"]["pubkey"], self.env["STUDY_UPDATE_PUBLIC_KEY"])
        self.assertEqual(config["bundle"]["macOS"]["minimumSystemVersion"], "12.0")
        self.cli("configure", version, output, STUDY_UPDATE_PUBLIC_KEY="untrusted comment: invalid", ok=False)
        self.cli("configure", version, output, STUDY_UPDATE_ENDPOINT="http://example.com", ok=False)
        self.cli("configure", version, output, "--unsigned")
        self.assertFalse(json.loads(output.read_text())["bundle"]["createUpdaterArtifacts"])
        apple = {name: "" for name in ["APPLE_SIGNING_IDENTITY", "APPLE_CERTIFICATE", "APPLE_CERTIFICATE_PASSWORD", "APPLE_ID", "APPLE_PASSWORD", "APPLE_TEAM_ID"]}
        github_env = self.root / "env"
        self.cli("apple-environment", GITHUB_ENV=str(github_env), **apple)
        self.assertIn("APPLE_SIGNING_IDENTITY<<", github_env.read_text())
        self.assertIn("\n-\n", github_env.read_text())
        github_env.unlink()
        apple["APPLE_CERTIFICATE"] = "certificate"
        self.cli("apple-environment", GITHUB_ENV=str(github_env), **apple)
        self.assertIn("APPLE_CERTIFICATE_PASSWORD<<", github_env.read_text())
        self.assertNotIn("APPLE_SIGNING_IDENTITY", github_env.read_text())

if __name__ == "__main__":
    unittest.main()
