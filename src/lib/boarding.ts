// ─────────────────────────────────────────────────────────────
// 스마트 출발 도우미 공통 계산 — 홈 · 경로 · 지금 어디? 에서 모두 이 로직을 사용
// "지금 출발하면 뛰어야 할까?" : 실제 도보시간과 열차 출발시각을 비교
// ─────────────────────────────────────────────────────────────
import { ADJ, LINES, hashString, terminusFrom, type LineId } from '../data/network'
import type { MessageKey } from '../i18n'
import type { Route } from './routing'

export type Mode = 'walk' | 'bike'

/** 출발지 → 승강장 도착까지 걸리는 시간(분) */
export function accessMinutes(distanceM: number, mode: Mode, walkSpeed: number) {
  const pathM = distanceM * 1.25 // 실제 보행 경로는 직선거리보다 김
  const move = mode === 'walk' ? pathM / (walkSpeed * 60) : pathM / 230 + 1.5 // 자전거: 거치 시간 포함
  const signals = (distanceM / 350) * 0.6 // 신호 대기
  const entrance = distanceM > 0 ? 1 : 0 // 출입구 → 개찰구
  const platform = 1.5 // 개찰구 → 승강장
  return { total: move + signals + entrance + platform, move, signals, entrance, platform }
}

/**
 * 예상 시각표 — 운행 간격 기반 (공식 시간표 API 미연동 시 '예상'으로 표시)
 * delayMin: 운행 지연(분) 만큼 실제 출발이 늦어짐
 */
export function nextDepartures(station: string, line: LineId, toward: string, now: Date, count = 4, delayMin = 0) {
  const h = LINES[line].headway
  const offset = hashString(station + line + toward) % h
  const sec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds() - delayMin * 60
  const first = Math.ceil((sec - offset) / h) * h + offset
  return Array.from({ length: count }, (_, k) => {
    const scheduled = new Date(now)
    scheduled.setHours(0, 0, 0, 0)
    scheduled.setSeconds(first + k * h)
    return { scheduled, at: new Date(scheduled.getTime() + delayMin * 60000) }
  })
}

export type DepartureStatus = 'relaxed' | 'enough' | 'hurry' | 'next' | 'delayed' | 'transfer'

export const STATUS_TEXT: Record<DepartureStatus, MessageKey> = {
  relaxed: 'dep.relaxed',
  enough: 'dep.enough',
  hurry: 'dep.hurry',
  next: 'dep.next',
  delayed: 'dep.delayed',
  transfer: 'dep.transfer',
}

export const STATUS_TONE: Record<DepartureStatus, string> = {
  relaxed: 'text-ok',
  enough: 'text-ok',
  delayed: 'text-brand',
  hurry: 'text-[#B57714]',
  next: 'text-[#B57714]',
  transfer: 'text-[#B57714]',
}

export function directionsOf(station: string, line: LineId) {
  return (ADJ[line].get(station) ?? []).map((nb) => {
    const term = terminusFrom(line, station, nb)
    return { next: nb, toward: (ADJ[line].get(term)?.length ?? 0) === 1 ? term : nb }
  })
}

/** 경로의 첫 탑승 노선·방향 */
export function firstBoarding(route: Route) {
  const seg = route.segments[0]
  const term = terminusFrom(seg.line, seg.stations[0], seg.stations[1])
  return { station: seg.stations[0], line: seg.line, toward: (ADJ[seg.line].get(term)?.length ?? 0) === 1 ? term : seg.stations[1] }
}

export interface BoardingInput {
  station: string
  line: LineId
  toward: string
  /** 승강장까지 남은 거리(m) — 이미 역 안이면 0 */
  distanceM: number
  mode: Mode
  walkSpeed: number
  now: Date
  delayMin?: number
  route?: Route | null
}

export function planBoarding(i: BoardingInput) {
  const delay = i.delayMin ?? 0
  const access = accessMinutes(i.distanceM, i.mode, i.walkSpeed)
  const trains = nextDepartures(i.station, i.line, i.toward, i.now, 5, delay).map((d) => ({
    ...d,
    margin: (d.at.getTime() - i.now.getTime()) / 60000 - access.total,
  }))
  const first = trains[0]
  const catchable = trains.find((x) => x.margin >= 0) ?? trains[trains.length - 1]
  let status = (first.margin >= 4 ? 'relaxed' : first.margin >= 1.5 ? 'enough' : first.margin >= 0 ? 'hurry' : 'next') as DepartureStatus
  // 지연 덕분에 탑승 가능해진 경우
  if (delay > 0 && first.margin >= 0) {
    const undelayed = (first.scheduled.getTime() - i.now.getTime()) / 60000 - access.total
    if (undelayed < 1.5) status = 'delayed'
  }
  const leaveBy = new Date(catchable.at.getTime() - access.total * 60000)
  return { access, trains, catchable, status, leaveBy }
}

// ── 스마트 환승 판단 (출발 도우미와 같은 기준) ─────────────────
export type TransferStatus = 'relaxed' | 'hurry' | 'tight' | 'next'
export const TRANSFER_TEXT: Record<TransferStatus, MessageKey> = {
  relaxed: 'tr.statusOk',
  hurry: 'tr.statusHurry',
  tight: 'tr.statusTight',
  next: 'tr.statusNext',
}
export function transferStatus(marginSec: number): TransferStatus {
  if (marginSec >= 60) return 'relaxed'
  if (marginSec >= 30) return 'hurry'
  if (marginSec >= 0) return 'tight'
  return 'next'
}
