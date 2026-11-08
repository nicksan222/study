/** Only retired study-domain modules; source Documents and provider sessions remain canonical. */
export function retiredStudyPath(path: string): boolean {
  const normalized = path.replaceAll('\\', '/');
  const module =
    /^(?:@study\/contracts\/(?:conversations|documents)|#server\/features\/(?:conversations|documents)|#web\/features\/(?:session-workspace|authored-documents)|@study\/ui\/(?:session-workspace|session-start))(?:\/|\.|$)/;
  const file =
    /\/(?:apps\/server\/src\/features\/(?:conversations|documents)|apps\/web\/src\/features\/(?:session-workspace|authored-documents)|packages\/contracts\/src\/(?:conversations|documents)|packages\/ui\/src\/(?:components\/)?(?:session-workspace|session-start|document-overview))(?:\/|\.|$)/;

  return module.test(normalized) || file.test(normalized);
}
