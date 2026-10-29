# 3D servo output

The 3D view opens by default to the right of the mixer (below it on narrow screens).
Use Deactivate 3D view in the top status bar to hide the entire 3D panel; the
mixer expands into the freed space. Activate 3D view restores the panel. Drag to orbit, scroll to zoom, or focus
its canvas and use arrow keys and +/-; Reset camera restores the default view centered on the world origin.
Horizontal dragging orbits around the world Y axis through the target. Vertical
dragging adjusts elevation, limited above the floor; arrow keys use the same limits.
The camera stays fixed during motion; orbit and zoom change it only when you
use the camera controls. The default span is 400 mm across the shorter canvas
dimension. The floor grid is at Y = -55 mm, with 25 mm spacing, stronger 100 mm
lines, and coloured X (red) and Z (blue) axes.
The view uses the existing one-second status updates, including smooth motion
and sequence playback. It displays commanded angles, not physical feedback.
When status fails it retains the last pose and marks it stale. Activation and
camera controls never send motion commands.

Each entry in the `components` array in `data/config.json` has a unique name
and an `objectType`: `Servo`, `U Bracket Short`, or `U Bracket Long`. The existing
servo `type` field still describes its hardware model. Up to 20 Servo components
and 60 total components are supported. Only Servo entries become hardware
channels or sequencer tracks, in their order within components.

Each component supports these optional placement fields:

```json
"position": { "x": 0, "y": 0, "z": 0 },
"rotation": { "x": 0, "y": 0, "z": 0 },
"model": "standard",
"parent": null
```

- Position is the shaft pivot in millimetres; Y points up.
- Rotation is degrees about local X, then Y, then Z, applied before translation.
- Model is `standard` (40 × 36 × 20 mm body) or `micro` (23 × 25 × 12 mm).
  These are schematic models, not manufacturer CAD dimensions.
- Parent is null for a root, or the **exact component name**, independent
  of the PCA9685 hardware channel. Names must be unique. A child position and rotation are relative
  to the parent's shaft. Children inherit the shaft's rotation around local Y;
  a reported angle of 90° is neutral. Cycles and invalid parents disable only
  the preview and show an error.

Omitted fields default to a spaced row, zero rotation, standard model and no
parent. For example, set Servo 2's parent to `"Servo 1"` and its position to
`{"x": 35, "y": 5, "z": 0}` to mount it on Servo 1's horn. Edit the sample
layout to match the real assembly. Config values affect visualization only.
All rendering runs locally in the browser without external libraries.

Upload the LittleFS filesystem after editing assets/config to update the device.

## Offline testing

Select **Offline simulation** to use the mixer, macros and sequence playback
without a controller. Failed status requests automatically enter simulation;
reconnection requires clearing the checkbox, so test commands cannot be replayed
on hardware. Smooth mode and speed animate the simulated shaft; mute, solo and
output-off still apply. Offline sequence edits stay in the page and are not
saved to the controller. The preview configuration is cached in browser storage
when available so a previously loaded page can initialize if config fetching fails.
For first use without hardware, serve the `data` folder with a local HTTP server
and open its index page. No internet libraries are needed. Opening files directly
may block config fetching in the browser.

## Selecting and nudging models

Toggle **Edit** in the 3D panel to show the selection buttons, nudge
controls and transform readout. Editing is off by default; turning it off hides
these controls and the selection outline while retaining placement changes.
Select a servo using its name button above the canvas. The selected model has
a gold outline; its local X/Y/Z (mm) and RX/RY/RZ (degrees) appear in the bottom
left of the viewport. Use the minus/plus buttons for each axis to move by 5 mm
or rotate by 15 degrees (Shift-click moves by 1 mm or rotates by 1 degree). Coordinates are relative to its parent's shaft, or the
world origin for a root. Nudging a parent also moves its children. These controls
change the visualization only and never send physical servo commands. Press **Save config** in edit mode to store placement edits in the controller's
config.json. Only position and rotation are updated; hardware settings and all
other config fields are preserved. A failed save retains your edits for retry.
In offline simulation, Save config downloads the complete edited config.json;
replace data/config.json with that file to keep it. The browser cache is also
updated. This feature requires both the updated firmware and frontend assets.

In edit mode, **Show servo labels** toggles the names and angle labels. Labels
start hidden and, when enabled, display angles rounded to whole degrees; motion retains full
precision. The visibility choice applies until page reload, including outside
edit mode.

In offline simulation, Immediate motion uses a fast linear move (180 degrees in
500 ms at 1x playback), with a 50 ms minimum move duration. Its speed is independent
of the L/M/H smooth speed setting. Smooth mode keeps its existing easing and
speeds. Output-off cancels simulated motion. Firmware Immediate mode continues
to set the commanded angle immediately.

During sequencer playback, a step duration turns orange if active servo motion
would finish after that step's deadline. Warnings persist after playback and
across loop passes; starting playback again clears them. Editing a duration also
clears that step's warning. Muted, non-solo and powered-off channels are excluded.
Offline checks use exact simulated motion timing. Online checks estimate commanded
motion using firmware timing; they do not measure physical servo completion.

## U brackets

