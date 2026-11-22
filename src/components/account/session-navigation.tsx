import { createContext, useContext, type ReactNode } from 'react';

// Navigation intent belongs to the document, not to an account's keyed repository lifetime.
let phase: 'active' | 'signing-out' | 'public-auth' = 'active';
let epoch = 0;

const sessionNavigation = {
  captureEpoch: () => epoch,
  canRedirectOnExpiry: (captured: number) => captured === epoch && phase === 'active',
  signOutStarted: () => {
    epoch += 1;
    phase = 'signing-out';
  },
  publicAuthMounted: () => {
    phase = 'public-auth';
  },
  resumeAuthenticatedNavigation: () => {
    epoch += 1;
    phase = 'active';
  },
};

const SessionNavigationContext = createContext<typeof sessionNavigation | null>(null);

export function SessionNavigationScope({ children }: { children: ReactNode }) {
  return <SessionNavigationContext value={sessionNavigation}>{children}</SessionNavigationContext>;
}

export function useSessionNavigation() {
  const navigation = useContext(SessionNavigationContext);
  if (navigation === null) throw new Error('useSessionNavigation requires a provider');
  return navigation;
}

export function resumeFromPublicAuth() {
  if (phase === 'public-auth') sessionNavigation.resumeAuthenticatedNavigation();
}

export function isSignOutPending(): boolean {
  return phase === 'signing-out';
}
