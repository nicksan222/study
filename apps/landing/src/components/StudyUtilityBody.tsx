import { defaultAppearancePreferences } from '@study/contracts/settings/types';
import { CompletedIcon, PageIcon, NoteIcon } from '@study/icons';
import {
  createLocalization,
  structuredEditorLabels,
  interfaceControlLabels
} from '@study/localization';
import { utilityExampleCopy } from '@study/localization/landing';
import { ColorSchemeControls, InterfaceControls } from '@study/ui/appearance-controls';
import { ExecutionLog } from '@study/ui/execution-log';
import { RichNoteContent } from '@study/ui/rich-note';
import { Sidebar } from '@study/ui/sidebar';
import { SidebarSearchResults } from '@study/ui/sidebar-search-results';
import { SourceContent } from '@study/ui/source-content';
import { StructuredEditor } from '@study/ui/structured-editor';
import type { StructuredEditorValue } from '@study/ui/structured-editor';
import { useState, useSyncExternalStore } from 'react';

export type UtilityKind = 'sources' | 'search' | 'settings' | 'activity';

export interface StudyUtilityProps {
  lang: 'en' | 'it';
  kind: UtilityKind;
}

type ExampleProps = { lang: 'en' | 'it'; ready: boolean };

const subscribe = () => () => {};

const clientSnapshot = () => true;

const serverSnapshot = () => false;

function sourceValue(heading: string, body: string): StructuredEditorValue {
  return {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: heading }] },
      { type: 'paragraph', content: [{ type: 'text', text: body }] }
    ]
  };
}

function SourceExample({ lang, ready }: ExampleProps) {
  const c = utilityExampleCopy[lang];
  const { t } = createLocalization(lang === 'it' ? 'italian' : 'english');
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(() => sourceValue(c.source.heading, c.source.body));

  return (
    <SourceContent
      copyLabel={t('PageEditCopy')}
      pending={!ready || editing}
      onCopy={() => setEditing(true)}
    >
      {ready ? (
        <StructuredEditor
          value={value}
          onChange={setValue}
          readOnly={!editing}
          label={t('NotePageEditor')}
          placeholder={t('NotePagePlaceholder')}
          labels={structuredEditorLabels(t)}
        />
      ) : (
        <RichNoteContent value={`### ${c.source.heading}\n\n${c.source.body}`} />
      )}
    </SourceContent>
  );
}

function SearchExample({ lang }: ExampleProps) {
  const c = utilityExampleCopy[lang];
  const { t } = createLocalization(lang === 'it' ? 'italian' : 'english');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<number>();
  const hits = c.material
    .map((item, index) => ({ ...item, index }))
    .filter((item) =>
      `${item.title} ${item.body}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
    );

  return (
    <>
      <Sidebar.Search
        aria-label={t('Search')}
        placeholder={t('Search')}
        value={query}
        onValueChange={setQuery}
        clearLabel={t('SearchClose')}
        onClear={() => setQuery('')}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setQuery('');
        }}
      />
      <SidebarSearchResults
        render={<div role="group" />}
        label={t('Search')}
        pending={false}
        feedback={
          !hits.length ? <Sidebar.Message role="status">{c.noResults}</Sidebar.Message> : undefined
        }
        items={hits.map((item) => ({
          key: String(item.index),
          title: item.title,
          excerpt: item.body,
          context: item.kind,
          icon:
            item.index === 1 ? <NoteIcon aria-hidden="true" /> : <PageIcon aria-hidden="true" />,
          render: (
            <button
              type="button"
              aria-label={`${item.kind} ${item.title} ${item.body}`}
              onClick={() => setSelected(item.index)}
            />
          )
        }))}
      />
      {selected !== undefined && (
        <RichNoteContent
          value={`### ${c.material[selected].title}\n\n${c.material[selected].body}`}
        />
      )}
    </>
  );
}

function SettingsExample({ lang, ready }: ExampleProps) {
  const { t } = createLocalization(lang === 'it' ? 'italian' : 'english');
  const [mode, setMode] = useState<'system' | 'light' | 'dark'>('dark');
  const [preferences, setPreferences] = useState(defaultAppearancePreferences);
  const [zoom, setZoom] = useState(100);

  return (
    <>
      <ColorSchemeControls
        title={t('ColorScheme')}
        label={t('ColorScheme')}
        theme={{}}
        disabled={!ready}
        onSelect={setMode}
        choices={(['system', 'light', 'dark'] as const).map((value) => ({
          value,
          selected: mode === value,
          label: t(value === 'system' ? 'SystemAppearance' : value === 'light' ? 'Light' : 'Dark')
        }))}
      />
      <InterfaceControls
        title={t('InterfaceSettings')}
        disabled={!ready}
        labels={interfaceControlLabels(t)}
        values={{ ...preferences, zoom }}
        defaults={{ ...defaultAppearancePreferences, zoom: 100 }}
        onCommit={(key, value) => {
          if (key === 'zoom') setZoom(value);
          else setPreferences((previous) => ({ ...previous, [key]: value }));
        }}
      />
    </>
  );
}

function ActivityExample({ lang }: ExampleProps) {
  const { t, date } = createLocalization(lang === 'it' ? 'italian' : 'english');
  const timestamp = 1_794_816_000;

  return (
    <ExecutionLog
      label={t('NotePromptWork')}
      pendingLabel={t('NotePending')}
      items={[
        {
          id: 'sample-transform',
          title: t('NoteWorkTransform'),
          status: t('workspace.state.completed'),
          icon: <CompletedIcon aria-hidden="true" />,
          metadata: [
            { label: t('NoteWorkStarted'), value: date(timestamp, { timeZone: 'UTC' }) },
            { label: t('NoteWorkUpdated'), value: date(timestamp + 8, { timeZone: 'UTC' }) },
            { label: t('NoteWorkElapsed'), value: t('NoteWorkSeconds', { seconds: 8n }) }
          ]
        }
      ]}
    />
  );
}

const examples = {
  sources: SourceExample,
  search: SearchExample,
  settings: SettingsExample,
  activity: ActivityExample
};

export function StudyUtilityBody({ lang, kind }: StudyUtilityProps) {
  const ready = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  const c = utilityExampleCopy[lang];
  const Content = examples[kind];

  return (
    <div className="study-example" data-study-utility={kind}>
      <div className="example-body">
        <Content lang={lang} ready={ready} />
      </div>
      <p className="example-disclosure">{c.sample}</p>
    </div>
  );
}
