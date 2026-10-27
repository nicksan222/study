#!/usr/bin/env python3
"""Manage Study's project-wide Herdr team.

Lifecycle: validate configuration and selectors, check provider login, lock the named
session, reuse or create the owned workspace, start only missing roles, then release
the lock before attaching. Plugin actions additionally prove their socket and workspace.
"""
import argparse
import fcntl
import json
import os
import shutil
import subprocess
import sys
import time
import tomllib
from pathlib import Path

TEAM = Path(__file__).resolve().parent
REPO = TEAM.parent.parent
# The effort levels each harness accepts ('-' keeps its default).
EFFORTS = {
    'claude': {'low', 'medium', 'high', 'xhigh', 'max'},
    'codex': {'minimal', 'low', 'medium', 'high', 'xhigh'},
}


class LauncherError(Exception):

    def __init__(self, msg, code=2):
        super().__init__(msg)
        self.code = code


def call(arguments, capture=False, check=True, **options):
    """Run one argv command without involving a shell."""
    run_options = {'text': True, **options}
    if capture:
        run_options.update(stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    result = subprocess.run(arguments, **run_options)
    if check and result.returncode:
        if capture and result.stderr:
            sys.stderr.write(result.stderr)
        raise LauncherError(f'command failed: {arguments[0]}', result.returncode)
    return result


class Fleet:
    """Own configuration, current transport, private state, and its mutation lock."""

    def __init__(self, options):
        with (TEAM / 'fleet.toml').open('rb') as config_file:
            config = tomllib.load(config_file)
        self.options = options
        self.session = config['session'] if options.session is None else options.session
        self.workspace = config['workspace']
        self.maximum = config['max_agents']
        self.reviewr = config['reviewr']
        self.defaults = config['default_agents']
        self.kinds = config['kinds']
        self.roles = config['roles']
        self.herdr = os.getenv('HERDR_BIN_PATH', 'herdr')
        self.plugin = options.plugin
        self.lockfile = None
        if self.plugin:
            self.plugin_context()
        self.state = REPO / 'target' / 'agents' / self.session
        self.validate()

    def validate(self):
        """Reject invalid configuration and selectors before any Herdr mutation."""
        valid = set('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-')
        valid_session = (
            bool(self.session)
            and len(self.session) <= 64
            and self.session[0].isalnum()
            and set(self.session) <= valid
        )
        if not valid_session:
            raise LauncherError('invalid session name')
        if type(self.maximum) is not int or self.maximum < 1:
            raise LauncherError('max_agents must be positive')
        if not self.defaults:
            raise LauncherError('default_agents must not be empty')
        if len(set(self.defaults)) != len(self.defaults):
            raise LauncherError('default_agents contains a duplicate role')
        unknown_defaults = set(self.defaults) - set(self.roles)
        if unknown_defaults:
            raise LauncherError(f'unknown default agent: {sorted(unknown_defaults)[0]}')
        for role, work in self.roles.items():
            valid_role = role[0:1].islower() and all(
                character.islower() or character.isdigit() or character == '-'
                for character in role
            )
            if not valid_role:
                raise LauncherError(f'invalid role: {role}')
            if not (TEAM / 'roles' / f'{role}.md').is_file():
                raise LauncherError(f'missing role: {role}')
            settings = self.kinds.get(work, {})
            if not isinstance(settings, dict) or settings.get('harness') not in EFFORTS:
                raise LauncherError(f'invalid work settings: {work}')
            model = settings.get('model')
            if not isinstance(model, str) or not model:
                raise LauncherError(f'invalid model for work kind: {work}')
            effort = settings.get('effort')
            if effort != '-' and effort not in EFFORTS[settings['harness']]:
                raise LauncherError(f'invalid effort for work kind {work}: {effort}')
        unknown = set(self.options.roles) - set(self.roles) - {'team'}
        if unknown:
            raise LauncherError(f'unknown agent: {sorted(unknown)[0]} (see list for configured roles)')
        if self.options.command == 'reset' and self.options.roles:
            raise LauncherError('reset always replaces the whole team; omit role selectors')
        if self.options.fresh and self.options.roles:
            raise LauncherError('--fresh restarts the whole team; omit agent selectors')
        if self.plugin and self.options.command not in {'up', 'reset', 'down'}:
            raise LauncherError('plugin mode supports only up, reset or down')

    def plugin_context(self):
        """Bind a menu action to the session socket and workspace that invoked it."""
        expected = 'stop' if self.options.command == 'down' else self.options.command
        action = os.getenv('HERDR_PLUGIN_ACTION_ID', '').rsplit('.', 1)[-1]
        if os.getenv('HERDR_PLUGIN_ID') != 'study.team':
            raise LauncherError('plugin action is not study.team')
        if action != expected:
            raise LauncherError(f'plugin action {action} cannot run {self.options.command}')
        socket = os.getenv('HERDR_SOCKET_PATH')
        if not socket or not os.getenv('HERDR_WORKSPACE_ID'):
            raise LauncherError('plugin action has no workspace transport context')
        status = json.loads(call([self.herdr, 'status', '--json'], capture=True).stdout)
        if status.get('server', {}).get('socket') != socket:
            raise LauncherError('plugin socket does not match the active Herdr session')
        self.session = status.get('server', {}).get('session') or status.get('client', {}).get('session')
        if not self.session:
            raise LauncherError('Herdr did not report the plugin session name')

    def herdr_command(self, *arguments, capture=True, check=True):
        """Use the selected transport; keep protocol JSON out of human-facing output."""
        command = [self.herdr]
        if not self.plugin:
            command.extend(['--session', self.session])
        command.extend(arguments)
        return call(command, capture=capture, check=check)

    def herdr_json(self, *arguments):
        """Call Herdr and decode its structured response."""
        response = self.herdr_command(*arguments, capture=True)
        return json.loads(response.stdout)

    def selected_roles(self):
        names = set(self.options.roles or self.defaults)
        if 'team' in names:
            names.update(self.defaults)
        return [(role, work) for role, work in self.roles.items() if role in names]

    def validate_container(self):
        if not (Path('/.dockerenv').exists() or Path('/run/.containerenv').exists()):
            raise LauncherError('run inside the devcontainer (never on the host)')
        target = str(REPO / 'target' / 'devcontainer')
        if os.getenv('CARGO_TARGET_DIR', target) != target:
            raise LauncherError('use target/devcontainer as CARGO_TARGET_DIR')
        os.environ['CARGO_TARGET_DIR'] = target

    def doctor(self):
        """Check tools and subscription login without making a model request."""
        self.validate_container()
        for tool in [self.herdr, 'python3', 'just', 'cargo', 'rust-analyzer']:
            if not shutil.which(tool):
                raise LauncherError(f'missing {tool}: rebuild the devcontainer')
        seen = set()
        for _, work in self.selected_roles():
            provider = self.kinds[work]['harness']
            if provider in seen:
                continue
            seen.add(provider)
            if not shutil.which(provider):
                raise LauncherError(f'missing {provider}: rebuild the devcontainer')
            call([provider, '--version'])
            if provider == 'claude':
                if os.getenv('ANTHROPIC_API_KEY') or os.getenv('ANTHROPIC_AUTH_TOKEN'):
                    raise LauncherError('unset API credentials to use your Claude subscription')
                result = call(['claude', 'auth', 'status'], capture=True, check=False)
                if result.returncode:
                    raise LauncherError('Claude is not signed in: run claude auth login')
                auth = json.loads(result.stdout)
                if not auth.get('loggedIn') or auth.get('authMethod') not in {'claude.ai', 'oauth_token'}:
                    raise LauncherError('Claude must use a subscription login')
                print('Claude subscription login found (no model request made).')
            else:
                call(['codex', 'login', 'status'])
        print(f"Container ready; Cargo target: {os.environ['CARGO_TARGET_DIR']}")

    def lock(self):
        """Take the private, per-session mutation lock without waiting."""
        previous_umask = os.umask(0o077)
        try:
            (self.state / 'reports').mkdir(parents=True, exist_ok=True)
            self.lockfile = (self.state / 'launcher.lock').open('a+')
        finally:
            os.umask(previous_umask)
        try:
            fcntl.flock(self.lockfile, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise LauncherError(f'another launcher is changing session {self.session}') from error

    def unlock(self):
        if self.lockfile:
            fcntl.flock(self.lockfile, fcntl.LOCK_UN)
            self.lockfile.close()
            self.lockfile = None

    def server_running(self):
        """Recognize Herdr's first status line while allowing its metadata lines."""
        response = self.herdr_command('status', 'server', capture=True, check=False)
        return response.returncode == 0 and 'status: running' in response.stdout.splitlines()

    def ensure_server(self):
        if self.server_running():
            return
        environment = os.environ.copy()
        # Remove nested-agent markers while preserving subscription OAuth credentials.
        markers = {'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_EFFORT_LEVEL'}
        for key in list(environment):
            if key.startswith('HERDR_') or key in markers:
                environment.pop(key)
        # Agents use the desktop headlessly; never open tabs in the maintainer's browser.
        environment['STUDY_OPEN_BROWSER'] = '0'
        subprocess.Popen(
            [self.herdr, '--session', self.session, 'server'],
            env=environment,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
            close_fds=True,
        )
        for _ in range(50):
            if self.server_running():
                return
            time.sleep(0.1)
        raise LauncherError('Herdr server did not start')

    def workspace_id(self):
        items = self.herdr_json('workspace', 'list')['result']['workspaces']
        found = [item['workspace_id'] for item in items if item.get('label') == self.workspace]
        if len(found) > 1:
            raise LauncherError('duplicate team workspaces; resolve them in Herdr first')
        return found[0] if found else ''

    def guard_workspace(self, workspace_id):
        if self.plugin and (not workspace_id or workspace_id != os.getenv('HERDR_WORKSPACE_ID')):
            raise LauncherError('plugin action did not originate in the Study team workspace')

    def start_role(self, role, work, pane):
        """Write one private role brief, then start its provider in a new pane."""
        settings = self.kinds[work]
        prompt = self.state / f'{role}.md'
        try:
            team_brief = (TEAM / 'team.md').read_text()
            role_brief = (TEAM / 'roles' / f'{role}.md').read_text()
            handoff = (
                f'\nHerdr session: {self.session}. '
                f'Use herdr --session {self.session} for every message.\n'
                f'Handoff: {self.state}/task.md (lead owns it; keep it brief).\n'
                f'Reports: {self.state}/reports (one <role>-<topic>.md per report).\n'
            )
            prompt.write_text(team_brief + role_brief + handoff)
            prompt.chmod(0o600)
        except OSError as error:
            raise LauncherError(str(error), 1) from error
        provider = settings['harness']
        if provider == 'claude':
            provider_arguments = [
                '--append-system-prompt-file',
                str(prompt),
                '--dangerously-skip-permissions',
                '--settings',
                '{"skipDangerousModePermissionPrompt":true}',
                '--disallowedTools',
                'Agent,Workflow',
            ]
        else:
            provider_arguments = ['--dangerously-bypass-approvals-and-sandbox']
        if settings['model'] != '-':
            provider_arguments += ['--model', settings['model']]
        if settings['effort'] != '-':
            if provider == 'claude':
                provider_arguments.extend(['--effort', settings['effort']])
            else:
                effort = f'model_reasoning_effort="{settings["effort"]}"'
                provider_arguments.extend(['-c', effort])
        self.herdr_command(
            'agent', 'start', role, '--kind', provider, '--pane', pane,
            '--timeout', '60000', '--', *provider_arguments,
        )
        if provider == 'codex':
            self.herdr_command('agent', 'prompt', role, prompt.read_text())
        print(f"Started {role}: {provider} {settings['model']} ({settings['effort']}).")

    def up(self, reset=False):
        """Start missing roles, or replace every conversation for reset/fresh."""
        selected_roles = self.selected_roles()
        if not selected_roles:
            raise LauncherError('no agents selected')
        if len(selected_roles) > self.maximum:
            raise LauncherError(f'request exceeds max_agents={self.maximum}')
        if self.options.dry_run:
            self.roster(selected_roles)
            return
        self.doctor()
        self.lock()
        self.ensure_server()
        workspace_id = self.workspace_id()
        agents = self.herdr_json('agent', 'list')['result']['agents']
        requested_names = {role for role, _ in selected_roles}
        for agent in agents:
            belongs_elsewhere = agent.get('workspace_id') != workspace_id
            if agent.get('name') in requested_names and belongs_elsewhere:
                raise LauncherError(f"{agent['name']} belongs to another workspace")
        owned = {agent['name'] for agent in agents if agent.get('workspace_id') == workspace_id}
        self.guard_workspace(workspace_id)
        if self.options.fresh or reset:
            if workspace_id:
                self.herdr_command('workspace', 'close', workspace_id)
            if reset:
                (self.state / 'task.md').unlink(missing_ok=True)
            workspace_id = ''
            owned = set()
        # Count the union so several incremental starts cannot bypass the team cap.
        if len(owned | requested_names) > self.maximum:
            raise LauncherError(f'team would exceed MAX_AGENTS={self.maximum}')
        self.herdr_command('plugin', 'link', str(TEAM))
        first = False
        for role, work in selected_roles:
            if role in owned:
                print(f'{role} already present; keeping its conversation.')
                continue
            if not workspace_id:
                response = self.herdr_json(
                    'workspace', 'create', '--cwd', str(REPO),
                    '--label', self.workspace, '--no-focus',
                )
                created = response['result']
                workspace_id = created['workspace']['workspace_id']
                pane = created['root_pane']['pane_id']
                self.herdr_command('tab', 'rename', created['tab']['tab_id'], role)
                first = True
            else:
                response = self.herdr_json(
                    'tab', 'create', '--workspace', workspace_id,
                    '--cwd', str(REPO), '--label', role, '--no-focus',
                )
                created = response['result']
                pane = created['root_pane']['pane_id']
            try:
                self.start_role(role, work, pane)
            except LauncherError:
                self.herdr_command('pane', 'close', pane, check=False)
                print(f'failed to start {role}; removed its new pane', file=sys.stderr)
                raise
            if role == 'lead':
                self.herdr_command('agent', 'focus', 'lead')
                review_panel = self.herdr_command(
                    'plugin', 'action', 'invoke', 'open', '--plugin', self.reviewr, check=False,
                )
                if review_panel.returncode:
                    print('reviewr unavailable; run setup.')
        self.herdr_command('workspace', 'focus', workspace_id)
        if 'lead' in requested_names:
            self.herdr_command('agent', 'focus', 'lead')
        if first:
            if reset:
                print('New conversations started with no prior handoff.')
            else:
                print('New conversations: the lead can recover the task from its handoff.')
        # Attaching can last for hours; never retain the mutation lock in the UI.
        self.unlock()
        if not self.options.no_attach:
            os.execvp(self.herdr, [self.herdr, '--session', self.session])

    def down(self):
        """Close owned panes or the complete owned workspace."""
        self.validate_container()
        self.lock()
        if not self.server_running():
            print('No team is running.')
            return
        workspace_id = self.workspace_id()
        if not workspace_id:
            print('No team workspace is open.')
            return
        self.guard_workspace(workspace_id)
        if not self.options.roles:
            self.herdr_command('workspace', 'close', workspace_id)
            print(f'Closed {self.workspace} in {self.session}.')
            return
        agents = self.herdr_json('agent', 'list')['result']['agents']
        for role, _ in self.selected_roles():
            for agent in agents:
                if agent.get('name') == role and agent.get('workspace_id') == workspace_id:
                    self.herdr_command('pane', 'close', agent['pane_id'])

    def roster(self, items=None):
        print(f'Session: {self.session} | workspace: {self.workspace} | maximum agents: {self.maximum}')
        for role, work in items or self.roles.items():
            settings = self.kinds[work]
            print(f"{role:<17} {settings['harness']:<8} {settings['model']:<24} {settings['effort']}")


def parse():
    parser = argparse.ArgumentParser()
    subcommands = parser.add_subparsers(dest='command', required=True)
    for name in ('up', 'reset', 'down', 'doctor', 'list'):
        command_parser = subcommands.add_parser(name)
        command_parser.add_argument('--session')
        command_parser.add_argument('--plugin', action='store_true', help=argparse.SUPPRESS)
        command_parser.add_argument('roles', nargs='*')
        command_parser.set_defaults(fresh=False, no_attach=False, dry_run=False)
        if name in {'up', 'reset'}:
            command_parser.add_argument('--no-attach', action='store_true')
            command_parser.add_argument('--dry-run', action='store_true')
        if name == 'up':
            command_parser.add_argument('--fresh', action='store_true')
    return parser.parse_args()


def main():
    options = parse()
    fleet = Fleet(options)
    try:
        if options.command == 'up':
            fleet.up()
        elif options.command == 'reset':
            fleet.up(reset=True)
        elif options.command == 'down':
            fleet.down()
        elif options.command == 'doctor':
            fleet.doctor()
        else:
            fleet.roster()
    finally:
        fleet.unlock()


if __name__ == '__main__':
    try:
        main()
    except LauncherError as error:
        print(error, file=sys.stderr)
        raise SystemExit(error.code)
    except (OSError, KeyError, TypeError, tomllib.TOMLDecodeError, json.JSONDecodeError) as error:
        print(f'invalid launcher data: {error}', file=sys.stderr)
        raise SystemExit(2)
