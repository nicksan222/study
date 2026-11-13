/** Fonts and browser provisioning remain the canonical devcontainer's responsibility. */
export function assertCapturePlatform(
  platform: string = process.platform,
  architecture: string = process.arch
): void {
  if (platform !== 'linux' || architecture !== 'x64')
    throw new Error(
      `E2E screenshots require the Linux x64 devcontainer; received ${platform}/${architecture}`
    );
}
