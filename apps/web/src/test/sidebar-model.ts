import { createRef } from 'react';

import type { SidebarModel } from '../app/shell/use-sidebar';

const noop = () => {};

export function sidebarModel(): SidebarModel {
  return {
    replay: null,
    settingsProject: undefined,
    setSettingsProject: noop,
    metadata: { title: 'Sessions', section: 'sessions', scope: 'project' },
    collapsed: false,
    onToggle: noop,
    requestedProject: null,
    global: false,
    section: 'sessions',
    subjects: [],
    subject: undefined,
    subjectState: 'ready',
    project: undefined,
    invalidSubject: false,
    sessions: [],
    sessionState: 'ready',
    pickerOpen: false,
    setPickerOpen: noop,
    query: '',
    setQuery: noop,
    newSubjectOpen: false,
    setNewSubjectOpen: noop,
    name: '',
    setName: noop,
    actionError: false,
    setActionError: noop,
    creating: false,
    searchRef: createRef<HTMLInputElement>(),
    canSearch: true,
    result: undefined,
    hits: [],
    openSearch: noop,
    clearSearch: noop,
    selectSubject: noop,
    createSession: async () => {},
    createSubject: async () => {},
    reloadSubjects: noop,
    reloadSessions: noop
  };
}
