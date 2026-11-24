import { useEffect, useMemo, useState } from 'react'
import { Bike, Briefcase, Building2, ChevronLeft, ChevronRight, Footprints, GraduationCap, House, LocateFixed, MapPin, Plus, Trash2 } from 'lucide-react'
import { Modal, StationPicker } from '../components/Overlays'
import { DataTag, LineBadge, PrimaryButton, ScreenHeader, Segmented } from '../components/ui'
import { STATIONS, type LineId } from '../data/network'
import { STATUS_TEXT, STATUS_TONE, directionsOf, planBoarding, type Mode } from '../lib/boarding'
import { stationName, t, type MessageKey } from '../i18n'
import { nearestStations, useGeo } from '../lib/geo'
import { formatClock } from '../lib/routing'
import { fetchArrivals, type Arrival } from '../services/realtime'
import { placeLabel, useStore, type Place } from '../state/store'
import { DelayLine } from '../components/DelayLine'

export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), ms)
    return () => clearInterval(id)
  }, [ms])
  return now
}

const KIND_ICON = { home: House, school: GraduationCap, work: Briefcase, etc: Building2 }

/** 홈 화면 요약 카드 */
export function DepartureSummary({ onOpen }: { onOpen: () => void }) {
  const s = useStore()
  const now = useNow(5000)
  const place = s.places[0]
  if (!place || !STATIONS[place.station]) {
    return (
      <button type="button" onClick={onOpen} className="mx-4 mb-2 flex w-[calc(100%-2rem)] items-center gap-3 rounded-2xl bg-brand-light px-4 py-3 text-left">
        <Footprints size={20} className="text-brand" />
        <span className="flex-1 text-[15px] font-bold text-brand">{t('dep.title')}</span>
        <ChevronRight size={18} className="text-brand" />
      </button>
    )
  }
  const line = STATIONS[place.station].lines[0]
  const dir = directionsOf(place.station, line)[0]
  const p = planBoarding({ station: place.station, line, toward: dir?.toward ?? '', distanceM: place.distanceM, mode: 'walk', walkSpeed: s.walkSpeed, now, delayMin: s.statusOf(line).delayMin })
  const Icon = KIND_ICON[place.kind]
  return (
    <button type="button" onClick={onOpen} className="mx-4 mb-2 block w-[calc(100%-2rem)] rounded-2xl bg-brand-light px-4 py-3 text-left">
      <div className="flex items-center gap-2 text-[12px] font-semibold text-brand">
        <Footprints size={14} /> {t('dep.title')}
        <ChevronRight size={14} className="ml-auto" />
      </div>
      <div className="mt-1 flex items-center gap-2">
        <Icon size={17} className="shrink-0 text-ink" />
        <span className="truncate text-[15px] font-bold">{placeLabel(place, t)}</span>
        <span className="text-[13px] text-ink-2">· {stationName(place.station)}</span>
        <LineBadge line={line} size={17} />
      </div>
      <p className={`mt-1 text-[15px] font-bold ${STATUS_TONE[p.status]}`}>{t(STATUS_TEXT[p.status])}</p>
      <p className="text-[12px] text-ink-2">
        {t('dep.summary', { train: formatClock(p.catchable.at), leave: formatClock(p.leaveBy) })}
      </p>
    </button>
  )
}

