# Reinforcement learning plan: pan-tilt target search

## Goal and scope

Train the simulated PanTilt robot to aim its VL53L0X distance sensor at the existing Target component and hold detection. This replaces the earlier walking-forward task. Reuse the running Rapier simulation; do not add another physics engine. Training and evaluation stay local and offline, with no physical servo commands or device uploads.

Implementation status: Steps 1-8 now provide local TensorFlow.js initialization, rig validation, a shared sensor query, isolated Rapier episodes, bounded actions and normalized policy observations. AI Learning includes a dedicated 3D view and responsive lab interface. Reward scoring, a sensor-only raster baseline and clean curriculum stages are implemented; categorical PPO training and frozen-policy evaluation are implemented. Worker execution, policy file persistence and later sensor/clutter difficulty remain pending. WebGL initialization and the training smoke test pass in the browser; comparative GPU/CPU training benchmarks remain pending.

## Existing project integration

- Robot configuration: `data/robots/PanTilt/config.json`.
- Current pan/tilt chain: Robot -> Servo 1 -> Servo 1 Shaft -> Servo 4 -> Servo 4 Shaft -> VL53L0X V2 Time of Flight Sensor 1. Resolve the two controlled joints from this hierarchy, with explicit selection available; do not assume servo names or output channels identify axes.
- Target: `Target 1`, objectType `Target`. Its model in `data/components/Target.js` is a 10 mm ball and is nonphysical.
- Sensor: `data/components/VL53L0X.js`, emitting along local +Z from the optical package, currently using a simulated centre ray with a 2000 mm limit.
- `data/simulated-sensor.js` now owns simulated ray construction, sensing geometry and nearest-hit identity. `previewRayDistance()` in `data/app.js` remains a distance-only compatibility wrapper. Rendered surfaces are still used separately for camera previews.
- `data/physics.js` exposes `GhostPhysics`, motor updates, world points, resets and elapsed-time stepping. Training needs explicit simulation-time stepping independent of the display frame rate.

## Step 1 - Add TensorFlow.js

- [x] Add a pinned, tested TensorFlow.js browser distribution and record version, source and license. Use the existing plain JavaScript setup without introducing a frontend build pipeline.
- [x] Load it lazily when opening the training feature. Prefer a local vendored asset for offline use; avoid `@latest` and avoid loading a large library during normal controller startup.
- [x] Keep training assets on the local development host initially; decide explicitly whether to include them in controller filesystem packaging after checking size.
- [x] Implement initialization with `tf.ready()`, backend reporting and clear load/backend errors. Start by testing WebGL and CPU; benchmark before choosing the default. CPU fallback should warn that training may be slow.
- [x] Verify a tiny network can predict, perform a gradient update and dispose its tensors. Repeat updates and check that tensor counts do not grow without bound.

Validation so far: CPU prediction and 60 gradient updates pass with no tensor growth; loader retry, CPU fallback and asynchronous scene-change checks pass. Browser WebGL initialization, runtime timing comparisons and Rapier coexistence still need a browser check.

Acceptance: TensorFlow.js initializes locally and passes a training smoke check while the existing Rapier preview still works.

## Step 2 - Define the task and validate the rig

- [x] Select the robot, the sensor, its pan/tilt joints and the Target component explicitly. Reject missing, ambiguous or continuous-rotation joints for this first task.
- [x] Read angle limits, reversal and startup positions from configuration. Verify which axis each joint controls by moving it in simulation.
- [x] Define a fixed training base and stationary target in the task descriptor; reject a target parented through any actuator. Check that both selected joints change the sensor direction using the existing mount transforms.
- [x] Enforce that descriptor in the isolated Rapier training world and verify motor settling and sustained detection in a constructed visible scene (Step 4 real-WASM tests). The current saved rig must still pass setup validation before running.
- [x] Check the configured target is visible from at least one valid joint pose, inside sensor range, above the floor and outside the robot geometry. Report unreachable scenes before training.
- [x] Define success as the nearest sensor return hitting the selected target for 0.5 simulated seconds. Start with a 10-second episode limit. Treat these as configurable initial values.

Implemented in `data/ai-task.js` and AI Learning: explicit sensor/target/pan/tilt selectors, configurable hold/episode times, a Validate training rig button, and setup validation before TensorFlow initialization. Reachability uses bounded angular search plus local refinement and checks a 5 mm target sphere against component surfaces and the floor. Reversal is recorded as slider direction, consistent with the current controller; it is not applied a second time to joint kinematics. The check never changes preview angles or saved configuration.

