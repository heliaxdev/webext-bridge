import { Endpoint, RuntimeContext } from './types'

const ENDPOINT_RE = /^((?:background$)|devtools|popup|options|content-script|window)(?:@(\d+))?$/

export const parseEndpoint = (endpoint: string): Endpoint => {
  const [, context, tabId] = endpoint.match(ENDPOINT_RE) || []

  return {
    context: context as RuntimeContext,
    tabId: +tabId,
  }
}

export const isInternalEndpoint = ({ context: ctx }: Endpoint): boolean => ['content-script', 'background', 'devtools'].includes(ctx)
