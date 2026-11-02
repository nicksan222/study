/** Keep the object URL alive while the browser opens its download stream. */
export function downloadFile(
  filename: string,
  contents: Blob,
  options?: { revokeAfterMs?: number; attach?: boolean }
): void {
  const url = URL.createObjectURL(contents);
  const anchor = document.createElement('a');

  try {
    anchor.href = url;
    anchor.download = filename;

    if (options?.attach) document.body.append(anchor);

    anchor.click();
  } finally {
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), options?.revokeAfterMs ?? 30000);
  }
}