An earlier PanTilt setup placed the target centre at floor level; validation correctly rejected it. Target positions are never automatically edited by learning initialization. A constructed visible scene passes; floor intersection, occlusion, range, joint selection, angle limits and hierarchy failures are covered by tests. No visible pose found means the bounded search failed, not a mathematical proof of unreachability.

Acceptance still requiring the training environment: a manually aimed sensor can detect the existing target and satisfy the hold condition under Rapier dynamics.

## Step 3 - Extract a reusable simulated sensor query

- [x] Move sensor origin/direction and intersection calculations out of drawing callbacks into a shared simulation module. Both the UI and training must use the same measurement function.
- [x] Return distance in millimetres, validity and nearest-hit component identity, including floor/no-hit cases. Preserve occlusion: a target hidden behind a closer object is not detected.
- [x] Include the nonphysical Target in sensing even though it has no Rapier collision body. Reuse its geometry or an explicitly documented matching analytic sphere.
- [x] Preserve the existing centre-ray model initially. Do not silently introduce a broad detection cone to make learning easier.
- [x] Keep selected-target identity available to reward/evaluation code only, not as an agent observation.

Implemented in `data/simulated-sensor.js`: `sensorRay`, `buildScene`, `raycast`, `read` and `observation`. Queries require no DOM, renderer or Rapier collider. `read` returns validity, millimetres, nearest-hit identity and world-space ray/hit points; `observation` exposes only validity and range for future policy inputs. Targets use an analytic sphere of radius 5 mm matching the model. Other components use shared model primitives (boxes and cylinders with 24 radial segments); loose Rapier cubes also occlude the beam. The floor is included regardless of grid visibility. Self geometry is excluded; all other components can occlude the target.

The distance panel, dotted sensor overlay and rig validator use this shared query. UI reads are cached per update so the panel and beam agree; their sensing geometry is independent of camera clipping and render callbacks. The old distance-only function is a compatibility wrapper. AI Learning has a Read selected sensor button for a one-shot diagnostic; it does not start training or move servos. Existing physical telemetry and the user's compact C clear button are preserved.

Validation: five sensor-query tests cover hit/miss identity, observation privacy, occlusion, range boundaries, orientation, floor, invalid rays, props and independence from render/order. Existing distance display, scan capture, mount and rig/runtime checks also pass. Browser visual verification remains pending.

Acceptance: targeted checks cover target hit, target miss, intervening geometry, floor, range limit and sensor orientation. Readings do not depend on rendering.

## Step 4 - Build a simulation-only environment

- [x] Add a small `reset(seed, options)` / `step(action)` environment interface, returning observations, reward, termination, truncation and diagnostic information.
- [x] Advance an exact number of fixed Rapier steps per action, initially a 20 Hz action rate with the existing physics timestep. Update servo motion using simulation time rather than wall-clock animations.
- [x] Reset joint states, motor targets, velocities, target pose, reading history, hold timer and physics accumulators. Use seeded randomness for reproducibility.
- [x] Run in an isolated training world so manual preview controls, macros, sequences and status polling cannot alter an episode.
- [x] Provide explicit disposal of worlds and models on stop, reload and errors. Keep manual preview behavior intact.

Implemented in `data/ai-environment.js`. Each environment owns a separate Rapier world and copied robot/task state. `reset(seed, options)` recreates the world, fixes the selected base, restores a stationary target, initializes bounded joint poses with seeded startup jitter, settles for 120 ticks outside episode time, and clears velocities/hold history. `step(action)` runs six 1/120-second physics ticks (20 Hz actions), or stops early on success, invalid state or timeout. No render or wall-clock timers advance this world.

The initial action contract is 0 hold, 1 pan minus 2 degrees, 2 pan plus 2 degrees, 3 tilt minus 2 degrees and 4 tilt plus 2 degrees. Commands obey configured limits and ramp at at most 60 degrees/second in simulation time. Observations currently contain actual joint angles, velocities and sensor range/validity; normalization/history is Step 5. Reward now follows the version-1 model in Step 6. Diagnostic `info` contains hit identity and hold/time state, separate from policy observations.

AI Learning initialization now creates the environment after scene/runtime validation. Reset episode uses the chosen integer seed; Step simulation advances one action; Stop environment frees the world. Mode changes, robot reloads, rig changes, errors and page unload dispose the environment. Manual preview motion does not affect the copied world. A separate read-only 3D view on the right of AI Learning now renders actual training-world poses from immutable snapshots, without replacing the Servo/Setup preview.

