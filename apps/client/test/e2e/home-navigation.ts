import { catalogs } from '@study/localization';

const copy = catalogs.english;

/** The same navigation and assertions run in Chromium and in the desktop WebView. */
export async function homeNavigation(driver: {
  goto: (path: string) => Promise<unknown>;
  expectPath: (path: string) => Promise<void>;
  click: (role: 'combobox' | 'link', name: string) => Promise<void>;
  expectHeading: (name: string) => Promise<void>;
}) {
  await driver.goto('/home');
  await driver.expectPath('/notes');
  await driver.click('combobox', copy.ChooseProject);
  await driver.click('link', copy.Projects);
  await driver.expectPath('/projects');
  await driver.expectHeading(copy.Projects);
}