The standard model follows the supplied diagram's 40 x 40 x 20 mm case, with
a metal shaft and circular wheel on top and a coaxial plastic support nub below.
The diagram labels a different servo model, so these are reference dimensions
for the visualization rather than verified TD-7120 manufacturing dimensions.
Both U brackets span the shaft axis (local Y), with a mounting plate at each
end and a spine beside the case. The short bracket is on the negative-X side and stays fixed; the long bracket
extends on the positive-X body side and follows shaft rotation.
Their reference heights are 44.2 mm and 55.6 mm, depth 20 mm, with 2 mm plates.
The opposing bracket reaches form a 64 mm overall span at the neutral pose.
Origins are at the top axis mounting plate. The sample short bracket is at
(0, 5, 0) and the long at (0, 1.1, 0), both parented to Servo 1. Mounting clearances,
shaft/wheel/nub sizes and plate thickness are schematic. The floor is at Y = -55 mm.
Save config includes every component's placement and preserves object types,
parent references, and servo hardware fields. Firmware and frontend now require
the components schema; upload both together when deploying this change.

The servo origin remains the shaft pivot. The standard rectangular case
are offset +12 mm along local X, placing the shaft 8 mm from the case end; the
micro rectangular case are offset +6 mm, placing it 5.5 mm from the end. Horns and
shaft-mounted children rotate around this offset shaft; body-mounted brackets
remain fixed to the case. These dimensions are schematic.

Servo cases are plain rectangular boxes, without a top mounting lip.

Camera orbit and zoom are stored in browser storage and restored on page reload.
Reset camera restores and saves the default camera. If browser storage is
unavailable, camera controls still work for the current page.

## Component model files

Geometry lives in data/components/TD-7120.js, data/components/micro9g.js, data/components/UBracketShort.js and
data/components/UBracketLong.js. Each model receives local box/cylinder drawing functions,
a label callback and the servo status colour. The shared camera, transforms,
parenting, editing and renderer stay in app.js. The HTML loads these scripts
before app.js, and the firmware serves each model from LittleFS.

Surface visibility uses data/3d-renderer.js, a per-pixel depth buffer shared by
all component models. Faces are triangulated and depth-tested before visible
edges are drawn. This handles overlapping wheels, case faces and brackets
without relying on whole-face average-depth sorting. Labels remain overlays.
The model files and config do not need geometry changes for this improvement.

Right-drag pans the camera target along the world X/Z floor plane, relative to
the current orbit and zoom. Left-drag still orbits the target. The canvas context
menu is suppressed for right-drag. Pan offsets are saved with orbit and zoom;
Reset camera also resets pan to the world origin.

When a Servo's parent is a U Bracket Long, its shaft is fixed to that bracket.
The servo body rotates by the inverse of its angle offset from neutral (90
degrees), and body-mounted U Bracket Short children follow the body. Shaft-mounted
children remain in the fixed shaft frame. A root servo or one mounted to a short
bracket keeps the existing fixed-body, rotating-shaft behavior. This changes only
the visualization; configuration and firmware commands are unaffected.

Servo-to-servo links follow the parent's moving side: its body if the parent
servo is fixed by its shaft to a long bracket, otherwise its rotating shaft.
Short brackets always attach to the body and long brackets to the shaft. This
keeps downstream servos following the motion when the assembly root changes.

## Servo settings tab

The small gear button at the top right of each servo mixer strip opens that
servo in the Servo Settings tab beside Servo Mixer and Overview. Fields include
name/type, PCA9685 address and channel, pulse calibration, startup angle, stored
mode/flags/limits, 3D model and parent, and position/rotation. Save validates
unique output assignments and component names, parent cycles and numeric ranges.
Renaming a servo also updates component parent references to its name. Other
components and unknown config metadata are preserved.

Online saves write config.json through /api/config/servo; restart the controller
and reload the page before using the new hardware mappings. No reboot or servo
motion is triggered by saving. Existing runtime behavior of stored mode/flags/
angle-limit fields is unchanged. Offline saves download the edited config.json.
Both firmware and filesystem uploads are required to install this feature.

## Frontend reboot

Reboot in the top status bar schedules a controller restart through POST
/api/reboot. The frontend stops local playback/macros, discards queued commands,
drains in-flight servo requests and waits for the controller to return before
reloading the page. It is disabled in offline simulation. The controller returns
an acknowledgement, rejects further command/config writes during restart, and
reboots from the main loop after a short delay. Startup follows the saved config.
Both firmware and filesystem updates are needed to install the reboot feature.

## Continuous-rotation servos

Each Servo component supports `"continuous": false` (default). Set it true in
config or the Servo Settings checkbox for a continuous 360-degree motor. These
motors accept direction/speed, not a target position: the existing 0-180 command
encoding maps 0 to full reverse, 90 to stop and 180 to full forward. Panels show
REV/FWD percentages, a STOP centre and a dedicated Stop button. The configured
minimum/maximum pulses still define the command range; their midpoint must be
calibrated to the physical motor's neutral stop pulse. StartupAngle is the
encoded startup command for continuous servos; use 90 for stopped startup.

The offline and online 3D previews continuously integrate the commanded speed,
using an approximate 60 RPM at 100 percent. It is a visual estimate, not measured
shaft position or a motor-specific speed calibration. Muting or switching PWM
off freezes the estimated rotation; parent/shaft-mounted body behavior still
applies. Position servo rendering and commands are unchanged. Sweep macros skip
continuous motors. Center Active sends neutral (stop), while sequences store the
same 0-180 encoded speed commands per step. Stopping or finishing playback sends
neutral to continuous motors; duration-overrun warnings apply to position servos.
The continuous flag is also included in status responses. Firmware and filesystem
updates are required; saving the checkbox takes effect after restart/reload.

The shared 3D panel appears to the right of both Servo Mixer and Servo Settings,
stacking below on narrow screens. Switching tabs preserves the same camera,
preview and editing state. Deactivating 3D hides it and frees space in either tab.
