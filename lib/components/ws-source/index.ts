import debug from 'debug'
import { Source } from '../component'
import { Readable, Writable } from 'stream'
import { MessageType } from '../message'
import { openWebSocket, WSConfig } from './openwebsocket'

export class WSSource extends Source {
  private readonly _socket: WebSocket
  public onSocketClose?: (
    code: number,
    reason: string,
    wasClean: boolean,
  ) => void

  /**
   * Create a WebSocket component.
   *
   * The constructor sets up two streams and connects them to the socket as
   * soon as the socket is available (and open).
   *
   * @param socket - an open WebSocket.
   */
  constructor(socket: WebSocket) {
    if (socket === undefined) {
      throw new Error('socket argument missing')
    }

    /**
     * Set up an incoming stream and attach it to the socket.
     * @type {Readable}
     */
    const incoming = new Readable({
      objectMode: true,
      read: function () {
        //
      },
    })

    socket.onmessage = (msg) => {
      const buffer = Buffer.from(msg.data)
      if (!incoming.push({ data: buffer, type: MessageType.RAW })) {
        // Something happened down stream that it is no longer processing the
        // incoming data, and the stream buffer got full. In this case it is
        // best to just close the socket instead of throwing away data in the
        // hope that the situation will get resolved.
        if (socket.readyState === WebSocket.OPEN) {
          debug('msl:websocket:incoming')('downstream frozen')
          socket.close()
        }
      }
    }

    // When an error is sent on the incoming stream, close the socket.
    incoming.on('error', (e) => {
      console.warn('closing socket due to incoming error', e)
      socket.close()
    })

    /**
     * Set up outgoing stream and attach it to the socket.
     * @type {Writable}
     */
    const outgoing = new Writable({
      objectMode: true,
      write: function (msg, encoding, callback) {
        try {
          socket.send(msg.data)
        } catch (e) {
          console.warn('message lost during send:', msg)
        }
        callback()
      },
    })

    // When an error happens on the outgoing stream, just warn.
    outgoing.on('error', (e) => {
      console.warn('error during websocket send, ignoring:', e)
    })

    // When there is no more data going to be written, close!
    outgoing.on('finish', () => {
      debug('msl:websocket:outgoing')('finish')
      if (socket.readyState !== WebSocket.CLOSED) {
        socket.close()
      }
    })

    /**
     * Handler for when WebSocket is CLOSED
     * @param  e - The event associated with a close
     * @param  e.code The status code sent by the server
     *   Possible codes are documented here:
     *   https://developer.mozilla.org/en-US/docs/Web/API/CloseEvent
     */
    socket.onclose = (e) => {
      debug('msl:websocket:close')(`${e.code}`)
      this.onSocketClose && this.onSocketClose(e.code, e.reason, e.wasClean)
      // Terminate the streams.
      incoming.push(null)
      outgoing.end()
    }

    /**
     * initialize the component.
     */
    super(incoming, outgoing)

    this._socket = socket
  }

  get socketState() {
    return this._socket.readyState
  }

  /**
   * Expose websocket opener as a class method that returns a promise which
   * resolves with a new WebSocketComponent.
   */
  static async open(config?: WSConfig) {
    return await openWebSocket(config).then((socket) => new WSSource(socket))
  }
}
