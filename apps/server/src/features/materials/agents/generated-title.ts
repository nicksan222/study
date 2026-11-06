/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Adds an automatically generated title to existing material agent outputs.          │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Preserves existing tools, providers and material generation instructions.              │
 * │ - Requires a bounded title alongside generated content in one response.                  │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ The workflow invokes the shared agent platform and owns publication fencing.             │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

export const titleInstructions =
  "Return the material under content and a concise, specific title under title. Derive the title from the captured evidence and the student's requested focus. Write the title in the same language as the material. Do not repeat the placeholder title, include citation markers in the title, or add quotation marks around it.";
