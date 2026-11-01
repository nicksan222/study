/** Keep the object URL alive while the browser opens its download stream. */
export function downloadFile(filename: string, contents: Blob): void {
  const url = URL.createObjectURL(contents);
  const anchor = document.createElement('a');

  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
