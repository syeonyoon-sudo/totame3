import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Lang, LineId } from '../data/network'
import { detectLang, getLang, setLang } from '../i18n'
import { findRoutes, reevaluate, routeStops, type Criterion, type Disruption, type Route, type RoutingSettings } from '../lib/routing'
import { detectEarphones, phoneNotify, playSound, registerServiceWorker, speak, vibrate, type SoundType } from '../lib/notify'
import { createTripRepository, newId, type TripRecord } from '../services/trips'
import { lineStatus, probeRealtime } from '../services/delay'
import { isActive, readSubscription, type Subscription } from '../services/premium'

export type Tab = 'home' | 'route' | 'move' | 'report' | 'my'
export type MoveTab = 'track' | 'transfer' | 'disruption'

/** 탭 위에 열리는 화면 */
export type Page =
  | { kind: 'crowd'; station?: string }
  | { kind: 'indoor'; station: string; from?: string; to?: string }
  | { kind: 'foreign'; section?: 'card' | 'transfer' | 'tour' | 'sights' | 'luggage' | 'night' | 'camera' | 'emergency' }
  | { kind: 'premium' }
  | { kind: 'departure' }

export type TrackMode = 'sim' | 'gps' | 'manual'

export interface Journey {
  route: Route
  index: number
  alertOn: boolean
  arrived: boolean
  auto: boolean
  startedAt: number
  mode: TrackMode
  recorded?: boolean
}

export type NoticeKind = 'info' | 'alight' | 'transfer' | 'arrival' | 'system'

export interface Notice {
  id: number
  title: string
  body?: string
  tone: 'info' | 'warn' | 'danger' | 'success'
  action?: { label: string; run: () => void }
}

export interface NotifySettings {
  phone: boolean
  sound: boolean
  soundType: SoundType
  volume: number
  vibrate: boolean
  voice: boolean
  earphoneVoice: boolean
  watch: boolean
  alightOn: boolean
  transferOn: boolean
  directionOn: boolean
  passageOn: boolean
  arrivalOn: boolean
  alightBefore: 1 | 2 | 3
  transferBefore: 1 | 2
}

export interface Place {
  id: string
  kind: 'home' | 'school' | 'work' | 'etc'
  label: string
  station: string
  distanceM: number
  example?: boolean
}

interface Persisted {
  lang: Lang
  nickname: string
  priorities: Criterion[]
  walkSpeed: number
  measured: boolean
  wheelchair: boolean
  largeText: boolean
  alerts: NotifySettings
  favorites: string[]
  favoriteRoutes: { from: string; to: string }[]
  recents: { from: string; to: string }[]
  places: Place[]
  adsEnabled: boolean
  adsPersonalized: boolean
  consentAsked: boolean
  foreignMode: boolean
  /** 위치정보 이용 동의 (null: 아직 묻지 않음) */
  locationConsent: boolean | null
  /** 이동 기록 저장 동의 */
  recordConsent: boolean
  voiceRate: number
  /** 프리미엄 기능 미리보기 (결제 아님 · 시연용) */
  premiumPreview: boolean
}

const DEFAULTS: Persisted = {
  lang: detectLang(),
  nickname: '',
  priorities: ['elevator', 'walk'],
  walkSpeed: 1.2,
  measured: false,
  wheelchair: false,
  largeText: false,
  alerts: {
    phone: false,
    sound: true,
    soundType: 'chime',
    volume: 0.7,
    vibrate: true,
    voice: false,
    earphoneVoice: false,
    watch: false,
    alightOn: true,
    transferOn: true,
    directionOn: true,
    passageOn: true,
    arrivalOn: true,
    alightBefore: 1,
    transferBefore: 1,
  },
  favorites: ['이대', '잠실', '강남'],
  favoriteRoutes: [],
  recents: [
    { from: '광화문', to: '잠실' },
    { from: '이대', to: '강남' },
  ],
  places: [{ id: 'p-school', kind: 'school', label: '학교', station: '이대', distanceM: 450, example: true }],
  adsEnabled: true,
  adsPersonalized: false,
  consentAsked: false,
  foreignMode: false,
  locationConsent: null,
  recordConsent: true,
  voiceRate: 1,
  premiumPreview: false,
}

const KEY = 'totame:prefs:v2'

function load(): Persisted {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const p = JSON.parse(raw) as Partial<Persisted>
      return { ...DEFAULTS, ...p, alerts: { ...DEFAULTS.alerts, ...(p.alerts ?? {}) } }
    }
  } catch {
    /* noop */
  }
  return DEFAULTS
}

const PATHS: Record<Tab, string> = { home: '/', route: '/route', move: '/move', report: '/report', my: '/my' }
function tabFromPath(): Tab {
  const p = window.location.pathname
  return (Object.keys(PATHS) as Tab[]).find((t) => PATHS[t] === p && t !== 'home') ?? 'home'
}

export const PACE_PRESETS = [
  { key: 'slow', speed: 0.9 },
  { key: 'normal', speed: 1.2 },
  { key: 'fast', speed: 1.5 },
] as const
export type PaceKey = (typeof PACE_PRESETS)[number]['key']