/** 스마트 출발 도우미 전체 화면 */
export default function SmartDeparture({ onClose }: { onClose: () => void }) {
  const s = useStore()
  const now = useNow(1000)
  const [placeId, setPlaceId] = useState(s.places[0]?.id ?? '')
  const place = s.places.find((p) => p.id === placeId) ?? s.places[0]
  const [mode, setMode] = useState<Mode>('walk')
  const [adding, setAdding] = useState(false)
  const station = place && STATIONS[place.station] ? place.station : null
  const [line, setLine] = useState<LineId | null>(null)
  const [dirIdx, setDirIdx] = useState(0)
  const [rt, setRt] = useState<Arrival[] | null | undefined>(undefined)

  const lineSel: LineId | null = station ? (line && STATIONS[station].lines.includes(line) ? line : STATIONS[station].lines[0]) : null
  const dirs = station && lineSel ? directionsOf(station, lineSel) : []
  const dir = dirs[Math.min(dirIdx, dirs.length - 1)]
  const route = s.selectedRoute && s.selectedRoute.from === station ? s.selectedRoute : null

  useEffect(() => {
    if (!station) return
    let alive = true
    setRt(undefined)
    void fetchArrivals(STATIONS[station].names.ko).then((r) => alive && setRt(r))
    return () => {
      alive = false
    }
  }, [station])

  const delayMin = lineSel ? s.statusOf(lineSel).delayMin : 0
  const p = useMemo(
    () => (place && station && lineSel && dir ? planBoarding({ station, line: lineSel, toward: dir.toward, distanceM: place.distanceM, mode, walkSpeed: s.walkSpeed, now, delayMin, route }) : null),
    [place, station, lineSel, dir, mode, s.walkSpeed, now, route, delayMin],
  )

  return (
    <div className="safe-top anim-fade-up absolute inset-0 z-40 flex flex-col bg-white">
      <ScreenHeader
        title={t('dep.title')}
        left={
          <button type="button" aria-label={t('common.back')} onClick={onClose} className="flex h-11 w-11 items-center justify-center">
            <ChevronLeft size={26} />
          </button>
        }
      />
      <div className="no-scrollbar flex-1 overflow-y-auto pb-8">
        {/* 출발지 */}
        <div className="no-scrollbar flex gap-2 overflow-x-auto px-5 pt-1">
          {s.places.map((pl) => {
            const Icon = KIND_ICON[pl.kind]
            const on = pl.id === place?.id
            return (
              <button key={pl.id} type="button" onClick={() => setPlaceId(pl.id)} className={`flex h-10 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[14px] font-semibold ${on ? 'bg-brand text-white' : 'border border-line'}`}>
                <Icon size={15} /> {placeLabel(pl, t)}
                {pl.example && <span className={`text-[11px] ${on ? 'text-white/80' : 'text-ink-2'}`}>{t('data.demo')}</span>}
              </button>
            )
          })}
          <button type="button" onClick={() => setAdding(true)} className="flex h-10 shrink-0 items-center gap-1 rounded-full border border-dashed border-[#C5CBD6] px-3.5 text-[14px] font-semibold text-ink-2">
            <Plus size={15} /> {t('dep.addPlace')}
          </button>
        </div>

        {!place || !station || !lineSel ? (
          <p className="px-5 py-12 text-center text-[15px] text-ink-2">{t('dep.empty')}</p>
        ) : (
          <>
            <div className="mt-4 px-5">
              <div className="flex items-center gap-2 text-[14px]">
                <MapPin size={16} className="text-brand-2" />
                <span className="font-semibold">{placeLabel(place, t)}</span>
                <span className="text-ink-2">→</span>
                <span className="font-bold">{stationName(station)}</span>
                <span className="text-ink-2">· {place.distanceM}m</span>
                <button
                  type="button"
                  aria-label={t('common.delete')}
                  onClick={() => {
                    s.patch({ places: s.places.filter((x) => x.id !== place.id) })
                    setPlaceId('')
                  }}
                  className="ml-auto text-[#A3AAB8]"
                >
                  <Trash2 size={17} />
                </button>
              </div>
              <div className="mt-3">
                <Segmented
                  value={mode}
                  onChange={setMode}
                  options={[
                    { value: 'walk', label: <span className="inline-flex items-center gap-1"><Footprints size={15} />{t('dep.walk')}</span> },
                    { value: 'bike', label: <span className="inline-flex items-center gap-1"><Bike size={15} />{t('dep.bike')}</span> },
                  ]}
                />
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {STATIONS[station].lines.map((l) => (
                  <button key={l} type="button" onClick={() => (setLine(l), setDirIdx(0))} className={`flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold ${l === lineSel ? 'bg-ink text-white' : 'bg-sub'}`}>
                    <LineBadge line={l} size={18} />
                  </button>
                ))}
                {dirs.map((d, i) => (
                  <button key={d.next} type="button" onClick={() => setDirIdx(i)} className={`h-9 rounded-full px-3 text-[13px] font-semibold ${i === dirIdx ? 'bg-brand-light text-brand' : 'bg-sub text-ink-2'}`}>
                    {t('dir.toward', { s: stationName(d.toward) })}
                  </button>
                ))}
              </div>
            </div>

            {p && (
              <>
                {now.getHours() >= 1 && now.getHours() < 5 && <p className="mx-5 mt-4 rounded-xl bg-[#FDF6DC] px-4 py-3 text-[13px] font-semibold text-[#8A6A00]">{t('dep.offHours')}</p>}
                {/* 결과 */}
                <div className="mx-5 mt-5 rounded-2xl bg-sub p-5 text-center">
                  <p className={`text-[22px] leading-snug font-extrabold ${STATUS_TONE[p.status]}`}>{t(STATUS_TEXT[p.status])}</p>
                  {p.status === 'hurry' && <p className="mt-1 text-[13px] font-semibold text-ink-2">{t('dep.noRun')}</p>}
                  <p className="mt-3 text-[14px] text-ink-2">{t('dep.leaveBy')}</p>
                  <p className="text-[40px] leading-none font-extrabold text-brand tabular">{formatClock(p.leaveBy)}</p>
                  <p className="mt-2 text-[14px] font-semibold">{t('dep.boardTrain', { time: formatClock(p.catchable.at) })}</p>
                  {p.status === 'transfer' && (
                    <button type="button" onClick={() => (onClose(), s.setTab('route'))} className="mt-3 h-10 rounded-xl bg-white px-4 text-[14px] font-bold text-brand">
                      {t('dep.checkRoutes')}
                    </button>
                  )}
                </div>

                {lineSel && (
                  <div className="mx-5 mt-3">
                    <DelayLine line={lineSel} />
                  </div>
                )}
                {/* 소요시간 분해 */}
                <div className="mx-5 mt-4">
                  <p className="mb-2 text-[14px] font-bold">{t('dep.breakdown', { n: Math.round(p.access.total) })}</p>
                  {[
                    [mode === 'walk' ? t('dep.walkMove') : t('dep.bikeMove'), p.access.move],
                    [t('dep.signals'), p.access.signals],
                    [t('dep.entrance'), p.access.entrance],
                    [t('dep.platform'), p.access.platform],
                  ].map(([label, m]) => (
                    <div key={label as string} className="flex justify-between py-1 text-[14px]">
                      <span className="text-ink-2">{label}</span>
                      <span className="font-semibold tabular">{t('unit.minDec', { n: (m as number).toFixed(1) })}</span>
                    </div>
                  ))}
                  <p className="mt-1 text-[12px] text-ink-2">{t('dep.speedNote', { v: s.walkSpeed.toFixed(2) })}</p>
                </div>

                {/* 다음 열차 */}
                <div className="mt-5 border-t border-line px-5 pt-4">
                  <div className="mb-2 flex items-center gap-2">
                    <h3 className="text-[15px] font-bold">{t('dep.trains')}</h3>
                    <DataTag kind="estimate" />
                    {delayMin > 0 && <span className="text-[12px] font-semibold text-danger">{t('delay.shifted', { n: delayMin })}</span>}
                  </div>
                  {p.trains.map((tr, i) => {
                    const late = tr.at.getTime() !== tr.scheduled.getTime()
                    const ok = tr.margin >= 0
                    const isCatch = tr === p.catchable
                    return (
                      <div key={i} className={`flex items-center gap-3 border-b border-line py-3 last:border-0 ${isCatch ? 'font-bold' : ''}`}>
                        <span className="w-14 text-[17px] tabular">{formatClock(tr.at)}</span>
                        {late && <span className="text-[12px] text-ink-2 line-through tabular">{formatClock(tr.scheduled)}</span>}
                        <span className="text-[13px] text-ink-2 tabular">{t('dep.inMin', { n: Math.max(0, Math.round((tr.at.getTime() - now.getTime()) / 60000)) })}</span>
                        <span className={`ml-auto text-[13px] ${ok ? (isCatch ? 'text-brand' : 'text-ok') : 'text-[#A3AAB8]'}`}>
                          {ok ? (isCatch ? t('dep.recommended') : t('dep.catchable')) : t('dep.missed')}
                        </span>
                      </div>
                    )
                  })}
                </div>

                <div className="mt-4 px-5">
                  <div className="mb-1 flex items-center gap-2">
                    <h3 className="text-[15px] font-bold">{t('dep.realtime')}</h3>
                    {rt && <DataTag kind="realtime" at={now} />}
                  </div>
                  {rt === undefined && <p className="text-[13px] text-ink-2">{t('common.loading')}</p>}
                  {rt === null && <p className="text-[13px] leading-relaxed text-ink-2">{t('dep.realtimeOff')}</p>}
                  {rt &&
                    rt.slice(0, 6).map((a, i) => (
                      <p key={i} className="py-1 text-[14px]">
                        {a.destination} {t('dir.bound')} · <span className="font-semibold">{a.message}</span>
                      </p>
                    ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
      <AddPlace open={adding} onClose={() => setAdding(false)} onAdded={(id) => setPlaceId(id)} />
    </div>
  )
}

function AddPlace({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: (id: string) => void }) {
  const s = useStore()
  const [kind, setKind] = useState<Place['kind']>('home')
  const [label, setLabel] = useState('')
  const [station, setStation] = useState('')
  const [dist, setDist] = useState(500)
  const [picker, setPicker] = useState(false)
  const { geo, locate } = useGeo()

  useEffect(() => {
    if (geo.status === 'ok' && geo.real) {
      const n = nearestStations(geo.lat, geo.lon, 1)[0]
      setStation(n.st.id)
      setDist(Math.max(50, Math.round((n.km * 1000) / 10) * 10))
    }
  }, [geo.status, geo.real, geo.lat, geo.lon])

  const kinds: { id: Place['kind']; key: MessageKey }[] = [
    { id: 'home', key: 'place.home' },
    { id: 'school', key: 'place.school' },
    { id: 'work', key: 'place.work' },
    { id: 'etc', key: 'place.etc' },
  ]
  return (
    <>
      <Modal
        open={open && !picker}
        onClose={onClose}
        title={t('dep.addPlace')}
        footer={
          <PrimaryButton
            disabled={!station}
            onClick={() => {
              const id = `p-${Date.now()}`
              s.patch({ places: [...s.places, { id, kind, label: label.trim() || t(kinds.find((k) => k.id === kind)!.key), station, distanceM: dist }] })
              onAdded(id)
              setLabel('')
              setStation('')
              onClose()
            }}
          >
            {t('common.save')}
          </PrimaryButton>
        }
      >
        <div className="space-y-4 px-5 pb-2">
          <div className="grid grid-cols-4 gap-2">
            {kinds.map((k) => (
              <button key={k.id} type="button" onClick={() => setKind(k.id)} className={`h-10 rounded-xl text-[14px] font-semibold ${kind === k.id ? 'bg-brand text-white' : 'bg-sub'}`}>
                {t(k.key)}
              </button>
            ))}
          </div>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('place.namePh')} className="h-12 w-full rounded-xl bg-sub px-4 text-[16px] outline-none" />
          <button type="button" onClick={() => s.withLocation(locate)} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-brand text-[15px] font-bold text-brand">
            <LocateFixed size={17} /> {geo.status === 'locating' ? t('geo.locating') : t('place.useLocation')}
          </button>
          {(geo.status === 'denied' || geo.status === 'unavailable') && <p className="text-[12px] text-danger">{t('geo.denied')}</p>}
          <button type="button" onClick={() => setPicker(true)} className="flex h-12 w-full items-center justify-between rounded-xl bg-sub px-4 text-left text-[15px]">
            <span className="text-ink-2">{t('place.station')}</span>
            <span className="font-bold">{station ? stationName(station) : t('common.select')}</span>
          </button>
          <div>
            <div className="flex justify-between text-[14px]">
              <span className="text-ink-2">{t('place.distance')}</span>
              <span className="font-bold tabular">{dist}m</span>
            </div>
            <input type="range" min={50} max={3000} step={50} value={dist} onChange={(e) => setDist(Number(e.target.value))} className="mt-2 w-full accent-[#293896]" />
          </div>
        </div>
      </Modal>
      <StationPicker open={picker} title={t('place.station')} onClose={() => setPicker(false)} onPick={(id) => (setStation(id), setPicker(false))} />
    </>
  )
}
