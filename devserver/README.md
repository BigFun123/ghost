# Local config server

From the project root, run:

```powershell
node devserver/server.js
```

Open http://127.0.0.1:8080. An optional port can be supplied, for example `node devserver/server.js 8081`.

The server binds only to 127.0.0.1, serves the files in data/, and opens the UI on the Mixer page in offline simulation mode. Save config in Setup or Servo Settings writes data/config.json directly, using a temporary file and rename. The A–J buttons select data/sequence_a.json through data/sequence_j.json. Sequencer edits (add, update, delete, reorder, loop, finish and clear) save automatically to the selected file. Refresh starts on slot A. Until sequence_a.json is first saved, slot A loads the existing data/sequence.json; other missing slots start empty. Selecting a sequence does not change data/config.json. Other local static servers still download the config as before.

No packages are required. Use Node.js 18 or newer. Stop with Ctrl+C. Nothing is uploaded to the ESP8266; firmware/device commands are not provided by this server. Keep the browser tab open while editing, and reload if the component list was changed elsewhere.

Restart the server after changing server.js so the updated API handlers take effect.

The `o` button adds an LED color step. Its R/G/B buttons toggle each channel
on or off, allowing mixed colors (all off turns the LED off). Color steps save
in the selected sequence, work in nested sequence calls, and set the board LED
when played on the controller. They pause for 100 ms at normal playback rate;
the LED keeps its color until another color step or a restart. Local simulation
plays these steps without sending hardware commands.
Playback also works when the PCA9685 is disconnected: unavailable servo outputs
are skipped while LED steps and sequence calls continue. Capturing a new motion
step still requires the configured servos to be available.

Below the step list, + appends a motion step and > appends a sequence call. Use the call step's dropdown to choose A–J. Calls run the selected sequence once, including nested calls, then resume the caller. Only the sequence started with Play repeats when Loop is enabled. Circular calls and chains exceeding 4096 motion steps are rejected before motion starts. Stop cancels the entire chain.

The frontend uses /api/sequence/a through /api/sequence/j for explicit file selection. Restart an older devserver before using these routes; outdated servers will fail the request instead of silently saving sequence.json.

The local server proxies the online shop catalogue and parts-list requests through the same origin, avoiding browser CORS preflight failures during local development.

Rapier physics loads from `data/lib/rapier.js` using a dynamic import and its embedded WebAssembly compatibility package. The devserver and controller serve it locally; no internet access, bundler or npm install is required. Loading failure leaves the controller usable and the Physics button retries. Physics pauses when the view is hidden.

The 3D toolbar provides Physics (pause/resume), Drop cube, Clear cubes, Reset robot and Colliders. The robot uses dynamic compound rigid bodies and motor-driven revolute servo joints. Brackets and fixed attachments are welded into the same rigid body as their mount, so they cannot flex under solver load. All roots, including Null components, are free under gravity; nothing pins the robot to the environment. The floor at Y = 0 and loose cubes support, obstruct and react to the robot. Powered outputs hold their commanded angles with stiff force-based motors. Switching an output off (or muting it) replaces its motor joint with a passive hinge, removing holding stiffness and motor damping; switching it on restores holding torque. Contacts between robot links are excluded because the mounting geometry overlaps. Physics never sends servo commands. Reset robot restores the configured pose. Cube count is capped at 20; dynamic poses and cubes are not stored in config.

Run `node scripts/test_physics.mjs` for a real Rapier WASM integration test using the same local engine file.

Null components have optional Physics constraints in Setup: Constrain X/Y/Z with minimum and maximum offsets in millimetres, measured along world axes from the configured Null position. Unchecked axes remain free; 0/0 locks an axis; -10/+10 permits 20 mm of travel. Rotation stays free unless the independent Lock rotation X/Y/Z controls are enabled. Rapier slider limits and a generic joint mount provide solver-based reaction forces. Y position support alone holds height but permits tipping; enable Lock rotation X and Z to prevent tipping while leaving X/Z translation free. Constraints apply in the preview and persist with Save config (components[].constraints). To support the robot while walking along X, constrain Y and Z and leave X unchecked. Editing constraints rebuilds the robot from its configured pose.

Constraint guides are drawn in the viewport even with Grid and Colliders hidden. Each shows the held position or min/max rail and the live Null coordinate; Y has a dashed floor reference. Single-axis constraints align explicitly with the requested world axis, and range carriers cannot rotate. Physics tests exercise Y-only support while all servos move, plus independent X/Y/Z range limits.

