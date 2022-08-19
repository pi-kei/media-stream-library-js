/*
 * The RTSP response format is defined in RFC 7826,
 * using ABNF notation specified in RFC 5234.
 * Strings in ABNF rules ("...") are always case insensitive!
 *
 * Basic rules to help with the headers below:
 * ====
 * CR              =  %x0D ; US-ASCII CR, carriage return (13)
 * LF              =  %x0A  ; US-ASCII LF, linefeed (10)
 * SP              =  %x20  ; US-ASCII SP, space (32)
 * HT              =  %x09  ; US-ASCII HT, horizontal-tab (9)
 * CRLF            =  CR LF
 * LWS             =  [CRLF] 1*( SP / HT ) ; Line-breaking whitespace
 * SWS             =  [LWS] ; Separating whitespace
 * HCOLON          =  *( SP / HT ) ":" SWS
 *
 * RTSP response rules (a `*` means zero or more):
 * ====
 * Status-Line  = RTSP-Version SP Status-Code SP Reason-Phrase CRLF
 * Response     = Status-Line
 *                *((general-header
 *                /  response-header
 *                /  message-body-header) CRLF)
 *                CRLF
 *                [ message-body-data ]
 *
 * Example response:
 * ====
 * RTSP/1.0 200 OK
 * CSeq: 3
 * Content-Type: application/sdp
 * Content-Base: rtsp://192.168.0.3/axis-media/media.amp/
 * Server: GStreamer RTSP server
 * Date: Wed, 03 Jun 2015 14:23:42 GMT
 * Content-Length: 623
 *
 * v=0
 * ....
 */

/**
 * Extract the value of a header.
 *
 * @param buffer The response bytes
 * @param header The header to search for
 */
export const extractHeaderValue = (buffer: Buffer, header: string) => {
  const anchor = `\n${header.toLowerCase()}: `
  const start = buffer.toString().toLowerCase().indexOf(anchor)
  if (start >= 0) {
    const end = buffer.indexOf('\n', start + anchor.length)
    const headerValue = buffer
      .toString('ascii', start + anchor.length, end)
      .trim()
    return headerValue
  }
  return null
}

export const sequence = (buffer: Buffer) => {
  /**
   * CSeq           =  "CSeq" HCOLON cseq-nr
   * cseq-nr        =  1*9DIGIT
   */
  const val = extractHeaderValue(buffer, 'CSeq')
  if (val !== null) {
    return Number(val)
  }
  return null
}

export const sessionId = (buffer: Buffer) => {
  /**
   * Session          =  "Session" HCOLON session-id
   *                     [ SEMI "timeout" EQUAL delta-seconds ]
   * session-id        =  1*256( ALPHA / DIGIT / safe )
   * delta-seconds     =  1*19DIGIT
   */
  const val = extractHeaderValue(buffer, 'Session')
  return val ? val.split(';')[0] : null
}

export const sessionTimeout = (buffer: Buffer) => {
  /**
   * Session          =  "Session" HCOLON session-id
   *                     [ SEMI "timeout" EQUAL delta-seconds ]
   * session-id        =  1*256( ALPHA / DIGIT / safe )
   * delta-seconds     =  1*19DIGIT
   */
  const val = extractHeaderValue(buffer, 'Session')
  if (val === null) {
    return null
  }
  const defaultTimeout = 60
  const timeoutToken = 'timeout='
  const timeoutPosition = val.toLowerCase().indexOf(timeoutToken)
  if (timeoutPosition !== -1) {
    let timeoutVal = val.substring(timeoutPosition + timeoutToken.length)
    timeoutVal = timeoutVal.split(';')[0]
    const parsedTimeout = parseInt(timeoutVal)
    return isNaN(parsedTimeout) ? defaultTimeout : parsedTimeout
  }
  return defaultTimeout
}

export const statusCode = (buffer: Buffer) => {
  return Number(buffer.toString('ascii', 9, 12))
}

export const contentBase = (buffer: Buffer) => {
  /**
   * Content-Base       =  "Content-Base" HCOLON RTSP-URI
   */
  return extractHeaderValue(buffer, 'Content-Base')
}

export const contentLocation = (buffer: Buffer) => {
  /**
   * Content-Location   =  "Content-Location" HCOLON RTSP-REQ-Ref
   */
  return extractHeaderValue(buffer, 'Content-Location')
}

export const connectionEnded = (buffer: Buffer) => {
  /**
   * Connection         =  "Connection" HCOLON connection-token
   *                       *(COMMA connection-token)
   * connection-token   =  "close" / token
   */
  const connectionToken = extractHeaderValue(buffer, 'Connection')
  return connectionToken !== null && connectionToken.toLowerCase() === 'close'
}

