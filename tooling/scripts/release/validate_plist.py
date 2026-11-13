"""Validate the microphone metadata extracted from a signed macOS bundle."""
import plistlib
import sys

with open(sys.argv[1], 'rb') as source:
    entitlements = plistlib.load(source)
with open(sys.argv[2], 'rb') as source:
    info = plistlib.load(source)
if entitlements.get('com.apple.security.device.audio-input') is not True or not isinstance(info.get('NSMicrophoneUsageDescription'), str) or not info['NSMicrophoneUsageDescription'].strip():
    sys.exit('macOS microphone entitlement or privacy description is missing')
