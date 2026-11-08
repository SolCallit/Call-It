'use client';

import { Component, Fragment, type ErrorInfo, type ReactNode } from 'react';
import { reportTxError } from '@/lib/wallet/client';

/** Fired when the wallet layer crashes, so anything waiting on a signature fails fast instead of hanging. */
export const WALLET_CRASH = 'callit:wallet-crash';

type State = { down: boolean; gen: number };

/**
 * Fences off the wallet layer (Privy's sign-in and signing windows, AuthBridge). Without it, one
 * exception in there unmounts the entire app and Next shows "This page couldn't load".
 * With it, the feed keeps running, the error is logged to the admin panel, and the wallet
 * layer restarts a moment later, still signed in.
 */
export default class WalletGuard extends Component<{ children: ReactNode }, State> {
  state: State = { down: false, gen: 0 };
  private crashes: number[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;

  static getDerivedStateFromError(): Partial<State> {
    return { down: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[callit] wallet layer crashed:', error, info.componentStack);
    window.dispatchEvent(new CustomEvent(WALLET_CRASH, { detail: error }));
    reportTxError('wallet_ui', error);
    // Restart, unless it keeps falling over: then stay down rather than crash in a loop.
    const now = Date.now();
    this.crashes = this.crashes.filter((t) => now - t < 60_000).concat(now);
    if (this.crashes.length > 3) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.setState((s) => ({ down: false, gen: s.gen + 1 })), 400);
  }

  componentWillUnmount() {
    clearTimeout(this.timer);
  }

  render() {
    return this.state.down ? null : <Fragment key={this.state.gen}>{this.props.children}</Fragment>;
  }
}
