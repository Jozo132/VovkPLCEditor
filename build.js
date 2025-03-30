// @ts-check
"use strict"

// Check if system is windows or posix
import { platform } from "os"
const isWindows = platform() === "win32"

import { execSync } from "child_process"

// Execute 'cd ./lib/VovkPLCRuntime && node ./wasm_build.js'
execSync("cd ./lib/VovkPLCRuntime && node ./wasm_build.js", { stdio: "inherit" })

// Copy the dist folder './lib/VovkPLCRuntime/wasm/dist' to './frontend/src/wasm'
console.log("Copying the WASM files to the frontend")
if (isWindows) execSync("xcopy /E /I /Y .\\lib\\VovkPLCRuntime\\wasm\\dist .\\frontend\\src\\wasm", { stdio: "inherit" })
else execSync("cp -r ./lib/VovkPLCRuntime/wasm/dist ./frontend/src/wasm", { stdio: "inherit" })

execSync("cd ./backend && npm install", { stdio: "inherit" }) // Install the dependencies for the backend
