/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Pins Voz web graphs shared by the Node ONNX pipeline.                              │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Validates typed inputs and preserves explicit operation ownership.                     │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Keeps application policy outside shared inference and persistence mechanisms.            │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

export const vozModel = {
  name: 'desert-ant-labs/voz',
  revision: 'v0.5.0',
  identity: 'desert-ant-voz:4.3.0:v0.5.0:web',
  files: [
    {
      path: 'web/decoder.onnx',
      bytes: 24472430,
      sha256: '9bf9cb1557f98ab2e5b3ff982fa605827354efc20f2b247c722cab9adf10bd4f'
    },
    {
      path: 'web/decoder.webgpu.onnx',
      bytes: 24472430,
      sha256: 'e80bef7b3b1984cb6f11fd057b2dc1f1af8db6aecadbce8c00a6e705ac349cad'
    },
    {
      path: 'web/embedding.f16',
      bytes: 10487040,
      sha256: '07163e5f6f8a68f9ffeed7a8ff770c68098c2db216232321912188bd614b9a72'
    },
    {
      path: 'web/encoder.onnx',
      bytes: 813056,
      sha256: 'ac316927d8b4d726932ea876617447847a57e35b2053db6b42db6868a91f8f05'
    },
    {
      path: 'web/encoder.onnx.data',
      bytes: 348981248,
      sha256: '3338df284d31ba23e94ef8f0c397e7fa69a36dc634b4569a4739f94d72a38228'
    },
    {
      path: 'web/meta.json',
      bytes: 539,
      sha256: '2fb6b111dcf4f2477d7ff7699b2374c5f7194ae5fa20ef2a06f121c243119a37'
    },
    {
      path: 'web/vocab.json',
      bytes: 78654,
      sha256: '3eb2f73e8853dce5156c2ed97c0b1bb84eb4ebd201eb1761d15977fc1ea31490'
    }
  ]
} as const;
