import { semanticPart as part } from './semantic-part';

/** Material selection layout, with a compact preview and optional full reading view. */
export const SelectionSurface = {
  Root: part('div', 'ui-selection'),
  Heading: part('div', 'ui-selection-heading'),
  Included: part('ul', 'ui-selection-included'),
  Empty: part('div', 'ui-selection-empty'),
  Save: part('div', 'ui-selection-save'),
  SaveActions: part('div', 'ui-selection-save-actions'),
  Catalog: part('section', 'ui-selection-catalog'),
  Group: part('section', 'ui-selection-group'),
  Materials: part('ul', 'ui-selection-materials'),
  Disclosure: part('details', 'ui-selection-disclosure'),
  Editor: part('div', 'ui-selection-editor'),
  Content: part('div', 'ui-selection-content'),
  Blocks: part('ul', 'ui-selection-blocks'),
  Excerpt: part('div', 'ui-selection-excerpt'),
  FullContent: part('div', 'ui-selection-full-content')
};