## AI Learning runtime

Select AI Learning, load the PanTilt robot in offline simulation, then click
Initialize learning setup. TensorFlow.js 4.22.0 loads from the local server
only when needed, checks prediction and training updates, and reports its
backend, loss and tensor cleanup in Learning output. Auto tries WebGL first
and falls back to CPU; either backend can be selected explicitly for comparison.
This is a runtime check, not robot policy training. Training assets are stored
in devserver/vendor/ and excluded from controller filesystem images. Other
static hosts must serve the vendor URL explicitly to use this feature.
Run `node --test scripts/test_ai_runtime.cjs` for runtime checks.

AI Learning now provides explicit sensor, target, outer pan and inner tilt
joint selectors. Validate training rig checks a copy of the scene, reports
a visible pose inside joint limits, and rejects floor intersections, moving
targets, occlusion and range failures before loading TensorFlow. It records
a fixed base and stationary target for the future training environment;
it does not yet test Rapier motor settling or the timed detection hold.
The target centre must be at least 5 mm above the floor. Defaults are
0.5 simulated seconds of target detection and a 10-second episode limit.
Run `node --test scripts/test_ai_task.cjs scripts/test_ai_runtime.cjs`.

## Shared simulated distance query

`data/simulated-sensor.js` supplies a DOM-free centre-ray query for the sensor
panel, beam overlay and learning rig validator. It returns validity, range
in mm, nearest-hit identity and world-space points. The target is an analytic
5 mm radius sphere even though it has no physics collider. Components,
the floor and dropped cubes can occlude it. The policy observation helper
exposes only range and validity. AI Learning > Read selected sensor logs a
one-shot simulated reading and hit identity without moving the rig.
Run `node --test scripts/test_simulated_sensor.cjs scripts/test_ai_task.cjs`.

## Isolated learning environment

After initialization, AI Learning creates a separate Rapier world with a fixed
base and stationary target. Reset episode uses the integer Episode seed and
seeded startup jitter. Step simulation advances 50 ms with Hold or a bounded
2-degree pan/tilt adjustment. Stop environment frees that world. The normal
preview and device command paths are not used; training poses are rendered in a
dedicated read-only view on the right of AI Learning. Switching modes or reloading the robot stops
the environment. Reward terms are scored locally; policy training is not connected yet.

The DOM-free API is `GhostLearningEnvironment.create(...)`, followed by
`reset(seed, options)`, `step(action)`, `snapshot()` and `dispose()`.
Physics runs at 120 Hz and actions at 20 Hz, with early episode termination.
Run `node --test scripts/test_ai_environment.mjs` for real Rapier WASM checks.

The AI Learning lab now includes mission controls, live simulation telemetry
and a responsive 3D view. Drag to orbit, scroll to zoom, or use arrow keys and
plus/minus on the focused canvas. Recenter view fits the rig and target. The
configured preview is labelled separately from the isolated simulation.

`data/ai-policy.js` defines the five bounded actions and version-1 policy
encoder. `observation.policyVector` has 29 numeric values: four 6-value
frames of normalized joint angles, velocities, range and validity, plus
the previous-action one-hot vector. Target identity stays in diagnostics.
Run `node --test scripts/test_ai_policy.cjs scripts/test_ai_environment.mjs`.

## Reward model v1

`data/ai-reward.js` scores first target detection, hold progress, completion,
training-only alignment progress, elapsed time, commanded/actual movement,
joint-limit attempts and invalid state. First detection is paid once per
episode; hold and alignment use potential differences so cycling cannot
accumulate progress indefinitely. Floor/robot/other-object returns cannot
earn target bonuses. Reset clears all reward credit. AI Learning shows
last-action terms, last-action reward and total episode return, and logs the
breakdown separately from the agent observation vector.
Run `node --test scripts/test_ai_reward.cjs scripts/test_ai_environment.mjs`.

## Raster baseline and clean curriculum

Initialize AI Learning, choose a curriculum stage, seed split and 1-5 episodes,
then click Evaluate raster scan. The sensor-only controller scans in 2-degree
rows using the same actions as the future learned policy. Valid returns can
trigger a hold; false-lock attempts are counted separately using evaluation
metadata. A timeout does not imply the entire pose space has been searched.

Stages use the configured target with nearby/wider startup jitter, or generate
seeded visible targets 50-500 mm away. Separate fixed training and held-out
seed banks support repeatable comparisons. Generation uses geometry for
reachability checks; target geometry never enters the controller inputs.
Clutter/noise stages wait until the clean task works reliably.

