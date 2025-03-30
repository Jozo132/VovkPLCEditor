
require('esbuild').build({
    entryPoints: ['./src/index.js'],  // Entry point for your app
    bundle: true,                     // Bundle all the files into one
    outfile: './dist/bundle.js',      // Output file
    format: 'esm',                    // Output format (ES module)
    loader: {
        '.wasm': 'file',              // Load WASM files
        '.css': 'text'                // Load CSS as text
    },
    external: ['perf_hooks', 'fs', 'path'],   // Exclude perf_hooks and fs from the bundle
    define: {
        'process': '"undefined"',     // Exclude process from the bundle
        'module': 'window',           // Exclude module from the bundle
        'exports': '"undefined"',     // Exclude exports from the bundle
    },
    minify: true,                     // Optional: Minify the output
    sourcemap: true,                  // Optional: Include sourcemaps
}).catch(() => process.exit(1));