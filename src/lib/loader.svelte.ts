// A group page's data: fetched once, then again whenever the live stream says something changed (one
// fetch at a time; changes during one bring one more). `gone` once the key stops working.

import { ApiError, get, live, type LiveState } from './api.ts';

export class Loader<T extends { now: number }> {
  view = $state<T | null>(null);
  gone = $state(false);
  failed = $state(false);
  conn = $state<LiveState>('connecting');
  /** How far this device's clock is behind the server's, in ms. */
  offset = $state(0);
  #busy = false;
  #again = false;

  constructor(
    private path: string,
    private key: string,
    private headers: () => Record<string, string> = () => ({}),
  ) {}

  async load(): Promise<void> {
    if (this.#busy) {
      this.#again = true;
      return;
    }
    this.#busy = true;
    try {
      const view = await get<T>(this.path, this.headers());
      this.offset = view.now - Date.now();
      this.view = view;
      this.failed = false;
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) this.gone = true;
      else this.failed = true;
    } finally {
      this.#busy = false;
    }
    if (this.#again) {
      this.#again = false;
      await this.load();
    }
  }

  /** Loads and follows the live stream; returns the stop. */
  start() {
    void this.load();
    return live(this.key, {
      onChange: () => void this.load(),
      onGone: () => (this.gone = true),
      onState: (s) => (this.conn = s),
    });
  }
}