The results card shows success rate, successful-only median time, mean return,
false locks and per-seed outcomes. Cancel excludes unfinished episodes and
frees the evaluation world. Stop, mode/rig changes and page unload also cancel
evaluation. Manual Reset/Step are disabled during the run. No training or
hardware commands are issued.
Run `node --test scripts/test_ai_baseline.mjs scripts/test_ai_runtime.cjs`.

## PPO training

After initializing AI Learning, Train policy runs local categorical PPO on
the isolated robot environment. The network uses two 64-unit tanh layers,
five action logits and a value head; only the 29-value vector is its input.
Pause/Resume retains rollout state. Stop training retains current weights.
Further runs continue the policy; Discard policy creates fresh weights next
time. Reinitialization, rig/mode changes and page reload clear the model.
Save policy stores a versioned JSON file in training/ on the devserver, or downloads it on other hosts. Load policy validates the
rig geometry, joint mapping/limits, sensor/reward settings and observation/action
schema before replacing weights. Invalid files leave the current policy intact.
Files include network weights, training settings and available held-out results.
Loading restarts Adam, sampling and rollout state; this is a weights checkpoint,
not an exact training-session resume. Re-evaluate after loading. Exports stay out
of robot configuration and sequence storage.

Warm starts are enabled initially to learn target holding from a nearly aimed
pose. This is an explicit reset aid, not an observation feature. Evaluate
learned policy uses ordinary held-out starts with warm starts off, the selected
training stage, and the reference scan episode count. Training successes do
not establish ordinary-start performance.

PPO, TensorFlow.js and the training Rapier world run in a dedicated Web Worker.
The worker loads the same registered component models and shared mounting math
as the preview. Auto backend selection tries worker WebGL (OffscreenCanvas),
then CPU; the compute bar reports the actual worker backend. Pose updates are
limited to about 10 per second plus episode boundaries. Pause/resume/stop use
worker messages; rig/mode changes and page close terminate the worker and reject
pending requests. The manual stepping environment and standalone raster reference remain
on the main thread. Paired PPO/raster evaluation runs entirely in the worker. Metrics show complete updates, sampled
steps and last-minibatch losses/entropy; partial updates on stop are retained.
Run `node --test scripts/test_ai_ppo.cjs scripts/test_ai_training.cjs` for
math, sampling, learning, cancellation and tensor checks, and
`node --test scripts/test_ai_ppo_robot.mjs` for a slower real-Rapier hold test.

Worker lifecycle, policy round-trip, malformed-file rejection, frozen evaluation
and tensor cleanup: `node --test scripts/test_ai_worker.mjs`. The test uses the
actual browser worker code in a Node worker thread with a small import adapter.

Evaluate learned policy also runs the raster reference on identical held-out cases
with warm starts off. Both controllers report joint travel (120 Hz actual motion,
reset settling excluded), false-return segments and wrong-surface hold attempts
(20 Hz sensor/action samples), in addition to success, acquisition time, return
and timeout statistics. A false return is a contiguous valid non-target reading;
a false hold is a contiguous run of Hold actions on such readings. These ground
truth diagnostics never enter policy inputs. Stop evaluation keeps completed
episodes and labels the comparison incomplete. Policy exports include paired
results; further training invalidates them.

## Interactive policy test

After training or loading a policy, use AI Learning > Test Policy to set the
starting pan and tilt angles and click Run policy test. This runs deterministic
inference against the initialized target, without warm-start assistance, reset
jitter, weight updates or a raster comparison. The worker paces actions at roughly
20 Hz so the simulation twin can be watched. Latest-action text updates alongside
the view; the final status reports outcome, time, return and actual joint travel.
Stop test retains the policy. Robot/mode changes terminate the worker as usual.
This is simulation-only testing, not a sequencer action or hardware deployment.

## Policy files in training/

On the devserver, Save policy writes a uniquely named JSON checkpoint into the
project-root `training/` folder, outside `data/` and filesystem uploads. Each save
creates a new file; existing checkpoints are not overwritten. The UI reports the
relative path. Use Load policy to select that file from disk. Other hosts retain
the browser-download workflow. Restart the devserver after updating its code.
The local same-origin JSON endpoint is `POST /api/training/policies`; it accepts
versioned GHOST policy records up to 2 MB. Generated artifacts are Git-ignored.

Mount-aware joint observations use schema v2. Policies saved before that correction
are rejected on load and require retraining. Policy test action counts distinguish
a Hold-only policy from a failure to execute movement. Training near the aiming
pose can teach holding without ordinary-start search; evaluate both behaviors.

