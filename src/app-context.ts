import { createContext, useContext } from 'react';
import type { Core, Dish, Params, Permission, User } from './api';

export type Page = 'Overview' | 'Menu Intelligence' | 'Supplier Intelligence' | 'Profit Leakage' | 'Food Waste' | 'AI Business Advisor' | 'Forecasting' | 'Reports' | 'Settings' | 'Invoices';

export type AppCtx = {
  core: Core;
  /** true only when the backend answered; false = labelled offline sample */
  live: boolean;
  params: Params;
  user: User;
  can: (p: Permission) => boolean;
  go: (p: Page) => void;
  refresh: () => void;
  health: { available: boolean; advisorLive: boolean; authRequired: boolean };
  locations: { id: number; name: string; city: string }[];
  addLocalDish: (d: Dish) => void;
  openLogin: () => void;
  signOut: () => void;
  loading: boolean;
};

export const AppContext = createContext<AppCtx | null>(null);
export function useApp(): AppCtx {
  const c = useContext(AppContext);
  if (!c) throw new Error('useApp must be used inside <AppContext.Provider>');
  return c;
}
