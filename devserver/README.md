# Local config server

From the project root, run:

```powershell
node devserver/server.js
```

Open http://127.0.0.1:8080. An optional port can be supplied, for example `node devserver/server.js 8081`.

The server binds only to 127.0.0.1, serves the files in data/, and opens the UI on the Mixer page in offline simulation mode. Save config in Setup or Servo Settings writes data/config.json directly, using a temporary file and rename. The A–J buttons select data/sequence_a.json through data/sequence_j.json. Sequencer edits (add, update, delete, reorder, loop, finish and clear) save automatically to the selected file. Refresh starts on slot A. Until sequence_a.json is first saved, slot A loads the existing data/sequence.json; other missing slots start empty. Selecting a sequence does not change data/config.json. Other local static servers still download the config as before.

No packages are required. Use Node.js 18 or newer. Stop with Ctrl+C. Nothing is uploaded to the ESP8266; firmware/device commands are not provided by this server. Keep the browser tab open while editing, and reload if the component list was changed elsewhere.

Restart the server after changing server.js so the updated API handlers take effect.

Below the step list, + appends a motion step and > appends a sequence call. Use the call step's dropdown to choose A–J. Calls run the selected sequence once, including nested calls, then resume the caller. Only the sequence started with Play repeats when Loop is enabled. Circular calls and chains exceeding 4096 motion steps are rejected before motion starts. Stop cancels the entire chain.

The frontend uses /api/sequence/a through /api/sequence/j for explicit file selection. Restart an older devserver before using these routes; outdated servers will fail the request instead of silently saving sequence.json.

Rapier physics loads directly from https://cdn.skypack.dev/@dimforge/rapier3d-compat using a dynamic import and its embedded WebAssembly compatibility package. No bundler or npm install is required. The browser needs internet access for the CDN; loading failure leaves the controller usable and the Physics button retries. Physics pauses when the view is hidden.

The 3D toolbar provides Physics (pause/resume), Drop cube, Clear cubes, Reset robot and Colliders. The robot uses dynamic compound rigid bodies and motor-driven revolute servo joints. Brackets and fixed attachments are welded into the same rigid body as their mount, so they cannot flex under solver load. All roots, including Null components, are free under gravity; nothing pins the robot to the environment. The floor at Y = 0 and loose cubes support, obstruct and react to the robot. Powered outputs hold their commanded angles with stiff force-based motors. Switching an output off (or muting it) replaces its motor joint with a passive hinge, removing holding stiffness and motor damping; switching it on restores holding torque. Contacts between robot links are excluded because the mounting geometry overlaps. Physics never sends servo commands. Reset robot restores the configured pose. Cube count is capped at 20; dynamic poses and cubes are not stored in config.

Run `node scripts/test_physics.mjs` for a real Rapier WASM integration test (requires CDN access).

Null components have optional Physics constraints in Setup: Constrain X/Y/Z with minimum and maximum offsets in millimetres, measured along world axes from the configured Null position. Unchecked axes remain free; 0/0 locks an axis; -10/+10 permits 20 mm of travel. Rotation stays free unless the independent Lock rotation X/Y/Z controls are enabled. Rapier slider limits and a generic joint mount provide solver-based reaction forces. Y position support alone holds height but permits tipping; enable Lock rotation X and Z to prevent tipping while leaving X/Z translation free. Constraints apply in the preview and persist with Save config (components[].constraints). To support the robot while walking along X, constrain Y and Z and leave X unchecked. Editing constraints rebuilds the robot from its configured pose.

Constraint guides are drawn in the viewport even with Grid and Colliders hidden. Each shows the held position or min/max rail and the live Null coordinate; Y has a dashed floor reference. Single-axis constraints align explicitly with the requested world axis, and range carriers cannot rotate. Physics tests exercise Y-only support while all servos move, plus independent X/Y/Z range limits.