Validation uses the real bundled Rapier WASM: repeated seeded action sequences match exactly on this runtime; different seeds change startup poses; the base and target remain fixed; separate environments do not share state; commands clamp to limits; success occurs after exactly 60 target-hit ticks; timeouts truncate; reset/disposal rules are enforced. Existing Rapier physics, mounting and servo-limit regression checks pass. Browser controls have now been checked: WebGL initialization, isolated reset/step, telemetry, keyboard orbit and desktop/mobile layout.

Acceptance: repeated seeded resets/action sequences produce matching results on the tested runtime, with stepping independent of display frame rate. Cross-browser/platform bitwise determinism is not promised.

## Step 5 - Define observations and actions

- [x] Start with five discrete actions: pan left, pan right, tilt up, tilt down and hold. Use a small configurable angle increment, initially 2 degrees, subject to configured limits and simulated servo speed.
- [x] Observations include normalized actual joint angles, joint velocities, current valid range, a validity flag, previous action and a short fixed history of readings/actions. Use a separate flag for no hit; do not encode it as a real zero-distance return.
- [x] Exclude target coordinates, bearing, target-hit identity and hidden alignment error from the policy inputs. A range sensor alone cannot identify a target by object class; this initial simulation task assumes a controlled search scene with a distinguishable target return.
- [x] Use short history to help interpret range changes. If that is insufficient, evaluate a recurrent policy later instead of claiming a single distance reading fully describes the state.

Implemented in `data/ai-policy.js` and the isolated environment. The five action definitions are shared, immutable and bounded by the configured joints. `observation.policyVector` contains 29 values: four chronological frames of two angles normalized to [-1, 1], two velocities clipped after division by 180 degrees/second, range divided by 2000 mm and a validity flag, followed by five previous-action one-hot values. Missing range uses 1 with validity 0, distinct from a valid maximum-range return. Reset pads four copies of the initial frame and clears the previous action. History advances once per action, not on rendering or snapshots. No target geometry or hit identity enters this vector.

The raw joint/sensor fields remain available for diagnostics; the observation schema is versioned on the environment. Tests verify fixed dimensions, finite values, clipping, missing-range distinction, history order/reset and independence from privileged metadata.

Acceptance: observation dimensions and scaling are fixed and finite, and every action respects the selected joints' limits.

## Step 6 - Implement reward and episode outcomes

- [x] Reward nearest-hit detection of the selected target and sustained detection; give a terminal bonus after the hold threshold.
- [x] Apply a small time cost and movement cost. Penalize repeated commands into joint limits. Ensure holding a found target is better than jittering across it.
- [x] Initially use a small, bounded improvement-in-alignment reward computed from privileged simulator geometry to overcome sparse centre-ray hits. Label this as training-only shaping; never expose the geometry as observations.
- [x] Avoid rewarding mere proximity or any valid range return: detecting the floor or the robot is not success.
- [x] End episodes on success or invalid simulation state; truncate at the time limit. Log each reward term separately and check for reward exploits.

Implemented in `data/ai-reward.js`, reward schema version 1, with an inspectable breakdown per action and per episode. Scoring uses simulation time and actual joint travel, not rendering cadence. Defaults:

| Term | Rule |
| --- | --- |
| Time | -0.05 per simulated second |
| Detection | +0.25 once per episode for the first nearest return on the selected target |
| Hold | Change in squared hold progress, from 0 to +1; losing lock reverses accumulated hold credit |
| Alignment | 0.1 times the change in normalized forward-ray alignment to the target; privileged training-only geometry |
| Movement | -0.002 per degree of actual selected-joint travel, plus -0.001 per degree of commanded target change |
| Joint limits | -0.05 times the fraction of the requested 2-degree action clipped by joint limits |
| Completion | +10 once, when the target hold completes |
| Invalid state | -5 and episode termination |

Detection has a one-time budget and hold/alignment potential differences telescope over an episode. Repeated target acquisition/loss cannot repeatedly collect the detection bonus, and repeated aim oscillations cannot accumulate net alignment progress. This is bounded shaping, not a claim of discount-invariant optimal policies. No detection/hold/completion credit is awarded for a floor, robot, prop, wrong target or missing return. Rewards and their privileged diagnostics stay outside `observation.policyVector`.