const splitOnFirst = (c: string, text: string) => {
  const p = text.indexOf(c)
  if (p < 0) {
    return [text.slice(0)]
  } else {
    return [text.slice(0, p), text.slice(p + 1)]
  }
}

/**
 * @see https://www.rfc-editor.org/rfc/rfc2326.html#section-3.6
 * @param value String value of start or end of the range.
 * @param isStart When true empty value means 0.
 * @returns Amount of seconds.
 */
const parseNptSecs = (value: string, isStart: boolean = false): number => {
  if (isStart && !value) {
    return 0
  } else if (!value || value === 'now') {
    return NaN
  }
  const match = value.match(/^(((\d+):)?(\d+):)?(\d+(\.\d+)?)$/)
  if (!match) {
    return NaN
  }
  let secs = Number(match[5])
  if (match[4]) {
    secs += Number(match[4]) * 60
  }
  if (match[3]) {
    secs += Number(match[3]) * 60 * 60
  }
  return secs
}

/**
 * @see https://www.rfc-editor.org/rfc/rfc2326.html#section-3.7
 * @param value String value of start or end of the range.
 * @returns Returns the same as {@link Date#valueOf}
 */
const parseUtcTime = (value: string): number => {
  if (!value) {
    return NaN
  }
  return new Date(
    value.replace(
      /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\.(\d+))?Z$/,
      '$1-$2-$3T$4:$5:$6$7Z',
    ),
  ).valueOf()
}

export const range = (buffer: Buffer) => {
  /**
   * Range              =  "Range" HCOLON ranges-spec
   * ranges-spec        =  npt-range / utc-range / smpte-range
   *                       /  range-ext
   * npt-range        =  "npt" [EQUAL npt-range-spec]
   * npt-range-spec   =  ( npt-time "-" [ npt-time ] ) / ( "-" npt-time )
   * npt-time         =  "now" / npt-sec / npt-hhmmss / npt-hhmmss-comp
   * npt-sec          =  1*19DIGIT [ "." 1*9DIGIT ]
   * npt-hhmmss       =  npt-hh ":" npt-mm ":" npt-ss [ "." 1*9DIGIT ]
   * npt-hh           =  2*19DIGIT   ; any positive number
   * npt-mm           =  2*2DIGIT  ; 0-59
   * npt-ss           =  2*2DIGIT  ; 0-59
   * npt-hhmmss-comp  =  npt-hh-comp ":" npt-mm-comp ":" npt-ss-comp
   *                     [ "." 1*9DIGIT ] ; Compatibility format
   * npt-hh-comp      =  1*19DIGIT   ; any positive number
   * npt-mm-comp      =  1*2DIGIT  ; 0-59
   * npt-ss-comp      =  1*2DIGIT  ; 0-59
   */

  // Example range headers:
  // Range: npt=now-
  // Range: npt=1154.598701-3610.259146
  const value = extractHeaderValue(buffer, 'Range')
  if (value !== null) {
    const [unit, range] = splitOnFirst('=', value)
    const [start, end] = range.split('-')
    const output: {
      unit: string
      rawStart: string
      rawEnd: string
      start?: number
      end?: number
    } = {
      unit,
      rawStart: start,
      rawEnd: end,
    }
    if (unit === 'npt') {
      output.start = parseNptSecs(start, true)
      output.end = parseNptSecs(end)
    } else if (unit === 'clock') {
      output.start = parseUtcTime(start)
      output.end = parseUtcTime(end)
    }
    // SMPTE (not parsed)
    return output
  }
  return undefined
}

/**
 * Determine the offset of the RTSP body, where the header ends.
 * If there is no header ending, -1 is returned
 * @param  chunk - A piece of data
 * @return The body offset, or -1 if no header end found
 */
export const bodyOffset = (chunk: Buffer) => {
  /**
   * Strictly speaking, it seems RTSP MUST have CRLF and doesn't allow CR or LF on its own.
   * That means that the end of the header part should be a pair of CRLF, but we're being
   * flexible here and also allow LF LF or CR CR instead of CRLF CRLF.
   */
  const bodyOffsets = ['\n\n', '\r\r', '\r\n\r\n']
    .map((s) => {
      const offset = chunk.indexOf(s)
      if (offset !== -1) {
        return offset + s.length
      }
      return offset
    })
    .filter((offset) => offset !== -1)
  if (bodyOffsets.length > 0) {
    return bodyOffsets.reduce((acc, offset) => {
      return Math.min(acc, offset)
    })
  } else {
    return -1
  }
}
