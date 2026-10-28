const colorNames =
  'aliceblue|antiquewhite|aqua|aquamarine|azure|beige|bisque|black|blanchedalmond|blue|blueviolet|brown|burlywood|cadetblue|chartreuse|chocolate|coral|cornflowerblue|cornsilk|crimson|cyan|darkblue|darkcyan|darkgoldenrod|darkgray|darkgreen|darkgrey|darkkhaki|darkmagenta|darkolivegreen|darkorange|darkorchid|darkred|darksalmon|darkseagreen|darkslateblue|darkslategray|darkslategrey|darkturquoise|darkviolet|deeppink|deepskyblue|dimgray|dimgrey|dodgerblue|firebrick|floralwhite|forestgreen|fuchsia|gainsboro|ghostwhite|gold|goldenrod|gray|green|greenyellow|grey|honeydew|hotpink|indianred|indigo|ivory|khaki|lavender|lavenderblush|lawngreen|lemonchiffon|lightblue|lightcoral|lightcyan|lightgoldenrodyellow|lightgray|lightgreen|lightgrey|lightpink|lightsalmon|lightseagreen|lightskyblue|lightslategray|lightslategrey|lightsteelblue|lightyellow|lime|limegreen|linen|magenta|maroon|mediumaquamarine|mediumblue|mediumorchid|mediumpurple|mediumseagreen|mediumslateblue|mediumspringgreen|mediumturquoise|mediumvioletred|midnightblue|mintcream|mistyrose|moccasin|navajowhite|navy|oldlace|olive|olivedrab|orange|orangered|orchid|palegoldenrod|palegreen|paleturquoise|palevioletred|papayawhip|peachpuff|peru|pink|plum|powderblue|purple|rebeccapurple|red|rosybrown|royalblue|saddlebrown|salmon|sandybrown|seagreen|seashell|sienna|silver|skyblue|slateblue|slategray|slategrey|snow|springgreen|steelblue|tan|teal|thistle|tomato|turquoise|violet|wheat|white|whitesmoke|yellow|yellowgreen';

const rawColor = new RegExp(
  `(?:#[\\da-f]{3,8}\\b|\\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\\s*\\(|(?<![\\w-])(?:${colorNames})(?![\\w-]))`,
  'i'
);

const palette =
  '(?:slate|gray|grey|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:[0-9]{2,3})|black|white';

const colorUtility = new RegExp(
  `(?:^|[\\s:])!?-?(?:bg|text|border(?:-[trblxyse])?|ring(?:-offset)?|outline|fill|stroke|decoration|(?:inset-)?shadow|accent|caret|divide(?:-[xy])?|from|via|to)-(?:${palette})(?:[\\s/!]|$)`,
  'i'
);

const paletteReference = new RegExp(`--color-(?:${palette})(?![\\w-])`, 'i');

const arbitrary =
  /(?:^|[\s:])(?:bg|text|border(?:-[trblxyse])?|ring(?:-offset)?|outline|fill|stroke|decoration|(?:inset-)?shadow|accent|caret|divide(?:-[xy])?|from|via|to)-\[([^\]]+)\]/gi;

export function hasLiteralColor(value: string): boolean {
  return /#[\da-f]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\s*\(/i.test(value);
}

export function hasRawColor(value: string): boolean {
  return rawColor.test(value.replace(/var\(\s*--[\w-]+\s*\)/g, ''));
}

export function hasRawColorClass(value: string): boolean {
  return (
    [
      ...value.matchAll(
        /\[(?:color|background(?:-[a-z-]+)?|border(?:-[a-z]+)?|fill|stroke|outline(?:-color)?|(?:(?:box|text)-)?shadow):([^\]]+)\]/gi
      )
    ].some((match) => hasRawColor(match[1] ?? '')) ||
    colorUtility.test(value) ||
    paletteReference.test(value) ||
    [...value.matchAll(arbitrary)].some((match) => hasRawColor(match[1] ?? ''))
  );
}

export function cssColorViolations(source: string): string[] {
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const declarations = clean.matchAll(/(?:^|[;{])\s*([\w-]+)\s*:\s*([^;{}]+)(?=[;}])/g);

  return [...declarations]
    .filter(
      ([, property, value]) =>
        /^(?:--|color$|background|border|outline|fill$|stroke$|(?:box-|text-)?shadow$|text-decoration|caret|accent|column-rule|scrollbar|mask)/i.test(
          property ?? ''
        ) &&
        (hasRawColor(value ?? '') || paletteReference.test(value ?? ''))
    )
    .map(([, property, value]) => `${property}: ${value}`);
}
