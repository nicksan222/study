function needsSpace(left: string, right: string) {
  return (
    !!left && !!right && !/[\s([{\p{Pi}]$/u.test(left) && !/^[\s,.;:!?)}\]\p{Pf}]/u.test(right)
  );
}

export function dictationSpacing(before: string, text: string, after: string) {
  return {
    prefix: needsSpace(before, text) ? ' ' : '',
    suffix: needsSpace(text, after) ? ' ' : ''
  };
}
