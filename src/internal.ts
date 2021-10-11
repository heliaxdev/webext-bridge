import type { JsonValue } from 'type-fest'
import { serializeError } from 'serialize-error'
import uuid from 'tiny-uid'
import { RuntimeContext, OnMessageCallback, IInternalMessage, IBridgeMessage } from './types'

export const context: RuntimeContext = 'window'

const runtimeId: string = uuid()
export const openTransactions = new Map<string, { resolve: (v: void | JsonValue | PromiseLike<JsonValue>) => void; reject: (e: JsonValue) => void }>()
export const onMessageListeners = new Map<string, OnMessageCallback<JsonValue>>()

let namespace: string

initIntercoms()

export function setNamespace(nsps: string): void {
  namespace = nsps
}

function initIntercoms() {
  window.addEventListener('message', handleWindowOnMessage)
}

export function routeMessage(message: IInternalMessage): void | Promise<void> {
  const { destination } = message

  if (message.hops.includes(runtimeId))
    return

  message.hops.push(runtimeId)

  // if previous hop removed the destination before forwarding the message, then this itself is the recipient
  if (!destination)
    return handleInboundMessage(message)

  if (destination.context)
    return routeMessageThroughWindow(window, message)
}

async function handleInboundMessage(message: IInternalMessage) {
  const { transactionId, messageID, messageType } = message

  const handleReply = () => {
    const transactionP = openTransactions.get(transactionId)
    if (transactionP) {
      const { err, data } = message
      if (err) {
        const dehydratedErr = err as Record<string, string>
        const errCtr = self[dehydratedErr.name] as any
        const hydratedErr = new (typeof errCtr === 'function' ? errCtr : Error)(dehydratedErr.message)

        // eslint-disable-next-line no-restricted-syntax
        for (const prop in dehydratedErr)
          hydratedErr[prop] = dehydratedErr[prop]

        transactionP.reject(hydratedErr)
      }
      else {
        transactionP.resolve(data)
      }
      openTransactions.delete(transactionId)
    }
  }

  const handleNewMessage = async() => {
    let reply: JsonValue | void
    let err: Error
    let noHandlerFoundError = false

    try {
      const cb = onMessageListeners.get(messageID)
      if (typeof cb === 'function') {
        // eslint-disable-next-line node/no-callback-literal
        reply = await cb({
          sender: message.origin,
          id: messageID,
          data: message.data,
          timestamp: message.timestamp,
        } as IBridgeMessage<JsonValue>)
      }
      else {
        noHandlerFoundError = true
        throw new Error(`[webext-bridge] No handler registered in '${context}' to accept messages with id '${messageID}'`)
      }
    }
    catch (error) {
      err = error
    }
    finally {
      if (err) message.err = serializeError(err)

      routeMessage({
        ...message,
        messageType: 'reply',
        data: reply,
        origin: { context, tabId: null },
        destination: message.origin,
        hops: [],
      })

      if (err && !noHandlerFoundError)
        // eslint-disable-next-line no-unsafe-finally
        throw reply
    }
  }

  switch (messageType) {
    case 'reply': return handleReply()
    case 'message': return handleNewMessage()
  }
}

function assertInternalMessage(msg: any): asserts msg is IInternalMessage {}

async function handleWindowOnMessage({ data, ports }: MessageEvent) {
  if (data.cmd === '__crx_bridge_verify_listening' && data.scope === namespace && data.context !== context) {
    const msgPort: MessagePort = ports[0]
    msgPort.postMessage(true)
  }
  else if (data.cmd === '__crx_bridge_route_message' && data.scope === namespace && data.context !== context) {
    const { payload } = data
    assertInternalMessage(payload)

    routeMessage(payload)
  }
}

function routeMessageThroughWindow(win: Window, msg: IInternalMessage) {
  ensureNamespaceSet()

  const channel = new MessageChannel()
  const retry = setTimeout(() => {
    channel.port1.onmessage = null
    routeMessageThroughWindow(win, msg)
  }, 300)
  channel.port1.onmessage = () => {
    clearTimeout(retry)
    win.postMessage({
      cmd: '__crx_bridge_route_message',
      scope: namespace,
      context,
      payload: msg,
    }, '*')
  }
  win.postMessage({
    cmd: '__crx_bridge_verify_listening',
    scope: namespace,
    context,
  }, '*', [channel.port2])
}

function ensureNamespaceSet() {
  if (typeof namespace !== 'string' || namespace.length === 0) {
    throw new Error(
      'webext-bridge uses window.postMessage to talk with other "window"(s), for message routing and stuff,'
      + 'which is global/conflicting operation in case there are other scripts using webext-bridge. '
      + 'Call Bridge#setNamespace(nsps) to isolate your app. Example: setNamespace(\'com.facebook.react-devtools\'). '
      + 'Make sure to use same namespace across all your scripts whereever window.postMessage is likely to be used`',
    )
  }
}

export function getCurrentContext() {
  return context
}
