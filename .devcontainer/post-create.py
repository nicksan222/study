#!/usr/bin/env python3
"""Configure the devcontainer after its host login mounts are available.

Run once after creation, or again after changing project plugins. The image installs
programs; this script connects runtime credentials and configures this workspace.
Each setup step below corresponds to one thing a maintainer might need to change.
"""
import json
import os
from pathlib import Path
import subprocess
import shlex
import sys

HOME = Path.home()
REPO = Path(__file__).resolve().parent.parent


def read_settings(path):
    """A missing/empty login mount is normal on a contributor's first start."""
    if not path.exists():
        return {}
    text = path.read_text()
    return json.loads(text) if text.strip() else {}


def write_settings(path, settings):
    # Write in place: ~/.claude.json can itself be a bind mount, so renaming a
    # temporary file over it would fail or replace the wrong filesystem entry.
    path.write_text(json.dumps(settings, indent=2) + "\n")


def install_herdr_hook():
    """Make the installer-owned hook portable between host and container HOME."""
    (HOME / ".claude").mkdir(exist_ok=True)
    subprocess.run(["herdr", "integration", "install", "claude"], check=True)
    path = HOME / ".claude/settings.json"
    settings = read_settings(path)
    # Herdr has written the absolute path both double- and single-quoted.
    installed = {
        f'bash "{HOME}/.claude/hooks/herdr-agent-state.sh" session',
        f"bash '{HOME}/.claude/hooks/herdr-agent-state.sh' session",
    }
    portable = 'bash "$HOME/.claude/hooks/herdr-agent-state.sh" session'
    hooks = settings.get("hooks", {})
    if not isinstance(hooks, dict):
        return
    for event, groups in hooks.items():
        unique_groups = []
        for group in groups:
            for hook in group.get("hooks", []):
                # Never rewrite a compound command customized by the user.
                if hook.get("command") in installed:
                    hook["command"] = portable
            if group not in unique_groups:
                unique_groups.append(group)
        hooks[event] = unique_groups
    if path.exists():
        write_settings(path, settings)


def trust_workspace():
    """Allow unattended agents in this checkout, preserving other trusted paths."""
    path = HOME / ".claude.json"
    settings = read_settings(path)
    projects = settings.setdefault("projects", {})
    projects.setdefault(str(REPO), {})["hasTrustDialogAccepted"] = True
    write_settings(path, settings)
    credentials = HOME / ".claude/.credentials.json"
    has_saved_login = credentials.exists() and credentials.stat().st_size > 0
    if not has_saved_login and not os.environ.get("CLAUDE_CODE_OAUTH_TOKEN"):
        print("hint: no Claude login: run claude once and sign in; it is saved on the host")


def install_project_plugins():
    """Missing marketplaces should not prevent opening the development container."""
    settings = read_settings(REPO / ".claude/settings.json")
    for marketplace in settings.get("extraKnownMarketplaces", {}).values():
        source = marketplace["source"]
        location = source.get("repo") or source.get("url")
        command = ["claude", "plugin", "marketplace", "add", location, "--scope", "project"]
        if subprocess.run(command, stdout=subprocess.DEVNULL).returncode:
            print(f"hint: cannot add the plugin marketplace {location}")
    for plugin, enabled in settings.get("enabledPlugins", {}).items():
        if not enabled:
            continue
        command = ["claude", "plugin", "install", plugin, "--scope", "project"]
        result = subprocess.run(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if result.returncode:
            print(f"hint: cannot install the plugin {plugin}")


def configure_github():
    """Read the exported login at shell startup; never save its value in shell rc."""
    loader = REPO / ".devcontainer/shell-env.sh"
    source_line = ". " + shlex.quote(str(loader))
    for name in (".profile", ".bashrc"):
        path = HOME / name
        lines = path.read_text().splitlines() if path.exists() else []
        if source_line not in lines:
            lines.append(source_line)
        path.write_text("\n".join(lines) + "\n")

    # Configure this setup process too; subsequent terminals use shell-env.sh.
    token_file = HOME / ".config/study-devcontainer/gh-token"
    if not os.environ.get("GH_TOKEN") and token_file.exists():
        os.environ["GH_TOKEN"] = token_file.read_text().strip()
    (HOME / ".gitconfig").touch(exist_ok=True)
    if os.environ.get("GH_TOKEN"):
        subprocess.run(["gh", "auth", "setup-git"], check=True)
    else:
        print("hint: no GitHub login: run gh auth login on the host, then rebuild the container")



def configure_git_identity():
    """Include the host's exported author identity; never edit the mounted file."""
    identity = HOME / ".config/study-devcontainer/git-identity"
    if not identity.exists():
        print("hint: rebuild the devcontainer to forward the host Git author identity")
        return
    result = subprocess.run(
        ["git", "config", "--global", "--get-all", "include.path"],
        text=True, capture_output=True,
    )
    if result.returncode not in (0, 1):
        raise RuntimeError("cannot read container Git configuration")
    if str(identity) not in result.stdout.splitlines():
        subprocess.run(
            ["git", "config", "--global", "--add", "include.path", str(identity)],
            check=True,
        )
    for key in ("user.name", "user.email"):
        result = subprocess.run(
            ["git", "config", "--get", key], capture_output=True, text=True,
        )
        if result.returncode or not result.stdout.strip():
            print(f"hint: set {key} on the host, then reopen the devcontainer")


def main():
    install_herdr_hook()
    trust_workspace()
    install_project_plugins()
    configure_git_identity()
    configure_github()
    # These commands report versions only; they do not start a model request.
    for tool in ("just", "claude", "herdr", "codex"):
        subprocess.run([tool, "--version"], check=True)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError) as error:
        print(f"Container setup failed: {error}", file=sys.stderr)
        raise SystemExit(1)
