import { useEffect, useRef } from 'react'
import { NoticeBanner, PhoneFrame, TabBar } from './components/Shell'
import { towardOf } from './components/TransferPath'
import { lineName, stationName, t } from './i18n'
import { routeStops } from './lib/routing'
import CongestionScreen from './screens/CongestionScreen'
import ForeignMode from './screens/ForeignMode'
import IndoorNav from './screens/IndoorNav'
import PremiumScreen from './screens/PremiumScreen'
import ReportScreen from './screens/ReportScreen'
import { Modal } from './components/Overlays'
import { PrimaryButton } from './components/ui'
import { confirmFromUrl } from './services/premium'
import HomeScreen from './screens/HomeScreen'
import MoveScreen from './screens/MoveScreen'
import MyScreen from './screens/MyScreen'
import RouteScreen from './screens/RouteScreen'
import SmartDeparture from './screens/SmartDeparture'
import { StoreProvider, useStore } from './state/store'

/** 이동 중 상태 감시: 자동 진행 · 환승 사전 알림 · 하차 사전 알림 · 도착 알림 · 이동 기록 저장 */
function JourneyEngine() {
  const s = useStore()
  const j = s.journey
  const last = useRef<{ id: string; index: number } | null>(null)

  useEffect(() => {
    if (!j?.auto || j.arrived) return
    const id = setInterval(() => s.advance(1), 3500)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [j?.auto, j?.arrived])

  // 도착 시 기록 저장 (한 번만)
  useEffect(() => {
    if (j?.arrived && !j.recorded && s.journeyRoute) {
      s.recordJourney(j, s.journeyRoute)
      s.setJourney({ ...j, recorded: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [j?.arrived])

  useEffect(() => {
    if (!j) {
      last.current = null
      return
    }
    const prev = last.current
    last.current = { id: j.route.id, index: j.index }
    if (!prev || prev.id !== j.route.id || prev.index === j.index) return
    const route = j.route
    const stops = routeStops(route)
    const left = stops.length - 1 - j.index
    const cur = stops[j.index]
    const dest = stationName(route.to)
    const n = s.alerts

    if (left === 0) {
      s.notify({ title: t('alert.arrivedTitle', { s: dest }), body: t('alert.arrivedBody'), tone: 'success' }, { kind: 'arrival', silent: !j.alertOn, duration: 6000 })
      return
    }
    if (j.alertOn && left === n.alightBefore) {
      const title = left === 1 ? t('alert.alightTitle', { s: dest }) : t('alert.alightTitleN', { n: left, s: dest })
      s.notify({ title, body: t('alert.alightBody'), tone: 'warn' }, { kind: 'alight', duration: 6000 })
      return
    }
    // 환승 사전 알림 (n정거장 전) + 환승 방향 · 통로 안내
    const nextTi = stops.findIndex((x, i) => i >= j.index && x.transferTo)
    if (nextTi >= 0) {
      const tr = route.transfers.find((x) => x.station === stops[nextTi].station)
      const dist = nextTi - j.index
      if (tr && j.alertOn && dist === n.transferBefore && dist > 0) {
        const dir = n.directionOn ? ` · ${lineName(tr.to)} ${towardOf(route, tr.station, tr.to)}` : ''
        s.notify({ title: t('alert.transferSoon', { s: stationName(tr.station), n: dist }), body: `${t('station.door', { d: tr.info.door })}${dir}`, tone: 'info' }, { kind: 'transfer', duration: 6000 })
        return
      }
    }
    if (cur.transferTo) {
      const tr = route.transfers.find((x) => x.station === cur.station)
      const body = [n.directionOn && tr ? `${lineName(tr.to)} ${towardOf(route, tr.station, tr.to)}` : '', n.passageOn && tr ? t('alert.passage', { m: tr.info.walk, e: tr.elevator ? t('alert.byElevator') : t('alert.byStairs') }) : '']
        .filter(Boolean)
        .join(' · ')
      s.notify(
        { title: t('alert.transferNow', { s: stationName(cur.station) }), body, tone: 'info', action: { label: t('alert.openTransfer'), run: () => (s.setMoveTab('transfer'), s.setTab('move')) } },
        { kind: 'transfer', silent: !j.alertOn, duration: 6000 },
      )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [j?.index, j?.route.id])

  useEffect(() => {
    document.documentElement.classList.toggle('large-text', s.largeText)
  }, [s.largeText])

  // 운행 지연 발생 시 이동 중 경로에 영향이 있으면 푸시 알림 + 도착시간 재계산(경로 재평가는 store에서 자동)
  const prevDelay = useRef(0)
  useEffect(() => {
    if (!j) return
    const lines = [...new Set(j.route.segments.map((g) => g.line))]
    const total = lines.reduce((a, l) => a + s.statusOf(l).delayMin, 0)
    const susp = lines.some((l) => s.statusOf(l).suspended)
    if (total > prevDelay.current || susp) {
      s.notify(
        { title: susp ? t('delay.suspended') : t('delay.pushTitle', { n: total }), body: t('delay.pushBody'), tone: 'danger', action: { label: t('dis.alts'), run: () => (s.setMoveTab('disruption'), s.setTab('move')) } },
        { kind: 'transfer', duration: 6000 },
      )
    }
    prevDelay.current = total
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.disruptions])

  return null
}

/** 결제 리다이렉트(/pay/success, /pay/fail) 처리 — 서버 승인 결과로만 구독 활성화 */
function PaymentReturn() {
  const s = useStore()
  const done = useRef(false)
  useEffect(() => {
    if (done.current) return
    done.current = true
    void confirmFromUrl().then((r) => {
      if (!r) return
      try {
        window.history.replaceState(null, '', '/my')
      } catch {
        /* noop */
      }
      s.setTab('my')
      s.openPage({ kind: 'premium' })
      if (r.ok) {
        s.setSubscription(r.sub)
        s.notify({ title: t('pro.paySuccess'), body: r.sub.testMode ? t('pro.testPaid') : undefined, tone: 'success' }, { kind: 'system' })
      } else s.notify({ title: t('pro.payFail'), body: r.message ?? r.code, tone: 'danger' }, { kind: 'system', duration: 7000 })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return null
}

/** 위치정보 이용 동의 */
function LocationConsent() {
  const s = useStore()
  if (!s.consentAsk) return null
  const run = s.consentAsk
  return (
    <Modal
      open
      onClose={() => s.setConsentAsk(null)}
      title={t('consent.title')}
      footer={
        <div className="space-y-2">
          <PrimaryButton
            onClick={() => {
              s.patch({ locationConsent: true })
              s.setConsentAsk(null)
              run()
            }}
          >
            {t('consent.agree')}
          </PrimaryButton>
          <PrimaryButton tone="light" onClick={() => (s.patch({ locationConsent: false }), s.setConsentAsk(null))}>
            {t('consent.decline')}
          </PrimaryButton>
        </div>
      }
    >
      <div className="space-y-2 px-5 pb-2 text-[14px] leading-relaxed">
        <p>{t('consent.body')}</p>
        <ul className="list-disc space-y-1 pl-5 text-[13px] text-ink-2">
          <li>{t('consent.p1')}</li>
          <li>{t('consent.p2')}</li>
          <li>{t('consent.p3')}</li>
        </ul>
      </div>
    </Modal>
  )
}

function Screens() {
  const { tab, pages, closePage, lang } = useStore()
  return (
    <div className="flex h-full flex-col" key={lang}>
      <main className="relative min-h-0 flex-1 overflow-hidden">
        {tab === 'home' && <HomeScreen />}
        {tab === 'route' && <RouteScreen />}
        {tab === 'move' && <MoveScreen />}
        {tab === 'report' && <ReportScreen />}
        {tab === 'my' && <MyScreen />}
        {/* 화면 스택: 아래 화면은 숨겨진 채 상태를 유지 */}
        {pages.map((page, i) => (
          <div key={page.kind} className={i === pages.length - 1 ? 'contents' : 'hidden'}>
            {page.kind === 'departure' && <SmartDeparture onClose={closePage} />}
            {page.kind === 'crowd' && <CongestionScreen key={page.station ?? ''} initialStation={page.station} onClose={closePage} />}
            {page.kind === 'indoor' && <IndoorNav key={page.station + (page.to ?? '')} station={page.station} from={page.from} to={page.to} onClose={closePage} />}
            {page.kind === 'foreign' && <ForeignMode key={page.section ?? ''} initial={page.section} onClose={closePage} />}
            {page.kind === 'premium' && <PremiumScreen onClose={closePage} />}
          </div>
        ))}
        <LocationConsent />
      </main>
      <TabBar />
      <NoticeBanner />
      <JourneyEngine />
      <PaymentReturn />
    </div>
  )
}

export default function App() {
  return (
    <StoreProvider>
      <PhoneFrame>
        <Screens />
      </PhoneFrame>
    </StoreProvider>
  )
}