The existing termination/truncation contract is preserved: success and invalid state terminate; the episode time limit truncates. Reset clears all reward state. AI Learning displays last-action and cumulative returns, all eight last-action terms and a training-only shaping explanation; the event console also logs the breakdown. No policy training is started by these controls.

Validation: five unit tests cover summed terms, reset credit, wrong surfaces, repeated acquisition/loss, alignment cycles, movement/limit costs and invalid states. A real-Rapier comparison in a constructed reachable scene gave episode returns of approximately +11.225 for already-aimed acquisition/hold, -0.500 for idle, -1.680 for oscillation, -1.378 for seeded random actions and -10.500 for limit pushing. These are reward sanity checks, not learned performance or a navigation baseline. A structured raster baseline and wider multi-seed evaluation belong to Step 7. Browser checks confirm zero return on reset, per-action term updates and no console errors.

Acceptance: deliberate target acquisition outscores the tested idle, seeded-random, oscillation, limit-pushing and wrong-surface cases. Broader reward tuning remains empirical.

## Step 7 - Establish a search baseline and curriculum

- [x] Implement a bounded raster-scan baseline using the same actions and sensor observations. Measure its success rate and acquisition time.
- [x] Begin with the existing target position and randomized nearby initial joint angles. This proves the loop works but does not demonstrate general search.
- [x] Expand to randomized reachable target bearings and ranges, held fixed within each episode. Keep a fixed set of held-out positions and starting poses for evaluation.
- [ ] Add clutter, noise, missed readings and smaller angular coverage only after the clean task works. Use privileged reachability checks when generating episodes, without passing that information to the agent.

Implemented as three DOM-free modules:

- `data/ai-baseline.js`: bounded serpentine raster scan, 2-degree row spacing, explicit homing and finite range-only hold attempts. The controller receives joint angles and sensor range/validity only. It never receives target coordinates, selected-target identity, reward terms or the rig validator's aiming solution.
- `data/ai-curriculum.js`: three explicitly selected stages: configured target with +/-5-degree startup jitter, configured target with +/-20-degree jitter, and seeded reachable target bearings/ranges with +/-10-degree startup jitter. Random target distances are sampled from 50-500 mm, checked above the floor and for nearest-hit visibility in a copied kinematic scene (up to 48 bounded attempts), then frozen for the episode. The preview/configuration is not changed.
- `data/ai-evaluation.js`: cooperative asynchronous runner with per-episode world disposal and cancellation. It computes success rate, successful-only median acquisition time, mean return, timeout/invalid counts and false-lock attempts. An unfinished episode is excluded from a cancelled run's summary.

Initial reproducibility banks are training seeds [11, 23, 37, 53, 71] and held-out evaluation seeds [10001, 10003, 10007, 10009, 10037]. These are a small clean-task reference bank, not sufficient evidence of broad generalization. Target positions/startup poses reproduce from the stage and seed. Case generation may use privileged geometry, but the raster policy cannot. False locks mean a hold attempt began on a non-selected surface; they are not reported as target acquisitions.

AI Learning adds stage/split/count controls, Evaluate raster scan and Cancel evaluation, live isolated-world playback and a results card with per-seed outcomes. Runs yield between actions to keep controls responsive. Manual Reset/Step are disabled while evaluating; Stop, mode/rig changes and page unload cancel and dispose active evaluation worlds. The normal manual world remains separate. After evaluation the last snapshot is marked RASTER / FINISHED; manual Reset/Step resumes the manual world.

Measured in the browser on the current PanTilt setup: nearby-start stage, evaluation seeds 10001/10003/10007, 10-second episode limit and 0.5-second target hold produced **0/3 successes**, three timeouts, zero invalid states, **25 false-lock attempts** and mean return approximately **-1.097**. There is no acquisition-time median because none succeeded. Per-seed returns were -1.094, -1.105 and -1.090. A generated-target evaluation for held-out seed 10001 also completed without physics errors: 0/1 successes, eight false-lock attempts and return -1.132 within 10 seconds. Browser cancellation was verified separately. A full two-axis scan at 2-degree spacing can exceed the episode budget, and distant 10 mm targets can fall between rows. This establishes the reference's limitations rather than claiming a learned improvement.

Tests cover row coverage in a small bounded rig, target-metadata independence, bounded hold attempts, deterministic visible-target generation, disjoint seed banks, real-Rapier acquisition from an already-aimed fixture, cancellation cleanup, false-lock counts and successful-only medians. Browser verification covers the actual held-out run, cancel controls, live playback and no console errors.

