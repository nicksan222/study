function needsSpace(left: string, right: string) {
  return !!left && !!right && !/[\s([{]$/.test(left) && !/^[\s,.;:!?)}\]]/.test(right);
}

export function dictationSpacing(before: string, text: string, after: string) {
  return {
    prefix: needsSpace(before, text) ? ' ' : '',
    suffix: needsSpace(text, after) ? ' ' : ''
  };
}
