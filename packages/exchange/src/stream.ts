import { WS_HOSTS } from "./binance";

type Handler = (data: unknown) => void;

/**
 * One multiplexed Binance WebSocket for the whole app. Streams are reference-counted:
 * components subscribe/unsubscribe freely and the socket (re)subscribes as needed.
 * Reconnects with exponential backoff (1s → 30s), switching hosts, and tells listeners
 * so they can gap-fill missed candles over REST.
 */
class BinanceStream {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, Set<Handler>>();
  private reconnectListeners = new Set<() => void>();
  private statusListeners = new Set<(s: StreamStatus) => void>();
  private backoff = 1000;
  private hostIdx = 0;
  private msgId = 1;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private connectedOnce = false;
  status: StreamStatus = "idle";

  subscribe(stream: string, handler: Handler): () => void {
    let set = this.handlers.get(stream);
    const isNew = !set;
    if (!set) {
      set = new Set();
      this.handlers.set(stream, set);
    }
    set.add(handler);
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (!this.ws) this.connect();
    else if (isNew) this.send("SUBSCRIBE", [stream]);
    return () => {
      const s = this.handlers.get(stream);
      if (!s) return;
      s.delete(handler);
      if (s.size === 0) {
        this.handlers.delete(stream);
        this.send("UNSUBSCRIBE", [stream]);
      }
      if (this.handlers.size === 0) this.idleTimer = setTimeout(() => this.close(), 15_000);
    };
  }

  onReconnect(fn: () => void): () => void {
    this.reconnectListeners.add(fn);
    return () => this.reconnectListeners.delete(fn);
  }

  onStatus(fn: (s: StreamStatus) => void): () => void {
    this.statusListeners.add(fn);
    fn(this.status);
    return () => this.statusListeners.delete(fn);
  }

  private setStatus(s: StreamStatus) {
    this.status = s;
    for (const fn of this.statusListeners) fn(s);
  }

  private send(method: "SUBSCRIBE" | "UNSUBSCRIBE", params: string[]) {
    if (this.ws?.readyState === WebSocket.OPEN && params.length) this.ws.send(JSON.stringify({ method, params, id: this.msgId++ }));
  }

  private connect() {
    if (typeof window === "undefined") return;
    this.setStatus("connecting");
    const ws = new WebSocket(`${WS_HOSTS[this.hostIdx % WS_HOSTS.length]}/stream`);
    this.ws = ws;
    ws.onopen = () => {
      this.backoff = 1000;
      this.setStatus("live");
      const streams = [...this.handlers.keys()];
      // Binance limits a single SUBSCRIBE to ~200 streams.
      for (let i = 0; i < streams.length; i += 100) this.send("SUBSCRIBE", streams.slice(i, i + 100));
      if (this.connectedOnce) for (const fn of this.reconnectListeners) fn();
      this.connectedOnce = true;
    };
    ws.onmessage = (ev) => {
      let msg: { stream?: string; data?: unknown };
      try {
        msg = JSON.parse(ev.data as string);
      } catch {
        return;
      }
      if (!msg.stream) return;
      const set = this.handlers.get(msg.stream);
      if (set) for (const h of set) h(msg.data);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.handlers.size === 0) {
        this.setStatus("idle");
        return;
      }
      this.setStatus("reconnecting");
      this.hostIdx++;
      const delay = this.backoff + Math.random() * 500;
      this.backoff = Math.min(30_000, this.backoff * 2);
      this.reconnectTimer = setTimeout(() => this.connect(), delay);
    };
    ws.onerror = () => ws.close();
  }

  private close() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    this.setStatus("idle");
  }
}

export type StreamStatus = "idle" | "connecting" | "live" | "reconnecting";

export const binanceStream = new BinanceStream();

export interface KlineEvent {
  k: { t: number; o: string; h: string; l: string; c: string; v: string; q: string; V: string; n: number; x: boolean };
}

export interface MiniTicker {
  s: string;
  c: string;
  o: string;
  h: string;
  l: string;
  v: string;
  q: string;
}

export interface AggTrade {
  p: string;
  q: string;
  T: number;
  m: boolean;
  a: number;
}

export interface DepthEvent {
  bids: [string, string][];
  asks: [string, string][];
}
