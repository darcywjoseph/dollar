/** Wire encoding for binary values inside JSON: `{ "$bin": "<base64>" }`.
 *  The client encodes ArrayBuffer/Uint8Array args this way; the server decodes
 *  them back to Buffers before dispatching to a handler. */

export interface BinaryMarker {
  $bin: string
}

function isBinaryMarker(value: object): value is BinaryMarker {
  const obj = value as Record<string, unknown>
  return typeof obj.$bin === 'string' && Object.keys(obj).length === 1
}

/** Recursively replace `{ $bin }` markers with Buffers. Leaves everything else
 *  untouched. Input is freshly parsed JSON, so it never contains real Buffers. */
export function decodeBinary(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(decodeBinary)
  if (isBinaryMarker(value)) return Buffer.from((value as BinaryMarker).$bin, 'base64')
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value)) out[k] = decodeBinary(v)
  return out
}
