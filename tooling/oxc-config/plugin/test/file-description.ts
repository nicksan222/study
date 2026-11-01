export function framedHeader(content: string): string {
  return [
    '/**',
    ' * ╭' + '─'.repeat(90) + '╮',
    ...content.split('\n').map((line) => ' * │ ' + line.padEnd(88) + ' │'),
    ' * ╰' + '─'.repeat(90) + '╯',
    ' */'
  ].join('\n');
}

export const description = [
  '@file Composes the private server runtime and feature layers.',
  '',
  'Responsibilities:',
  '- Assemble feature services with their platform dependencies.',
  '- Release scoped resources when the process exits.',
  '',
  'Boundaries:',
  'Delegates domain behavior to feature services and owns process lifetime.'
].join('\n');

export const header = framedHeader(description);
