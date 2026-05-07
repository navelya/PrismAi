import type { StreamEvent } from './protocol';

/**
 * Minimal NDJSON writer for StreamEvent. Wraps a ReadableStream controller
 * and exposes a single `send(event)` method. Tracks client disconnect so
 * callers can stop work early.
 */
export class StreamEncoder {
  private encoder = new TextEncoder();
  private connected = true;

  constructor(private controller: ReadableStreamDefaultController<Uint8Array>) {}

  send(event: StreamEvent): void {
    if (!this.connected) return;
    try {
      this.controller.enqueue(this.encoder.encode(JSON.stringify(event) + '\n'));
    } catch {
      this.connected = false;
    }
  }

  close(): void {
    if (!this.connected) return;
    try {
      this.controller.close();
    } catch {
      // already closed
    }
    this.connected = false;
  }

  disconnect(): void {
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }
}
