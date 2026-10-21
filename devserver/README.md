# Local config server

From the project root, run:

```powershell
node devserver/server.js
```

Open http://127.0.0.1:8080. An optional port can be supplied, for example `node devserver/server.js 8081`.

The server binds only to 127.0.0.1, serves the files in data/, and opens the UI on the Mixer page in offline simulation mode. Save config in Setup or Servo Settings writes data/config.json directly, using a temporary file and rename. Sequencer edits (write, update, delete, reorder, loop and clear) save automatically to data/sequence.json and load again on refresh. Other local static servers still download the config as before.

No packages are required. Use Node.js 18 or newer. Stop with Ctrl+C. Nothing is uploaded to the ESP8266; firmware/device commands are not provided by this server. Keep the browser tab open while editing, and reload if the component list was changed elsewhere.
