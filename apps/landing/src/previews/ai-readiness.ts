/** Build-only readiness: static fixture previews never query private account settings. */
export function useAiReadiness() {
  return 'ready' as const;
}
