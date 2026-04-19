export type Tier = 'world-class' | 'competitive' | 'recreational' | 'custom'

export interface TierDef {
  id: Tier
  label: string
  description: string
  cpRatio: number
  /**
   * Peak-power ratio P_peak/P_2K at t→0. Used by the Morton 3-param ceiling
   * P(t) = CP + W'/(t+k) to bound sustainable power on short pieces; the
   * ceiling asymptotes to peakRatio·P_2K and merges with CP+W'/t at 2K+.
   *
   *  - World-class 1.7: anchored to Jensen 6K/60' with k ≈ 120s.
   *  - Competitive 1.8: best fit to fleet middle third (n=8, MAE 14.6s).
   *  - Recreational 1.5: best fit to fleet slowest third (MAE 12.0s) — slower
   *    athletes have less anaerobic reserve above 2K, not more.
   */
  peakRatio: number
}

// Tier ratios for CP/P_2K anchor the long-duration end; peakRatio anchors the
// short-duration end. See scripts/morton-tier-fit.mjs for the calibration.
//
//  - World-class: CP/P_2K = 0.75, the least-squares fit of CP + W'/t to
//    Jensen's three long-duration anchors (2K=100%, 6K=85%, 60min=76%
//    of P_2K). Adding rp=1.7 reproduces Jensen's 6K/60' while giving a
//    finite P_peak ≈ 1.7·P_2K at t→0.
//  - Competitive: CP/P_2K = 0.70 calibrated from real (2K, 6K) pair data
//    for a small university program (n=24), empirical median 0.70, fleet
//    6K-2K split gap +9.5s/500m. rp=1.8 fits the middle third tightly.
//  - Recreational: lower end of that sample + C2 beginner guides; rp=1.5
//    reflects smaller sprint reserve above 2K for less-aerobic rowers.
export const TIER_DEFS: Record<Exclude<Tier, 'custom'>, TierDef> = {
  'world-class': {
    id: 'world-class',
    label: 'World-class',
    description:
      'Elite / international rowers; very aerobic, small fade to 6K / 60\u2032.',
    cpRatio: 0.75,
    peakRatio: 1.7,
  },
  competitive: {
    id: 'competitive',
    label: 'Competitive',
    description:
      'Collegiate / club / masters racers; typical 6K ~8-11s/500m slower than 2K.',
    cpRatio: 0.7,
    peakRatio: 1.8,
  },
  recreational: {
    id: 'recreational',
    label: 'Recreational',
    description: 'Casual / fitness rowers; larger 2K fade to longer pieces.',
    cpRatio: 0.62,
    peakRatio: 1.5,
  },
}

export const DEFAULT_CUSTOM_CP_RATIO = 0.7
export const DEFAULT_CUSTOM_PEAK_RATIO = 1.8
