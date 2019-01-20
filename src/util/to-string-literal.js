import CHAR_CODE from "../constant/char-code.js"

import toString from "./to-string.js"
import shared from "../shared.js"
import stripQuotes from "./strip-quotes.js"

function init() {
  const {
    QUOTE
  } = CHAR_CODE

  const separatorsRegExp = /[\u2028\u2029]/g

  const escapeRegExpMap = new Map([
    ['"', /\\?"/g],
    ["'", /\\?'/g]
  ])

  const escapedSeparatorsMap = new Map([
    ["\u2028", "\\u2028"],
    ["\u2029", "\\u2029"]
  ])

  function toStringLiteral(value, quote = '"') {
    let string = JSON.stringify(value)

    if (typeof string !== "string") {
      string = toString(value)
    }

    string = string.replace(separatorsRegExp, replaceSeparators)

    if (quote === '"' &&
        string.charCodeAt(0) === QUOTE) {
      return string
    }

    const unquoted = stripQuotes(string)
    const escaped = unquoted.replace(escapeRegExpMap.get(quote), "\\" + quote)

    return quote + escaped + quote
  }

  function replaceSeparators(match) {
    return "\\" + escapedSeparatorsMap.get(match)
  }

  return toStringLiteral
}

export default shared.inited
  ? shared.module.utilToStringLiteral
  : shared.module.utilToStringLiteral = init()
