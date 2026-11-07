/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Registers the available conversion implementations in one canonical location.      │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Connects concrete conversion implementations to shared discovery and dispatch.         │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Feature services expose capabilities while workflow activities own execution.            │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { chatGptConversion } from './chatgpt.ts';
import { makeConversionRegistry } from './registry.ts';

export const conversions = makeConversionRegistry([chatGptConversion]);
