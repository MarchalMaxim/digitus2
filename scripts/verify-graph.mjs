// The verify scheduler (issue 134): runs the steps of scripts/verify.mjs as a graph instead of one
// after another. A step starts once the steps it depends on have passed; its preconditions (a built
// engine, a dataset) are checked only then, by its own prepare(). Heavy steps (the ones that use
// every core, or that sample time like the playback specs) never overlap one another.

/**
 * @typedef {{ cmd: string, args: string[], note?: string } | { skip: string }} Plan
 * @typedef {{ name: string, deps?: string[], heavy?: boolean, prepare: () => Plan }} Step
 * @typedef {{ name: string, status: 'PASS' | 'FAIL' | 'SKIP', detail: string }} Result
 */

/**
 * Runs the selected steps and resolves with their results in the listed order.
 * `start(step, plan)` runs one command and resolves with `{ ok }`; `only` names the selected steps
 * (all when empty); a dependency that is not selected is not waited for. `serial` runs one step at a
 * time in the listed order, as verify did before.
 * @param {Step[]} steps
 * @param {{ start: (step: Step, plan: Plan) => Promise<{ ok: boolean }>, only?: Set<string>, serial?: boolean, onSkip?: (result: Result) => void }} options
 * @returns {Promise<Result[]>}
 */
export async function runGraph(
  steps,
  { start, only = new Set(), serial = false, onSkip = () => {} },
) {
  const selected = steps.filter((s) => only.size === 0 || only.has(s.name));
  const names = new Set(selected.map((s) => s.name));
  /** @type {Map<string, Result>} */
  const done = new Map();
  const waiting = [...selected];
  const running = new Set();
  let heavyRunning = false;

  return new Promise((resolve) => {
    const finish = (step, result) => {
      done.set(step.name, result);
      running.delete(step.name);
      if (step.heavy) heavyRunning = false;
      schedule();
    };
    const schedule = () => {
      // A step that is skipped settles at once, which can free a step listed before it: pass again.
      let settled;
      do {
        settled = done.size;
        pass();
      } while (done.size > settled);
      if (waiting.length === 0 && running.size === 0)
        resolve(selected.map((s) => done.get(s.name)));
    };
    const pass = () => {
      for (const step of [...waiting]) {
        if (serial && running.size > 0) break;
        const deps = (step.deps ?? []).filter((d) => names.has(d));
        if (deps.some((d) => !done.has(d))) {
          if (serial) break;
          continue;
        }
        const blocked = deps.find((d) => done.get(d).status !== 'PASS');
        if (blocked) {
          waiting.splice(waiting.indexOf(step), 1);
          const reason = done.get(blocked).status === 'FAIL' ? 'failed' : 'did not run';
          const result = {
            name: step.name,
            status: 'SKIP',
            detail: `not run: ${blocked} ${reason}`,
          };
          onSkip(result);
          done.set(step.name, result);
          continue;
        }
        if (step.heavy && heavyRunning) {
          if (serial) break;
          continue;
        }
        waiting.splice(waiting.indexOf(step), 1);
        const plan = step.prepare();
        if ('skip' in plan) {
          const result = { name: step.name, status: 'SKIP', detail: plan.skip };
          onSkip(result);
          done.set(step.name, result);
          continue;
        }
        running.add(step.name);
        if (step.heavy) heavyRunning = true;
        const began = Date.now();
        start(step, plan).then(({ ok }) => {
          const seconds = ((Date.now() - began) / 1000).toFixed(1);
          const detail = plan.note ? `${seconds}s, ${plan.note}` : `${seconds}s`;
          finish(step, { name: step.name, status: ok ? 'PASS' : 'FAIL', detail });
        });
        if (serial) break;
      }
    };
    schedule();
  });
}