Clutter, noise and missed readings remain intentionally deferred until clean-task acquisition works reliably, as required by this step's conditional progression. They are not silently applied or described as implemented. No policy has been trained.

Acceptance: baseline performance and explicit curriculum settings are reported without claiming learned improvement.

## Step 8 - Implement PPO with TensorFlow.js

- [x] Use a small actor-critic network, initially two 64-unit hidden layers, with five action logits and one value estimate.
- [x] Implement categorical action sampling, rollout storage, generalized advantage estimation, normalized advantages, clipped PPO policy loss, value loss, entropy regularization and gradient clipping.
- [x] Bootstrap correctly on rollout boundaries and time-limit truncations; do not bootstrap true terminal successes/failures.
- [x] Record seeds and hyperparameters. Initial tuning candidates: 512-step rollouts, minibatches of 64, four update epochs, learning rate 0.0003, discount 0.99, GAE lambda 0.95 and clipping 0.2. Benchmark and adjust rather than treating these as proven settings.
- [x] Test advantage calculations, probability ratios, finite gradients, model updates and tensor cleanup independently of robot training.

Implemented in `data/ai-ppo.js` and `data/ai-training.js`:

- Shared two-layer 64-unit tanh trunk, categorical five-action logits and a scalar value head; only the 29-value policy vector enters the network.
- Seeded categorical sampling, on-policy rollouts and shuffled minibatches, normalized generalized advantages, clipped PPO policy objective, value regression, entropy regularization and global gradient-norm clipping.
- Each transition stores the next-state value: true terminal states bootstrap zero; time-limit truncations bootstrap the final observation's value but stop the GAE trace; rollout boundaries bootstrap without crossing reset episodes.
- Defaults: discount 0.99, lambda 0.95, clip 0.2, Adam learning rate 0.0003, four epochs, 64-sample minibatches, entropy coefficient 0.01, value coefficient 0.5 and max gradient norm 0.5. The browser defaults to four 128-step updates as a short diagnostic run. All settings are logged. Loss/entropy/KL display the last minibatch, not a claim of convergence.
- Explicit tensor cleanup covers prediction, gradients, optimizer state and model disposal. Cancelled collection discards an unfinished rollout. Stop during optimization retains any minibatches already applied; the counter reports complete updates only.

AI Learning provides Train policy, Pause/Resume, Stop training, frozen held-out evaluation and Discard policy. Further Train runs continue current weights and Adam state. Policy seed is locked while a model exists; discard to create a fresh seed. Stop training retains weights, while environment reinitialization, mode/rig changes or page reload clear them. Save/load files are not implemented yet.

The optional warm-start control uses the validator's visible aiming pose plus seeded +/-0.25-degree jitter at reset to learn holding first. This aid is labelled training-only; it does not enter the policy vector. Held-out evaluation always uses ordinary starts from the selected curriculum stage, with no aiming solution passed to the policy or reset. The raster reference stays separate. Training/evaluation worlds are disposed independently of the manual preview.

Validation: numerical tests cover terminal/timeout/rollout GAE, positive/negative clipping, finite gradient norms, preferred-action learning, cancellation and stable tensor counts. A categorical test increased rewarded-action probability from about 0.334 to 0.9998. On a simplified real-Rapier fixed target 80 mm away, seeded CPU PPO (16 x 64 steps, learning rate 0.001) increased hold probability from 0.196 to 0.483; deterministic evaluation changed from a 2-second timeout (return -0.209) to 0.5-second success (return +11.225). This is evidence of learning the easy hold task, not general target search.

Browser WebGL checks: four 128-step updates completed with finite metrics and two warm-start successes among four completed training episodes; pause froze simulation time, resume/stop retained weights, and frozen evaluation from an ordinary held-out start scored 0/1. No browser errors were observed. That short run has not demonstrated ordinary-start search.

Acceptance: finite losses and parameter updates, bounded tensor use, and measurable learning on the easy fixed-target hold case. Larger ordinary-start evaluation is still required before claiming improved search performance.

