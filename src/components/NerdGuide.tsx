// Research-paper-style explainer for the math and physiology behind the
// prediction model. Linked from the "How it works" disclosure on the home
// screen.

interface NerdGuideProps {
  onClose: () => void
}

export function NerdGuide({ onClose }: NerdGuideProps) {
  return (
    <article className="nerd-guide">
      <header className="nerd-header">
        <button className="nerd-back" type="button" onClick={onClose}>
          ← Back
        </button>
        <h1>A Critical-Power Model for Rowing-Erg Workouts</h1>
        <p className="nerd-byline">
          A walk through the math and physiology behind Ergometry’s predictions.
        </p>
      </header>

      <section className="nerd-abstract">
        <h2>Abstract</h2>
        <p>
          We predict per-interval splits for arbitrary indoor-rowing workouts
          by combining four classical ingredients: Concept2’s power–pace
          identity, Monod &amp; Scherrer’s critical-power hyperbola, Morton’s
          3-parameter sprint ceiling, and Skiba’s differential W′
          balance with empirical recovery time-constant. A single 2K time
          plus a tier (or a 2K/6K pair) fits all parameters; the solver
          allocates effort across an interval set by bisecting a shared
          scalar that scales each interval’s solo-max power down until the
          whole workout is W′-feasible.
        </p>
      </section>

      <section>
        <h2>1. The Concept2 power–pace law</h2>
        <p>
          The PM5 displays a 500m split <em>s</em> (s/500m) computed from
          flywheel power <em>P</em> (W) by the published relation
        </p>
        <p className="eq">
          P = 2.80 · v<sup>3</sup>, &nbsp;&nbsp; v = 500 / s &nbsp;⇒&nbsp;
          P = K / s<sup>3</sup>,&nbsp; K = 2.80 · 500<sup>3</sup> ≈ 3.5 × 10<sup>8</sup>.
        </p>
        <p>
          This is the bridge between any physiological power model and the
          on-screen split. A 2K average split of 1:45 (s = 105 s/500m)
          corresponds to P ≈ 302 W; halving the split would multiply
          power by eight.
        </p>
      </section>

      <section>
        <h2>2. The critical-power hyperbola</h2>
        <p>
          The 2-parameter <em>critical power</em> model of Monod &amp;
          Scherrer (1965), popularised in rowing by Skiba, posits that
          the highest constant power <em>P</em> sustainable for duration
          <em> t</em> satisfies the hyperbola
        </p>
        <p className="eq">
          P(t) = CP + W′ / t.
        </p>
        <p>
          <em>CP</em> (W) is interpreted as the upper bound of fully aerobic
          sustainable power — the asymptote of indefinite work — and
          <em> W′</em> (J) as a finite, work-above-CP reservoir that
          empties when <em>P&nbsp;&gt;&nbsp;CP</em> and refills when
          <em> P&nbsp;≤&nbsp;CP</em>. Equivalently, total work above CP
          in any single all-out effort is fixed: <em>(P − CP)·t = W′</em>.
        </p>
        <p>
          Closing a 2K of duration <em>t<sub>2K</sub></em> at average
          power <em>P<sub>2K</sub></em> pins one point on this curve. With
          a tier-implied ratio <em>r = CP / P<sub>2K</sub></em> we recover
          both parameters from a single 2K:
        </p>
        <p className="eq">
          CP = r · P<sub>2K</sub>,&nbsp;&nbsp; W′ = (P<sub>2K</sub> − CP) · t<sub>2K</sub>.
        </p>
        <p>
          When the athlete also supplies a 6K time we drop the assumed
          <em> r</em> and solve the two-point linear least-squares fit of
          <em> P = CP + W′/t</em> instead (closed-form normal equations on
          the design columns <em>[1, 1/t]</em>).
        </p>
      </section>

      <section>
        <h2>3. The Morton 3-parameter sprint ceiling</h2>
        <p>
          The pure CP hyperbola diverges at <em>t→0</em>: at one second it
          predicts an impossible 350 kW for a strong rower. Morton (1996)
          replaced it with a 3-parameter form having a finite peak
          asymptote:
        </p>
        <p className="eq">
          P(t) = CP + W′<sub>M</sub> / (t + k).
        </p>
        <p>
          <em>k</em> (s) is a time offset; <em>W′<sub>M</sub></em> is the
          Morton anaerobic capacity (larger than the Skiba <em>W′</em> by
          a factor (t<sub>2K</sub> + k) / t<sub>2K</sub>). The peak
          attainable power is then <em>P<sub>peak</sub> = CP + W′<sub>M</sub>/k</em>,
          reached only instantaneously. We fix <em>k</em> by requiring
          two anchors to hold simultaneously: P(t<sub>2K</sub>) = P<sub>2K</sub>
          and P(0) = r<sub>p</sub> · P<sub>2K</sub>, giving
        </p>
        <p className="eq">
          k = t<sub>2K</sub> · (1 − r) / (r<sub>p</sub> − 1).
        </p>
        <p>
          Here <em>r<sub>p</sub> = P<sub>peak</sub>/P<sub>2K</sub></em> is the
          tier’s <strong>peak ratio</strong>. The model uses <em>P<sub>Morton</sub>(t)</em>
          only as a <em>ceiling</em>: no constant interval can be solved
          to a power above it.
        </p>
      </section>

      <section>
        <h2>4. Tier calibration</h2>
        <p>
          Two scalars per tier — <em>r = CP/P<sub>2K</sub></em> (long-end
          aerobic fraction) and <em>r<sub>p</sub> = P<sub>peak</sub>/P<sub>2K</sub></em>
          (short-end sprint reserve) — fully determine the curve.
        </p>
        <table className="nerd-table">
          <thead>
            <tr><th>Tier</th><th>r</th><th>r<sub>p</sub></th><th>Anchor</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>World-class</td><td>0.75</td><td>1.7</td>
              <td>Jensen 6K/60′ benchmarks</td>
            </tr>
            <tr>
              <td>Competitive</td><td>0.70</td><td>1.8</td>
              <td>Univ-program 2K/6K pairs (n=24, fleet median)</td>
            </tr>
            <tr>
              <td>Recreational</td><td>0.62</td><td>1.5</td>
              <td>Fleet slowest third + beginner guides</td>
            </tr>
          </tbody>
        </table>
        <p>
          Less-aerobic athletes have <em>both</em> lower <em>r</em>
          (more pace fade past 2K) and lower <em>r<sub>p</sub></em>
          (less sprint reserve above 2K) — that pairing is empirical,
          not a modelling axiom, and it’s why a recreational rower’s
          500m time-trial isn’t much faster than their 2K pace.
        </p>
        <p>
          A small <em>log-decay</em> term on CP is applied for pieces
          beyond ~30 minutes to capture the slow drift that the pure
          hyperbola underestimates:
        </p>
        <p className="eq">
          CP<sub>eff</sub>(t) = CP · (1 − k<sub>d</sub>·log<sub>10</sub>(t/t<sub>2K</sub>)),&nbsp;
          k<sub>d</sub> = 0.16·(1 − r).
        </p>
        <p>
          The 0.16 coefficient is anchored to match Jensen’s world-class
          60′ split; scaling by <em>(1 − r)</em> hands less-aerobic athletes
          steeper long-end fade, again matching field data.
        </p>
      </section>

      <section>
        <h2>5. W′ balance during a workout</h2>
        <p>
          The instantaneous anaerobic reserve W′<sub>bal</sub>(t)
          drains linearly when <em>P&nbsp;&gt;&nbsp;CP</em> and refills
          exponentially toward W′ when <em>P&nbsp;≤&nbsp;CP</em>. The
          discrete update over a small step Δt is
        </p>
        <p className="eq">
          P &gt; CP:&nbsp; ΔW′<sub>bal</sub> = −(P − CP) · Δt.
        </p>
        <p className="eq">
          P ≤ CP:&nbsp; ΔW′<sub>bal</sub> = (W′ − W′<sub>bal</sub>) · (1 − e<sup>−Δt/τ</sup>).
        </p>
        <p>
          The recovery time-constant <em>τ</em> (s) follows Skiba et al.
          (2012)’s empirical fit to constant-power recovery trials:
        </p>
        <p className="eq">
          τ(P) = 546 · exp(−0.01 · (CP − P)) + 316.
        </p>
        <p>
          Practical readings: at rest (P ≈ 0) τ ≈ 600&nbsp;s,
          so a minute of full rest refills roughly 10% of the gap;
          at light paddle τ stretches to ~750&nbsp;s; at UT2 (0.75·CP)
          τ is north of a thousand, so recovery during easy rowing
          is meaningful but slow.
        </p>
      </section>

      <section>
        <h2>6. Training bands and the anaerobic continuum</h2>
        <p>
          Three sub-CP <em>bands</em> are pinned directly from CP, after
          the conventional rowing zones:
        </p>
        <table className="nerd-table">
          <thead>
            <tr><th>Band</th><th>P</th><th>Physiological label</th></tr>
          </thead>
          <tbody>
            <tr><td>UT2</td><td>0.75 · CP</td><td>Deep aerobic / utilisation-2</td></tr>
            <tr><td>UT1</td><td>0.90 · CP</td><td>Top aerobic / utilisation-1</td></tr>
            <tr><td>AT</td><td>1.00 · CP</td><td>Maximal Lactate Steady State</td></tr>
          </tbody>
        </table>
        <p>
          Above CP the model abandons named zones in favour of a
          continuum. <strong>Max</strong> requests the solver pick the
          hardest constant power for which the workout still satisfies
          minW′<sub>bal</sub> ≥ 0 — what a holistic, set-balanced coach
          would prescribe. The <strong>Anaerobic</strong> control places
          the interval anywhere on the segment from AT (P = CP, slider
          at left) to Max (slider at right), by locking the end-of-work
          W′<sub>bal</sub> percent and letting the solver back-solve the
          power. The two endpoints exactly match the corresponding pills.
        </p>
      </section>

      <section>
        <h2>7. The interval solver</h2>
        <p>
          For a workout with <em>N</em> intervals, we partition into
          sub-problems at lock boundaries: each maximal contiguous run
          of unlocked intervals is solved to a shared scalar α, while a
          run that ends in an Anaerobic lock is solved to hit the
          prescribed end-of-work W′<sub>bal</sub> target.
        </p>
        <p>
          Within a sub-problem we first compute each unbanded interval’s
          <em> solo-max</em> power <em>p<sub>i</sub><sup>solo</sup></em> (the
          power at which that interval alone, starting full, would exhaust
          W′ exactly). We then parameterise the powers by a single
          scalar α and bisect:
        </p>
        <p className="eq">
          0 ≤ α ≤ 1:&nbsp; recovery branch, P<sub>i</sub> ∈ [P<sub>min-rec</sub>, CP<sup>−</sup>] (linear interp).
        </p>
        <p className="eq">
          1 &lt; α ≤ 2:&nbsp; drain branch, P<sub>i</sub>(α) = CP + (α − 1)·(p<sub>i</sub><sup>solo</sup> − CP).
        </p>
        <p>
          α is monotone in <em>min&nbsp;W′<sub>bal</sub></em> across the
          sub-problem on the drain branch and monotone in
          <em> final&nbsp;W′<sub>bal</sub></em> on each branch, so bisection
          converges in ≤ 80 steps. Banded intervals are pinned to their
          band power and don’t participate in the α scaling — they
          consume or restore a fixed amount of W′ at every α.
        </p>
        <p>
          Because solo-max powers are computed against the Morton ceiling
          rather than the pure CP+W′/t curve, the sprint regime is bounded
          even for hard 250m reps: a recreational athlete’s 250m solo-max
          is capped at ≈ 1.5 · P<sub>2K</sub>, not the runaway value the
          2-parameter form would produce.
        </p>
      </section>

      <section>
        <h2>8. Limitations</h2>
        <ul>
          <li>
            <strong>Constant power per interval.</strong> The solver assumes
            a single power throughout each work phase; variable pacing
            (negative splits, fly-and-die) isn’t modelled.
          </li>
          <li>
            <strong>Skiba’s τ was fit on cycling and running.</strong> Rowing
            recoveries may differ; we use the published formula because
            no rowing-specific equivalent of comparable quality exists.
          </li>
          <li>
            <strong>Single-day fatigue only.</strong> No multi-session
            accumulation, no thermoregulatory or hydration penalties.
          </li>
          <li>
            <strong>Tier ratios are population-average.</strong> Individual
            (r, r<sub>p</sub>) can deviate by ±0.05 from the tier;
            providing a 6K shrinks the long-end uncertainty but not the
            short-end one.
          </li>
        </ul>
      </section>

      <section className="nerd-refs">
        <h2>References</h2>
        <ol>
          <li>
            Monod H, Scherrer J. <em>The work capacity of a synergic muscular
            group.</em> Ergonomics 1965; 8: 329–338.
          </li>
          <li>
            Morton RH. <em>A 3-parameter critical power model.</em> Ergonomics
            1996; 39: 611–619.
          </li>
          <li>
            Skiba PF, Chidnok W, Vanhatalo A, Jones AM. <em>Modeling the
            expenditure and reconstitution of work capacity above critical
            power.</em> Med Sci Sports Exerc 2012; 44: 1526–1532.
          </li>
          <li>
            Jensen K. <em>Test procedures for rowing.</em> FISA Coaches
            Conference, 2002 — long-piece pace anchors.
          </li>
          <li>
            Concept2. <em>Calculating Power.</em>{' '}
            <a href="https://www.concept2.com/indoor-rowers/training/calculators/watts-calculator"
               target="_blank" rel="noreferrer">
              concept2.com/indoor-rowers/training/calculators
            </a>
            &nbsp;— the K = 2.80 power–pace relation.
          </li>
        </ol>
      </section>

      <footer className="nerd-footer">
        <button className="nerd-back" type="button" onClick={onClose}>
          ← Back
        </button>
      </footer>
    </article>
  )
}
