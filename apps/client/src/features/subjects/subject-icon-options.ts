import type { projectSymbols, projectIconColors } from '@study/contracts/projects/schemas';
import {
  BookIcon,
  NotebookIcon,
  FolderIcon,
  GraduationCapIcon,
  AtomIcon,
  ChemistryIcon,
  DnaIcon,
  MicroscopeIcon,
  CalculatorIcon,
  SigmaIcon,
  ChartIcon,
  GlobeIcon,
  LandmarkIcon,
  LanguagesIcon,
  PaletteIcon,
  MusicIcon,
  CodeIcon,
  CpuIcon,
  RocketIcon,
  LeafIcon,
  HeartIcon,
  BrainIcon,
  SparklesIcon,
  CompassIcon
} from '@study/icons';
import type { IconComponent } from '@study/icons';
import type { StaticMessageKey } from '@study/localization';

export const subjectSymbols = {
  book: { Icon: BookIcon, label: 'SubjectSymbolBook' },
  notebook: { Icon: NotebookIcon, label: 'SubjectSymbolNotebook' },
  folder: { Icon: FolderIcon, label: 'SubjectSymbolFolder' },
  'graduation-cap': { Icon: GraduationCapIcon, label: 'SubjectSymbolGraduation' },
  atom: { Icon: AtomIcon, label: 'SubjectSymbolAtom' },
  flask: { Icon: ChemistryIcon, label: 'SubjectSymbolFlask' },
  dna: { Icon: DnaIcon, label: 'SubjectSymbolDna' },
  microscope: { Icon: MicroscopeIcon, label: 'SubjectSymbolMicroscope' },
  calculator: { Icon: CalculatorIcon, label: 'SubjectSymbolCalculator' },
  sigma: { Icon: SigmaIcon, label: 'SubjectSymbolSigma' },
  chart: { Icon: ChartIcon, label: 'SubjectSymbolChart' },
  globe: { Icon: GlobeIcon, label: 'SubjectSymbolGlobe' },
  landmark: { Icon: LandmarkIcon, label: 'SubjectSymbolLandmark' },
  languages: { Icon: LanguagesIcon, label: 'SubjectSymbolLanguages' },
  palette: { Icon: PaletteIcon, label: 'SubjectSymbolPalette' },
  music: { Icon: MusicIcon, label: 'SubjectSymbolMusic' },
  code: { Icon: CodeIcon, label: 'SubjectSymbolCode' },
  cpu: { Icon: CpuIcon, label: 'SubjectSymbolCpu' },
  rocket: { Icon: RocketIcon, label: 'SubjectSymbolRocket' },
  leaf: { Icon: LeafIcon, label: 'SubjectSymbolLeaf' },
  heart: { Icon: HeartIcon, label: 'SubjectSymbolHeart' },
  brain: { Icon: BrainIcon, label: 'SubjectSymbolBrain' },
  sparkles: { Icon: SparklesIcon, label: 'SubjectSymbolSparkles' },
  compass: { Icon: CompassIcon, label: 'SubjectSymbolCompass' }
} as const satisfies Record<
  (typeof projectSymbols)[number],
  { Icon: IconComponent; label: StaticMessageKey }
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
