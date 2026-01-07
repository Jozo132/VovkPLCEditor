const isAndroid = /Android/i.test(navigator.userAgent);

if (isAndroid && !("serial" in navigator)) {
    const { serial } = await import("https://cdn.jsdelivr.net/npm/web-serial-polyfill/dist/serial.js");
    Object.defineProperty(navigator, "serial", { value: serial });
}

// existing Web Serial code can run unmodified below