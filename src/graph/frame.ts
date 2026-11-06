// The frame's window.orca. Orca typings are unavailable on this install, so declare what we use.

export interface Disposable {
  dispose(): void
}

export interface FrameOrca {
  host: {
    call(method: string, params?: unknown): Promise<any>
    has?(method: string): boolean
  }
  plugin: {
    request(name: string, input?: unknown, options?: { timeoutMs?: number }): Promise<any>
    on(event: string, handler: (payload: any) => void): Disposable
  }
  on(event: string, handler: (payload: any) => void): Disposable
}

export const orca = (window as unknown as { orca: FrameOrca }).orca