export function paceKey(speed: number): PaceKey {
  if (speed < 1.05) return 'slow'
  if (speed < 1.35) return 'normal'
  return 'fast'
}

const repo = createTripRepository()

/** 출발지 표시 이름 — 예시 장소는 현재 언어로 */
export function placeLabel(p: Place, tr: (k: 'place.home' | 'place.school' | 'place.work' | 'place.etc') => string) {
  return p.example ? tr(`place.${p.kind}`) : p.label
}

function useStoreValue() {
  const [prefs, setPrefs] = useState<Persisted>(() => {
    const p = load()
    setLang(p.lang)
    return p
  })
  const [tab, setTabState] = useState<Tab>(tabFromPath)
  const [moveTab, setMoveTab] = useState<MoveTab>('track')
  const [pages, setPages] = useState<Page[]>([])
  const page = pages[pages.length - 1] ?? null
  const [subscription, setSubscription] = useState<Subscription | null>(readSubscription)
  const [realtimeAvailable, setRealtimeAvailable] = useState(false)
  const [consentAsk, setConsentAsk] = useState<null | (() => void)>(null)
  const [from, setFrom] = useState('광화문')
  const [to, setTo] = useState('')
  const [query, setQuery] = useState<{ from: string; to: string; priorities: Criterion[] } | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [journey, setJourney] = useState<Journey | null>(null)
  const [disruptions, setDisruptions] = useState<Disruption[]>([])
  const [notice, setNotice] = useState<Notice | null>(null)
  const [trips, setTrips] = useState<TripRecord[]>([])
  const noticeTimer = useRef<number | undefined>(undefined)

  if (getLang() !== prefs.lang) setLang(prefs.lang)

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(prefs))
    } catch {
      /* noop */
    }
  }, [prefs])

  const reloadTrips = useCallback(async () => {
    try {
      setTrips(await repo.list())
    } catch {
      setTrips([])
    }
  }, [])

  useEffect(() => {
    void reloadTrips()
    void registerServiceWorker()
    void probeRealtime().then(setRealtimeAvailable)
    const onPop = () => setTabState(tabFromPath())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [reloadTrips])

  const setTab = useCallback((t: Tab) => {
    setTabState(t)
    setPages([])
    try {
      if (window.location.pathname !== PATHS[t]) window.history.pushState(null, '', PATHS[t])
    } catch {
      /* noop */
    }
  }, [])

  const patch = useCallback((p: Partial<Persisted>) => setPrefs((s) => ({ ...s, ...p })), [])
  const patchNotify = useCallback((p: Partial<NotifySettings>) => setPrefs((s) => ({ ...s, alerts: { ...s.alerts, ...p } })), [])

  const settings: RoutingSettings = useMemo(
    () => ({ walkSpeed: prefs.walkSpeed, priorities: query?.priorities ?? prefs.priorities, wheelchair: prefs.wheelchair }),
    [prefs.walkSpeed, prefs.priorities, prefs.wheelchair, query],
  )

  const routes = useMemo(() => (query ? findRoutes(query.from, query.to, settings, disruptions) : []), [query, settings, disruptions])
  const selectedRoute = routes.find((r) => r.id === selectedId) ?? routes[0] ?? null

  const journeyRoute = useMemo(() => (journey ? reevaluate(journey.route, settings, disruptions) : null), [journey, settings, disruptions])

  /** 알림 출력: 인앱 배너 + 설정된 방식(알림음·진동·음성·시스템 알림) */
  const notify = useCallback(
    (n: Omit<Notice, 'id'>, opts?: { kind?: NoticeKind; silent?: boolean; duration?: number; voice?: string }) => {
      window.clearTimeout(noticeTimer.current)
      setNotice({ ...n, id: Date.now() })
      noticeTimer.current = window.setTimeout(() => setNotice(null), opts?.duration ?? 4500)
      const kind = opts?.kind ?? 'info'
      const s = prefs.alerts
      if (kind === 'alight' && !s.alightOn) return
      if (kind === 'transfer' && !s.transferOn) return
      if (kind === 'arrival' && !s.arrivalOn) return
      if (opts?.silent) return
      if (s.sound) playSound(s.soundType, s.volume)
      if (s.vibrate) vibrate(n.tone === 'success' ? [200, 100, 200, 100, 400] : [180, 80, 180])
      if (kind !== 'info' && kind !== 'system') {
        const text = opts?.voice ?? `${n.title}. ${n.body ?? ''}`
        if (s.voice) speak(text, prefs.lang, s.volume, prefs.voiceRate)
        // 이어폰 음성 안내: 이어폰 연결이 확인될 때만
        else if (s.earphoneVoice) void detectEarphones().then((e) => e && speak(text, prefs.lang, s.volume, prefs.voiceRate))
      }
      // 스마트폰 시스템 알림 — 스마트워치는 휴대폰 알림 미러링으로 전달
      if ((s.phone || s.watch) && kind !== 'system' && kind !== 'info') void phoneNotify(n.title, n.body)
    },
    [prefs.alerts, prefs.lang, prefs.voiceRate],
  )

  const search = useCallback(
    (f = from, t = to, priorities = prefs.priorities) => {
      if (!f || !t || f === t) return false
      setFrom(f)
      setTo(t)
      setQuery({ from: f, to: t, priorities: [...priorities] })
      setSelectedId(null)
      setPrefs((s) => ({
        ...s,
        recents: [{ from: f, to: t }, ...s.recents.filter((r) => !(r.from === f && r.to === t))].slice(0, 6),
      }))
      return true
    },
    [from, to, prefs.priorities],
  )

  const startJourney = useCallback((route: Route, keep?: Partial<Journey>) => {
    setJourney({ route, index: 0, alertOn: false, arrived: false, auto: false, startedAt: Date.now(), mode: 'sim', ...keep })
  }, [])

  const advance = useCallback((delta = 1) => {
    setJourney((j) => {
      if (!j) return j
      const len = routeStops(j.route).length
      const index = Math.max(0, Math.min(len - 1, j.index + delta))
      return { ...j, index, arrived: index === len - 1, auto: index === len - 1 ? false : j.auto }
    })
  }, [])

  const setJourneyIndex = useCallback((index: number, mode?: TrackMode) => {
    setJourney((j) => {
      if (!j) return j
      const len = routeStops(j.route).length
      const i = Math.max(0, Math.min(len - 1, index))
      return { ...j, index: i, arrived: i === len - 1, mode: mode ?? j.mode, auto: i === len - 1 ? false : j.auto }
    })
  }, [])

  const addTrip = useCallback(
    async (t: TripRecord) => {
      await repo.add(t)
      await reloadTrips()
    },
    [reloadTrips],
  )
  const removeTrip = useCallback(
    async (id: string) => {
      await repo.remove(id)
      await reloadTrips()
    },
    [reloadTrips],
  )
  const clearTrips = useCallback(
    async (demoOnly?: boolean) => {
      await repo.clear({ demoOnly })
      await reloadTrips()
    },
    [reloadTrips],
  )

  /** 이동 완료 시 기록 저장 (이동 기록 저장 동의 시) */
  const recordJourney = useCallback(
    (j: Journey, route: Route) => {
      if (!prefs.recordConsent) return
      const stops = routeStops(route)
      const lines = [...new Set(route.segments.map((s) => s.line))] as LineId[]
      const ended = Date.now()
      void addTrip({
        id: newId(),
        startedAt: new Date(j.startedAt).toISOString(),
        endedAt: new Date(ended).toISOString(),
        from: route.from,
        to: route.to,
        lines,
        stations: stops.map((s) => s.station),
        minutes: route.totalMin,
        transfers: route.transferCount,
        distanceKm: route.distanceKm,
        walkM: route.walkM,
        delayMin: route.delayMin,
      })
    },
    [addTrip, prefs.recordConsent],
  )

  /** 위치정보 이용 동의 후 실행 */
  const withLocation = useCallback(
    (run: () => void) => {
      if (prefs.locationConsent) run()
      else setConsentAsk(() => run)
    },
    [prefs.locationConsent],
  )

  const premium = isActive(subscription) || prefs.premiumPreview
  const premiumPaid = isActive(subscription)

  /** 노선 운행 상태 (실시간 / 시뮬레이션 / 확인 불가) */
  const statusOf = useCallback((line: LineId) => lineStatus(line, disruptions, realtimeAvailable), [disruptions, realtimeAvailable])

  /** 화면 스택: 다른 화면 위에서 열면 뒤로가기 시 이전 화면으로 돌아감 */
  const openPage = useCallback((p: Page) => setPages((st) => [...st.filter((x) => x.kind !== p.kind), p]), [])
  const closePage = useCallback(() => setPages((st) => st.slice(0, -1)), [])

  return {
    ...prefs,
    patch,
    patchNotify,
    tab,
    setTab,
    moveTab,
    setMoveTab,
    page,
    pages,
    openPage,
    closePage,
    subscription,
    setSubscription,
    premium,
    premiumPaid,
    realtimeAvailable,
    statusOf,
    withLocation,
    consentAsk,
    setConsentAsk,
    from,
    setFrom,
    to,
    setTo,
    query,
    setQuery,
    search,
    routes,
    selectedRoute,
    setSelectedId,
    settings,
    journey,
    setJourney,
    journeyRoute,
    startJourney,
    advance,
    setJourneyIndex,
    disruptions,
    setDisruptions,
    notice,
    setNotice,
    notify,
    trips,
    addTrip,
    removeTrip,
    clearTrips,
    recordJourney,
    repoKind: repo.kind,
  }
}

export type Store = ReturnType<typeof useStoreValue>
const Ctx = createContext<Store | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const value = useStoreValue()
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useStore() {
  const v = useContext(Ctx)
  if (!v) throw new Error('StoreProvider missing')
  return v
}
