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