References: [PPO paper](https://arxiv.org/abs/1707.06347), [TensorFlow.js custom training](https://www.tensorflow.org/js/guide/train_models).

## Step 9 - Keep training responsive and add controls

Implemented: TensorFlow.js, PPO and the training/evaluation Rapier world run in a Web Worker. The UI receives throttled snapshots and metrics. Both worlds use the shared DOM-free mounting/geometry helpers in `data/ai-rig.js` and the same component scripts; no controller command API exists in the worker. Manual stepping and raster evaluation remain cooperative on the main thread.

- [x] Move the DOM-free environment and trainer into a Web Worker after the environment contract works. Verify the chosen TensorFlow.js backend is supported in that worker; use a supported fallback if needed.
- [x] Send throttled metrics and pose snapshots to the UI; do not send every physics step or let rendering determine training speed. Worker training/evaluation yields between actions and minibatches; snapshots are limited to roughly 10 per wall-clock second plus episode boundaries.
- [x] Add Start training, Pause, Resume, Stop, Evaluate, Save policy and Load policy controls. Show backend, episodes, simulation steps/second, reward, success rate and acquisition time.
- [x] Gate the entire feature on offline simulation. Do not route policy actions through the physical servo API. Switching robot, leaving offline mode or closing the session must stop the worker before any mode transition.

Verified in the browser: WebGL runs inside the worker, pause froze the displayed simulation at 4.30 seconds while recentering still worked, resume completed four 128-step updates, and export/discard/load restored a compatible policy. CPU worker tests cover training, pause/resume/stop, pending-request cancellation, stale-message rejection, malformed/incompatible loads retaining the current policy and complete tensor cleanup after discard. Auto mode falls back to CPU if worker WebGL cannot initialize.

Acceptance: controls remain responsive, repeated start/stop frees resources, and no training/evaluation operation sends a hardware command.

## Step 10 - Evaluate, save and document

- [x] Evaluate without updates on held-out seeds using a deterministic action policy. Report success rate, median acquisition time, joint travel, timeout rate and false-target detections beside the raster baseline.
- [x] Save network weights plus observation/action schema, joint mapping, sensor model, training settings, configuration fingerprint and evaluation summary. Reject incompatible policies on load.
- [x] Confirm a saved/reloaded policy reproduces evaluation behavior. Store exports locally, outside robot config/sequence files.
- [ ] Run JavaScript syntax checks, `node --check data/app.js`, relevant existing tests, targeted environment/PPO tests and `git diff --check`. Browser-check training, target acquisition, errors, stop behavior and memory over a sustained session.
- [x] Document remaining limitations: simplified sensor ray, privileged reward shaping, restricted initial scene and no physical transfer validation. Hardware integration remains a separate future task.

Policy file format v1 includes float32 weights, network/training settings, joint mappings, full observation/action contracts, centre-ray sensor/reward versions, simulation rates, a canonical rig/configuration fingerprint, task timing/target and available evaluation evidence. Load validates these before creating a replacement model. Files are local downloads, capped at 2 MB on import. They restore **weights only**: optimizer slots, random generator and partial rollout state restart. Starting further training invalidates older evaluation evidence.

The actual worker round-trip test confirms identical predictions, deterministic actions and held-out episode outcomes after reloading. It also checks unchanged tensor counts on invalid files and full release on discard. The short browser run's two warm-start successes among four episodes still do not establish ordinary-start search.

Remaining work: larger held-out banks, sustained performance testing, and repeatable ordinary-start acquisition. The simplified centre ray, privileged reward shaping and fixed-base simulation remain limitations. No physical transfer has been validated.

Acceptance: a repeatable local demo finds and holds the target, with saved evaluation evidence. Report actual results; do not assume the learned policy outperforms the baseline.

## References

- TensorFlow.js browser setup: https://www.tensorflow.org/js/tutorials/setup
- Custom training and optimizers: https://www.tensorflow.org/js/guide/train_models
- Browser backends and training guidance: https://www.tensorflow.org/js/guide/platform_environment

## AI Learning interface

The dedicated lab layout places mission configuration, episode controls and a bounded event console on the left, with the simulation twin and live telemetry on the right. Narrow screens stack the viewport above the controls. The view uses existing component geometry and depth renderer; it adds orbit/zoom, recentering, a centre-ray overlay and target marker. Before initialization it shows the configured rig; afterward it shows copied world-space body/shaft transforms from the isolated Rapier world. Rendering never advances physics or changes robot state.

Verified in the browser at desktop and 390 px width: scene visibility, WebGL initialization, a 50 ms step with changing joint pose/time, keyboard orbit, and absence of browser console errors. Reward terms, PPO controls and local policy persistence are now visible; the compute bar identifies the worker backend.

### Worker and persistence validation (2026-10-30)

The targeted suite, local runtime route, shared geometry/physics regressions and
worker checkpoint checks pass. Existing `test_linear_actuator.cjs` stops because
its VM fixture omits the already-used `clampServoCommand` helper; this is outside
the RL change. The latest `git diff --check` is clean. No firmware was changed or uploaded.

### Paired held-out evaluation

Evaluate learned policy now runs deterministic PPO followed by the raster reference
in the worker, using the same curriculum stage, held-out seeds, stationary targets,
ordinary initial poses and episode limits. Warm-start reset assistance is off for
both. Results include success/median acquisition/return, timeout rate, mean joint
travel, false sensor-return segments and wrong-surface hold attempts. The UI marks
cancelled comparisons incomplete and excludes unfinished episodes. Checkpoint
exports retain the paired results and completion flag.

Joint travel sums absolute measured pan/tilt motion at every 120 Hz physics tick,
excluding reset settling. False returns count contiguous runs of valid non-target
readings at 20 Hz, including a wrong return at reset. A false hold is a contiguous
run of Hold actions chosen while a non-target return is valid. These diagnostics
use ground truth after action selection and never enter the policy vector. Raster
lock-attempt counts remain separate from the shared false-hold metric.

Tests cover exact travel accounting, unknown diagnostic values, false-return and
false-hold transitions, identical seeds/targets/settled starting poses, unchanged
weights, checkpoint results and cancellation during the paired raster phase.

Browser benchmark: configured target / nearby stage, seed 42, one 64-step
warm-start training update, then ordinary held-out seeds 10001/10003/10007,
10-second episodes. PPO acquired 0/3 (mean return -1.429), raster acquired 0/3
(mean return -1.097). Mean actual joint travel was 274.9 versus 191.1 degrees;
false-return segments totalled 134 versus 3. Both timed out three times, with no
successful acquisition median. This is a short smoke run, not convergence or an
improvement claim. The worker/UI comparison finished without browser errors.

Validation: 21 targeted evaluation/environment/runtime/worker tests pass, including
real-Rapier travel/reset accounting, same-case comparison and cancellation.
JavaScript syntax checks and the current `git diff --check` pass. Nothing uploaded.

### Interactive frozen-policy test

AI Learning now has a dedicated Test Policy section: starting pan/tilt angles,
Run policy test, Stop test, latest action and final outcome/time/return/travel.
It runs the retained or loaded policy on the initialized target in a separate
worker-owned episode, with explicit starting angles and no jitter or warm-start
aid. Actions are paced near real time; weights and optimizer steps stay unchanged.
This is separate from paired held-out evaluation and does not overwrite its
evidence. Invalid start angles are rejected; cancellation retains the policy and
disposes the test world. Named actions/sequencer integration remains future work.

Evaluation reset audit: Servo 1 startup 90 degrees produced commands 94.318,
94.828 and 90.430 degrees on the first three held-out nearby seeds, not zero.
The raster controller intentionally homes to its minimum afterward. Evaluation
now publishes the reset snapshot before any action, logs commanded/measured
startup angles and the first PPO action, and labels raster homing explicitly.
Curriculum labels now say near startup angles rather than nearby starts. A real
Rapier regression verifies the 90-degree reset and that a Hold policy does not
home it. No physics or policy algorithm was changed by this visibility fix.

## Robust convergence monitoring

Implemented: the Simulation Twin header displays the latest complete monitoring
acquisition percentage, with stage-scoped validation status. It is not a probability
of optimality. See Help and devserver/README.md for exact quality/stability rules.

- [x] Separate reproducible versioned clean monitoring (50 seeds), training (5), and fresh final qualification (50 per attempt) banks. Repeating monitoring cases never adds independent samples.
- [x] Frozen evaluations between batches; track revision, completed updates, training steps, stage, bank and timestamp. Repeated unchanged checkpoints do not inflate stability.
- [x] Persist bounded history in policy files and display success, Wilson uncertainty, successful-only median time/travel, reward, false returns/holds, timeouts, invalid states and excluded partial results.
- [x] Require quality and stability over three distinct trained checkpoints; distinguish insufficient evidence, improving/unstable, plateaued below target, regressing, validation convergence and stale evidence.
- [x] Further training invalidates current evidence; load/restore archives are excluded from fresh windows, and rig/task compatibility is checked by policy loading.
- [x] Optional automatic early stopping, separate final-bank qualification and paired raster success comparison; manual budget override and best monitored checkpoint saving/restoration.
- [x] Test quality/low plateaus/regression/noise, small or repeated samples, cancellation, stale restores, worker weight invariance, duplicate evaluations, and long-RPC handling.
- [ ] Extend clean banks with occlusion, sensor noise and deadline variations after reliable acquisition.
- [ ] Replicate across independent policy training seeds before claiming robust generalization; current convergence is per policy/stage.
- [ ] Maintain cross-experiment final-bank provenance when users resume older files; a fresh worker can otherwise repeat an earlier reserved range.

### Devserver checkpoint storage

Save policy now writes a uniquely named JSON file to the project-root `training/`
folder when the local devserver is detected. A new timestamp/unique suffix avoids
overwriting previous checkpoints. The folder is Git-ignored and outside `data/`,
so it is excluded from controller filesystem uploads. Other hosts retain browser
downloads. The UI reports the saved relative path; Load policy can select that
file from disk. An old devserver produces an explicit restart instruction.

The local same-origin JSON endpoint enforces the existing request-origin checks,
a 2 MB policy limit, generated filenames and versioned numeric model data. Tests
cover real-policy round-trip storage, repeated saves, malformed/oversized input,
unsafe names and cross-origin rejection. No firmware changes are needed.

### Mount-aware angle correction and stationary-policy diagnostics

The layout now includes an inverted shaft-fixed TiltHead with a rotated body.
The old body-X/shaft-X angle formula incorrectly added its 90-degree mount
rotation to the policy observation: a commanded 90 degrees was reported near
180. Environment measurements now calibrate a stable moving-axis projection
against the initial mount frames, measure displacement about the fixed hinge
axis and apply the servo direction. Real-Rapier tests check a 90-degree reset
and bounded pan/tilt movements on this rig. No joint limits or robot layout
were changed.

Observation schema is now v2 so policies trained with the earlier incorrect
angles cannot silently load. Existing checkpoints remain on disk, but need
retraining for this format. Policy tests report counts for Hold and each movement
action. If all actions are Hold, the network has not demonstrated search; the
runner does not inject movement to disguise that outcome.

Validation after the mount correction: reset commands [90,90] measure about
[90.00,89.95], and ten Tilt - actions command 70 and measure about 69.93 degrees.
The short browser policy test selected 196 Pan + actions and recorded about
99.5 degrees of travel before timing out; this verifies execution, not learned
search. Tests also count requests clipped by joint limits.

The earlier 80 mm hold-learning benchmark no longer converged in 1,024 steps on
the updated rig/observations. The explicitly simplified hold smoke test now uses
a closer 30 mm target and the same 16x64 budget: hold probability increased from
0.196 to 0.776 and frozen evaluation changed from timeout to 0.5-second success.
This easier benchmark does not establish production-target acquisition. General
search and smoother curricula remain open work.

### Hold-only training failure: reward v2 and progressive acquisition

Corrective aiming previously earned much less reward than motion cost. The
geometry shaping now uses 1 - angular_error/pi with potential weight 4, preserving
no target geometry in observations. A real-Rapier counterfactual at ordinary
startup measured Hold -0.0025, movement toward the target +0.0361, and movement
away -0.0528. Both movement penalties and the completion/false-lock rules remain.
Reward model v2 invalidates old checkpoint compatibility.

A training-only bridge now interpolates from the aiming pose to ordinary startup
cases in six stages, promoting after >=80% success over at least 10 recent
frozen training-case probes and backing off after <=3 successes in 20. Progress resumes
across batches on the same stage. The UI shows current stage, interpolation and
training-case probe window; this is explicitly not convergence. Warm start with the
progression checkbox off retains the old holding-only behavior. Warm start off
uses ordinary cases. Held-out evaluation and policy testing remain unchanged and
do not force actions. Robust convergence and larger held-out banks remain TODO.

Progress checks now run five frozen training-case probes after each optimizer
update, without sampling the policy RNG or updating weights. Probe deadlines
allow the configured hold plus estimated direct approach time, capped by the
mission deadline. Advancement uses these probes rather than stochastic rollout
successes, so exploration does not obscure a learned holding skill. These are
training-case checks, not held-out convergence evidence.

## Full Auto Train (implemented)

The current loop uses progressive training, 50-case monitoring, startup testing,
optional early stopping after stability, and separate 50-case final qualification
with a same-case raster comparison. Limits explicitly remain unqualified; best
monitored weights are saved at the limit. Current qualified weights are saved
after final pass. Stop cancels the entire loop; restore best restarts optimizer
and requires fresh evidence. See Robust convergence monitoring above.

No smoke test demonstrates a learned search policy; convergence tests verify the
calculation and orchestration, not that arbitrary training will reach the target.
