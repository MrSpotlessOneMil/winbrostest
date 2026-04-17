export function extractJsonObject(raw: string): string {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')

  if (start === -1 || end === -1 || end <= start) {
    return raw
  }

  return raw.slice(start, end + 1)
}

export function safeJsonParse<T>(
  raw: string
): { value: T | null; repaired: boolean; error?: string } {
  try {
    return { value: JSON.parse(raw) as T, repaired: false }
  } catch (error) {
    const repaired = repairInvalidJsonEscapes(raw)
    if (repaired !== raw) {
      try {
        return { value: JSON.parse(repaired) as T, repaired: true }
      } catch (repairedError) {
        return {
          value: null,
          repaired: true,
          error: repairedError instanceof Error ? repairedError.message : 'Unknown error',
        }
      }
    }

    return {
      value: null,
      repaired: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

function repairInvalidJsonEscapes(raw: string): string {
  let output = ''
  let inString = false
  let escape = false

  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i]

    if (!inString) {
      if (char === '"') {
        inString = true
      }
      output += char
      continue
    }

    if (escape) {
      escape = false
      output += char
      continue
    }

    if (char === '\\') {
      const next = raw[i + 1]
      if (!next) {
        output += '\\\\'
        continue
      }

      if (next === 'u') {
        const hex = raw.slice(i + 2, i + 6)
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
          output += '\\\\'
          continue
        }
      } else if (!isValidEscape(next)) {
        output += '\\\\'
        continue
      }

      escape = true
      output += char
      continue
    }

    if (char === '"') {
      inString = false
      output += char
      continue
    }

    if (char === '\n') {
      output += '\\n'
      continue
    }

    if (char === '\r') {
      output += '\\r'
      continue
    }

    if (char === '\t') {
      output += '\\t'
      continue
    }

    output += char
  }

  return output
}

function isValidEscape(char: string): boolean {
  return char === '"' ||
    char === '\\' ||
    char === '/' ||
    char === 'b' ||
    char === 'f' ||
    char === 'n' ||
    char === 'r' ||
    char === 't' ||
    char === 'u'
}
