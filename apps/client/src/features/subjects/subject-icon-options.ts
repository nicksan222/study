import type { projectSymbols, projectIconColors } from '@study/contracts/projects/schemas';
import type { StaticMessageKey } from '@study/localization';
import {
  BookOpen,
  NotebookPen,
  Folder,
  GraduationCap,
  Atom,
  FlaskConical,
  Dna,
  Microscope,
  Calculator,
  Sigma,
  ChartNoAxesCombined,
  Globe,
  Landmark,
  Languages,
  Palette,
  Music,
  Code,
  Cpu,
  Rocket,
  Leaf,
  Heart,
  Brain,
  Sparkles,
  Compass
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export const subjectSymbols = {
  book: { Icon: BookOpen, label: 'SubjectSymbolBook' },
  notebook: { Icon: NotebookPen, label: 'SubjectSymbolNotebook' },
  folder: { Icon: Folder, label: 'SubjectSymbolFolder' },
  'graduation-cap': { Icon: GraduationCap, label: 'SubjectSymbolGraduation' },
  atom: { Icon: Atom, label: 'SubjectSymbolAtom' },
  flask: { Icon: FlaskConical, label: 'SubjectSymbolFlask' },
  dna: { Icon: Dna, label: 'SubjectSymbolDna' },
  microscope: { Icon: Microscope, label: 'SubjectSymbolMicroscope' },
  calculator: { Icon: Calculator, label: 'SubjectSymbolCalculator' },
  sigma: { Icon: Sigma, label: 'SubjectSymbolSigma' },
  chart: { Icon: ChartNoAxesCombined, label: 'SubjectSymbolChart' },
  globe: { Icon: Globe, label: 'SubjectSymbolGlobe' },
  landmark: { Icon: Landmark, label: 'SubjectSymbolLandmark' },
  languages: { Icon: Languages, label: 'SubjectSymbolLanguages' },
  palette: { Icon: Palette, label: 'SubjectSymbolPalette' },
  music: { Icon: Music, label: 'SubjectSymbolMusic' },
  code: { Icon: Code, label: 'SubjectSymbolCode' },
  cpu: { Icon: Cpu, label: 'SubjectSymbolCpu' },
  rocket: { Icon: Rocket, label: 'SubjectSymbolRocket' },
  leaf: { Icon: Leaf, label: 'SubjectSymbolLeaf' },
  heart: { Icon: Heart, label: 'SubjectSymbolHeart' },
  brain: { Icon: Brain, label: 'SubjectSymbolBrain' },
  sparkles: { Icon: Sparkles, label: 'SubjectSymbolSparkles' },
  compass: { Icon: Compass, label: 'SubjectSymbolCompass' }
} as const satisfies Record<
  (typeof projectSymbols)[number],
  { Icon: LucideIcon; label: StaticMessageKey }
>;

export const subjectColors = {
  neutral: 'SubjectColorNeutral',
  red: 'SubjectColorRed',
  orange: 'SubjectColorOrange',
  amber: 'SubjectColorAmber',
  green: 'SubjectColorGreen',
  teal: 'SubjectColorTeal',
  blue: 'SubjectColorBlue',
  violet: 'SubjectColorViolet',
  pink: 'SubjectColorPink'
} as const satisfies Record<(typeof projectIconColors)[number], StaticMessageKey>;
