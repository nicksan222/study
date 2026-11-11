"""Report logical payload sizes and separate download sizes without following symlinks."""
import argparse
import json
import os
from pathlib import Path


def inventory(root, runtime=False):
    if root.is_symlink() or not root.exists():
        raise ValueError(f'Input does not exist or is a symlink: {root}')
    files = []
    if root.is_file():
        files.append((root.name, root.stat().st_size))
    else:
        for directory, dirs, names in os.walk(root, followlinks=False):
            dirs[:] = sorted(d for d in dirs if not (Path(directory) / d).is_symlink())
            for name in sorted(names):
                path = Path(directory) / name
                if not path.is_symlink() and path.is_file():
                    files.append((path.relative_to(root).as_posix(), path.stat().st_size))
    result = {'logical_bytes': sum(size for _, size in files),
              'largest_files': [{'path': path, 'bytes': size} for path, size in sorted(files, key=lambda item: (-item[1], item[0]))[:30]]}
    if runtime:
        components = {}
        packages = {}
        for path, size in files:
            parts = path.split('/')
            if parts[0] in ('bun', 'bun.exe'):
                component = 'bun'
            elif parts[:2] == ['server', 'node_modules']:
                component = 'dependencies'
                name = '/'.join(parts[2:4]) if len(parts) > 3 and parts[2].startswith('@') else parts[2]
                packages[name] = packages.get(name, 0) + size
            elif parts[0] == 'server':
                component = 'server_and_workspaces'
            else:
                component = 'other'
            components[component] = components.get(component, 0) + size
        result['components'] = dict(sorted(components.items()))
        result['packages'] = dict(sorted(packages.items(), key=lambda item: (-item[1], item[0])))
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime', required=True, type=Path)
    parser.add_argument('--app', required=True, type=Path)
    parser.add_argument('--artifact', action='append', default=[], type=Path)
    args = parser.parse_args()
    try:
        artifacts = []
        for path in sorted(set(args.artifact)):
            if path.is_symlink() or not path.is_file():
                raise ValueError(f'Artifact is not a regular file: {path}')
            artifacts.append({'path': path.name, 'bytes': path.stat().st_size})
        report = {'runtime': inventory(args.runtime, True), 'application': inventory(args.app), 'artifacts': artifacts}
    except (OSError, ValueError) as error:
        parser.error(str(error))
    print(json.dumps(report, indent=2, ensure_ascii=True))


if __name__ == '__main__':
    main()
