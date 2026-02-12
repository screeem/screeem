import { supabase } from '../supabase'
import type { StoredEvent } from '@screeem/shared/types/events'

const API_URL = import.meta.env.VITE_API_URL

export type EventHandler = (event: StoredEvent) => void

export class SSEClient {
  private eventSource: EventSource | null = null
  private handlers: Set<EventHandler> = new Set()
  private reconnectTimer: number | null = null
  private reconnectDelay = 1000
  private maxReconnectDelay = 30000

  constructor(
    private organizationId: string,
    private onError?: (error: Error) => void
  ) {}

  async connect() {
    // Get the current session token
    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (!session) {
      throw new Error('No active session')
    }

    // Close existing connection
    this.disconnect()

    // Create new EventSource connection
    const url = `${API_URL}/api/organizations/${this.organizationId}/posts/events`

    // EventSource doesn't support custom headers, so we pass the token as a query param
    const urlWithAuth = `${url}?access_token=${session.access_token}`

    this.eventSource = new EventSource(urlWithAuth)

    // Handle different event types
    this.eventSource.addEventListener('PostScheduled', this.handleEvent.bind(this))
    this.eventSource.addEventListener('PostUpdated', this.handleEvent.bind(this))
    this.eventSource.addEventListener('PostCancelled', this.handleEvent.bind(this))
    this.eventSource.addEventListener('PostPublishing', this.handleEvent.bind(this))
    this.eventSource.addEventListener('PostPublished', this.handleEvent.bind(this))
    this.eventSource.addEventListener('PostFailed', this.handleEvent.bind(this))

    // Handle connection events
    this.eventSource.onopen = () => {
      console.log('[SSE] Connected to event stream')
      this.reconnectDelay = 1000 // Reset reconnect delay on successful connection
    }

    this.eventSource.onerror = (error) => {
      console.error('[SSE] Connection error:', error)
      this.handleConnectionError()
    }
  }

  private handleEvent(messageEvent: MessageEvent) {
    try {
      const data = JSON.parse(messageEvent.data)
      const event: StoredEvent = {
        id: data.id,
        streamId: data.streamId,
        streamType: data.streamType,
        eventType: data.eventType,
        eventVersion: data.eventVersion || 1,
        payload: data.payload,
        metadata: data.metadata,
        sequence: data.sequence,
        streamSequence: data.streamSequence,
        createdAt: new Date(data.createdAt),
      }

      // Notify all handlers
      this.handlers.forEach((handler) => handler(event))
    } catch (error) {
      console.error('[SSE] Failed to parse event:', error)
    }
  }

  private handleConnectionError() {
    this.disconnect()

    // Attempt to reconnect with exponential backoff
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
    }

    this.reconnectTimer = setTimeout(() => {
      console.log(`[SSE] Attempting to reconnect in ${this.reconnectDelay}ms...`)
      this.connect().catch((error) => {
        console.error('[SSE] Reconnection failed:', error)
        if (this.onError) {
          this.onError(error)
        }
      })

      // Increase delay for next attempt (exponential backoff)
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay)
    }, this.reconnectDelay)
  }

  subscribe(handler: EventHandler): () => void {
    this.handlers.add(handler)

    // Return unsubscribe function
    return () => {
      this.handlers.delete(handler)
    }
  }

  disconnect() {
    if (this.eventSource) {
      this.eventSource.close()
      this.eventSource = null
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  isConnected(): boolean {
    return this.eventSource?.readyState === EventSource.OPEN
  }
}

// React hook for using SSE
import { useEffect, useRef } from 'react'

export function useSSE(organizationId: string | null, onEvent: EventHandler) {
  const clientRef = useRef<SSEClient | null>(null)

  useEffect(() => {
    if (!organizationId) return

    // Create SSE client
    const client = new SSEClient(organizationId, (error) => {
      console.error('[SSE] Error:', error)
    })

    clientRef.current = client

    // Connect and subscribe
    client.connect().catch((error) => {
      console.error('[SSE] Failed to connect:', error)
    })

    const unsubscribe = client.subscribe(onEvent)

    // Cleanup
    return () => {
      unsubscribe()
      client.disconnect()
      clientRef.current = null
    }
  }, [organizationId, onEvent])

  return clientRef
}
