import { useCallback, useEffect, useMemo, useState } from 'react';
import { Toaster, toast } from 'sonner';
import { ApiError, DEMO_USER, can as canDo, getHealth, getLocations, getMe, loadCore, offlineCore, setToken, useApi, type Core, type Dish, type User } from './api';
import { AppContext, type AppCtx, type Page } from './app-context';
import { ALL_PAGES, LoginModal, LoginScreen, Sidebar, Topbar, type Range } from './shell';
import { Banner, Skeleton } from './ui';
import { Overview } from './pages/Overview';
import { MenuPage } from './pages/Menu';
import { SupplierPage } from './pages/Suppliers';
import { LeakagePage } from './pages/Leakage';
import { WastePage } from './pages/Waste';
import { AdvisorPage } from './pages/Advisor';
import { ForecastPage } from './pages/Forecast';
import { ReportsPage } from './pages/Reports';
import { SettingsPage } from './pages/Settings';
import { InvoicePage } from './pages/Invoices';

const slug = (p: string) => p.toLowerCase().replace(/ /g, '-');
const fromHash = (): Page => ALL_PAGES.find(p => slug(p) === window.location.hash.slice(1)) ?? 'Overview';
const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

export default function App() {
  const [core, setCore] = useState<Core | null>(null);
  const [page, setPageRaw] = useState<Page>(fromHash);
  const [mobile, setMobile] = useState(false);
  const [range, setRange] = useState<Range>({ preset: '4w' });
  const [locationId, setLocationId] = useState<number | undefined>();
  const [avail, setAvail] = useState<{ start: string; end: string }>();
  const [health, setHealth] = useState({ available: false, advisorLive: false, authRequired: false });
  const [user, setUser] = useState<User>(DEMO_USER);
  const [locations, setLocations] = useState<{ id: number; name: string; city: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [needLogin, setNeedLogin] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [offlineWhy, setOfflineWhy] = useState('');

  const params = useMemo(() => {
    if (range.preset === '8w' && avail) return { start: addDays(avail.end, -55), end: avail.end, locationId };
    if (range.preset === 'all' && avail) return { start: avail.start, end: avail.end, locationId };
    if (range.preset === 'custom') return { start: range.start, end: range.end, locationId };
    return { locationId }; // backend default: last 28 days of available data
  }, [range, avail, locationId]);

  const setPage = useCallback((p: Page) => { setPageRaw(p); window.history.replaceState(null, '', `#${slug(p)}`); window.scrollTo(0, 0); }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const h = await getHealth();
      setHealth(h);
      const c = await loadCore(params);
      setCore(c);
      setOfflineWhy(c.live ? '' : useApi() ? 'The backend could not be reached.' : 'Live data is switched off (VITE_USE_API is not "true").');
      setNeedLogin(false);
      if (c.period) { const a = c.period.data_available; setAvail(prev => (prev && prev.start === a.start && prev.end === a.end ? prev : a)); }
      if (c.live) {
        const [me, locs] = await Promise.all([getMe().catch(() => DEMO_USER), getLocations().catch(() => [])]);
        setUser(me);
        setLocations(locs);
      } else { setUser(DEMO_USER); setLocations([]); }
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) { setNeedLogin(true); setToken(null); setUser(DEMO_USER); }
      else {
        setCore(c => (c && c.live ? { ...offlineCore() } : c ?? offlineCore()));
        setOfflineWhy(e instanceof ApiError && e.status !== 0 ? e.message : 'The backend could not be reached.');
        toast.warning('Showing offline sample data', { description: 'Live figures will appear when the API is reachable.' });
      }
    } finally { setLoading(false); }
  }, [params]);
  useEffect(() => { void refresh(); }, [refresh]);

  const afterLogin = useCallback((u: User) => { setUser(u); setLoginOpen(false); setNeedLogin(false); toast.success(`Signed in as ${u.name}`); void refresh(); }, [refresh]);
  const signOut = useCallback(() => { setToken(null); setUser(DEMO_USER); toast.info('Signed out'); void refresh(); }, [refresh]);

  if (needLogin) return <><Toaster position="top-right" /><LoginScreen onDone={afterLogin} /></>;
  if (!core) return <div className="boot" aria-busy="true"><Skeleton rows={6} height={18} /></div>;

  const live = core.live;
  const ctx: AppCtx = {
    core, live, params, user, can: p => canDo(user, p), go: setPage, refresh: () => void refresh(), health, locations, loading,
    addLocalDish: (d: Dish) => setCore(c => (c ? { ...c, dishes: [d, ...c.dishes] } : c)),
    openLogin: () => setLoginOpen(true), signOut,
  };

  return (
    <AppContext.Provider value={ctx}>
      <Toaster position="top-right" toastOptions={{ style: { fontFamily: 'inherit' } }} />
      <div className="shell">
        <Sidebar page={page} open={mobile} onClose={() => setMobile(false)} locationId={locationId} setLocationId={setLocationId} />
        <div className="main">
          <Topbar page={page} range={range} setRange={setRange} onMenu={() => setMobile(true)} />
          <main className="content" id="content">
            {!live && (
              <Banner tone="warn" action={useApi() ? <button className="btn sm" onClick={() => void refresh()}>Retry</button> : undefined}>
                <b>Offline sample data.</b> {offlineWhy} Figures on this screen are a fixed illustration, not your restaurant's data; saving, editing and live analysis are unavailable.
              </Banner>
            )}
            {page === 'Overview' && <Overview />}
            {page === 'Menu Intelligence' && <MenuPage />}
            {page === 'Supplier Intelligence' && <SupplierPage />}
            {page === 'Profit Leakage' && <LeakagePage />}
            {page === 'Food Waste' && <WastePage />}
            {page === 'AI Business Advisor' && <AdvisorPage />}
            {page === 'Forecasting' && <ForecastPage />}
            {page === 'Reports' && <ReportsPage />}
            {page === 'Settings' && <SettingsPage />}
            {page === 'Invoices' && <InvoicePage />}
            <footer className="foot">
              <span>© 2026 MarginOS</span>
              <span>{live ? (core.restaurant.isDemo ? 'Connected to the API · all data is fictional demonstration data' : 'Connected to the API') : 'Offline sample data'} · Figures are calculated deterministically; AI only explains them</span>
            </footer>
          </main>
        </div>
      </div>
      {loginOpen && <LoginModal onClose={() => setLoginOpen(false)} onDone={afterLogin} showDemo={core.restaurant.isDemo} />}
    </AppContext.Provider>
  );
}
