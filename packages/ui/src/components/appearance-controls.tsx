import type { ThemeFile } from '../theme';
import { Settings } from './settings';
import { ThemeWireframe } from './theme-preview';

export function ColorSchemeControls({
  title,
  label,
  choices,
  theme,
  disabled,
  onSelect
}: {
  title?: string;
  label: string;
  choices: readonly { value: 'system' | 'light' | 'dark'; label: string; selected: boolean }[];
  theme: ThemeFile | Record<string, never>;
  disabled: boolean;
  onSelect: (value: 'system' | 'light' | 'dark') => void;
}) {
  return (
    <Settings.Section variant="color-scheme" title={title}>
      <Settings.ChoiceGroup label={label}>
        {choices.map((choice) => (
          <Settings.Choice
            key={choice.value}
            label={choice.label}
            selected={choice.selected}
            disabled={disabled}
            onSelect={() => onSelect(choice.value)}
          >
            <ThemeWireframe theme={theme} appearance={choice.value} />
          </Settings.Choice>
        ))}
      </Settings.ChoiceGroup>
    </Settings.Section>
  );
}

export type InterfaceControlKey = 'contrast' | 'glassOpacity' | 'animationDurationMs' | 'zoom';

export type InterfaceControlValues = Record<InterfaceControlKey, number>;

export type InterfaceControlLabels = Record<
  InterfaceControlKey,
  { title: string; description: string; resetLabel: string }
>;

const interfaceRanges = [
  { key: 'contrast', min: 75, max: 150, step: 5, suffix: '%' },
  { key: 'glassOpacity', min: 40, max: 100, step: 5, suffix: '%' },
  { key: 'animationDurationMs', min: 0, max: 400, step: 25, suffix: ' ms' },
  { key: 'zoom', min: 50, max: 200, step: 5 }
] as const;

/** Owns the application's appearance controls and their interaction ranges. */
export function InterfaceControls({
  title,
  labels,
  values,
  defaults,
  disabled,
  onCommit
}: {
  title: string;
  labels: InterfaceControlLabels;
  values: InterfaceControlValues;
  defaults: InterfaceControlValues;
  disabled: boolean;
  onCommit: (key: InterfaceControlKey, value: number) => void;
}) {
  return (
    <Settings.Section variant="interface" title={title}>
      <Settings.Group>
        {interfaceRanges.map(({ key, ...range }) => (
          <Settings.RangeRow
            key={key}
            {...range}
            {...labels[key]}
            value={values[key]}
            defaultValue={defaults[key]}
            disabled={disabled}
            onCommit={(value) => onCommit(key, value)}
          />
        ))}
      </Settings.Group>
    </Settings.Section>
  );
}