## Avoiding a Hold-only policy

Reward model v2 uses a linear angular-error potential (weight 4), so a small
corrective movement can outweigh movement costs even before detection. Aiming
away loses potential; oscillation cannot accumulate net undiscounted progress.
Geometry remains reward/reset-only and never enters the observation vector.

Keep Warm start and Progress from holding toward ordinary startup angles checked
for progressive acquisition. Six stages interpolate from the aiming pose toward
ordinary startup cases (0%, 10%, 25%, 50%, 75%, 100%). Promotion requires at least
8 successes in a window of at least 10 training-case probes; a full 20-probe window
with at most 3 successes steps back. Windows are capped at 20. Progress persists
between training batches for the same curriculum stage, and resets on policy
discard/load or curriculum-stage change. This is not convergence evidence.

Old reward-model checkpoints are rejected; start fresh after refreshing. The
policy test remains deterministic and frozen, and may still correctly report a
Hold-only or limit-seeking policy until training improves.

Curriculum checks use five frozen training-case probes after each update, with
approach/hold-aware deadlines capped by the mission limit. They do not update
weights or consume the training sampler RNG. Probe steps add computation but
are not counted as sampled training steps.

## Compact AI Learning layout

AI Learning section headers have accessible expand/collapse buttons. The Spatial Telemetry header
session bar mirrors the existing controls (including disabled and Pause/Resume
states) and invokes their existing handlers, so folding panels does not change
training behavior. Collapse all/Expand all and browser-local section preferences
reduce scrolling between iterations. Collapsing the Simulation Twin skips drawing
while retaining the latest snapshot; expanding it redraws via ResizeObserver.

## Policy-test progress graph

Test Policy now graphs completed test return with acquisition/outcome markers.
Hover or focus a point for the training-update count, result and duration. A pose
selector keeps different requested start angles and seeds in separate curves.
Stopped tests are marked without a score and excluded from the last-five
acquisition count. History holds the latest 100 runs in the current page, survives
continued training, and clears on policy discard/load, setup change or reload.
Return change is measured against the earliest retained matching-pose test; it
is not a convergence metric. Clear history affects only chart data.

## Full Auto Train and convergence

Full Auto initializes if needed, retains current weights, and runs the selected
stage with progressive warm starts. Each batch uses the displayed update count
and rollout length, then freezes weights for 50 monitoring cases and a startup
policy test. Evaluate / convergence also runs this monitoring bank manually.
Repeated evaluation of unchanged weights is cached and never adds checkpoints.

The header percentage is latest complete monitoring acquisition success, not a
probability of convergence. clean-v1 monitoring has 50 fixed seeds per stage,
separate from training; random-target stages vary targets, while configured-target
stages vary starts. Quality requires success >=90%, a Wilson 95% lower bound >=80%
(effectively >=46/50), no invalid states or false holds. Three distinct completed
training checkpoints must satisfy quality, success spread <=5 percentage points,
and successful-only median time/travel spread <=10% (floors .1 s / 1 degree).
Poor flat histories are plateaued, regression is flagged, and training marks prior
evidence stale. Repeated cases never increase confidence sample counts.

With early stopping enabled, validation convergence and startup success trigger
a separate 50-case final bank plus same-case raster comparison. Final qualification
requires the same quality gate and at least raster's success count. Every final
attempt in a worker lineage reserves a new seed range; bank IDs and episode seeds
are saved. Returning to older saved files can repeat previously exposed ranges,
so retain experiment provenance. Final failure ends auto instead of tuning on
the same final cases. Disable early stopping to continue to the budget.

At the batch limit, auto saves the best monitored checkpoint, which can be
unqualified; a final pass saves current qualified weights. Stop retains current
weights for manual saving. Restore best monitored checkpoint restarts optimizer
and curriculum state. Saved history is archival on load/restore and excluded
until fresh trained checkpoints are collected. The last 30 monitoring records
are persisted inside policy files; the latest 10 are displayed with counts,
Wilson bounds, successful-only time/travel, reward, false returns/holds, timeouts
and invalid states. Cancelled/incomplete evaluations are explicitly excluded.

This establishes stage-scoped clean-simulation validation, not global optimality
or hardware readiness. Occlusion/noise/deadline case suites and replication across
independent training seeds remain open. Long monitor/qualify requests share the
training/evaluation cancellation path and are not subject to the short RPC timeout.
