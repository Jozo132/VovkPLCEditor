# Copilot Instructions for VovkPLCEditor

## Build Rules
- **NEVER run frontend build commands** (`npm run build` in frontend folder, or any esbuild/webpack commands for frontend)
- The user manually handles frontend builds
- Not even `npm run update`
- Don't modify any files in the `lib/VovkPLCRuntime/` folder - this is an external git library, if something in there is wrong either suggest edits if needed but don't apply any changes to them

## Project Context
- This is a PLC (Programmable Logic Controller) program editor for the VovkPLC Runtime which is basically a stack based VM where from within it has immutable program memory and mutable data memory which runs on both embedded devices (Arduino compatible), in browsers (WASM), and on desktop (Node.js)
- The VovkPLC Runtime executes custom bytecode compiled from PLCASM, a custom assembly-like language for PLC programming that's relatively easy to debug and understand
- This VovkPLC Editor is a platform that supports PLCASM assembly, STL (Structured Text Language) and LAD ladder logic programming languages (more to be added later) and compiles them down to PLCASM bytecode for execution on the VovkPLC Runtime
- The compilation pipeline is as follows:
  - User writes code in either ladder/STL/PLCASM in the editor UI as a program block inside a program file inside a project
  - The languages get converted down as follows:
    - Ladder -> Ladder IR -> Network IR -> STL
    - STL -> PLCASM
    - PLCASM (no conversion)
  - The final step is joining all and adding the symbol definitions at the top, then sending the final PLCASM to the VovkPLC Runtime compiler (WASM) to get full compiled bytecode
  - We have a Network IR translator that allows us to convert both Ladder and STL (+ others in the future) to Network IR and back to any of these languages (losing comments in the process) but it can be useful to switch between any of the languages at any time
  - the STL is the base language for all visual programming languages that we plan to support, it was sliglhtly modified to accept extended instructions for more complex or ustom PLC operations that have no equivalent in standard STL
- The editor supports project management, file management, program block management, code editing with syntax highlighting, compiling, uploading to device over serial/USB, and simulation in-browser
- Main languages: JavaScript (frontend), TypeScript (backend), C++ (WASM runtime)
- Key folders:
  - `frontend/src/` - Editor UI, ladder/STL languages
  - `lib/VovkPLCRuntime/` - C++ runtime and WASM build - provided by user, do not modify
  - `backend/` - Backend server

## Code Style
- Use modern JavaScript (ES6+)
- Prefer `const` over `let` when variable won't be reassigned
- Use arrow functions for all function expressions
- Use async/await for asynchronous code instead of Promises where possible
- Use template literals for string concatenation
