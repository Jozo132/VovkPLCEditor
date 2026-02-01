export default class SerialCLASS {
    constructor(maxBufferLength = 1024, debug = false) {
        this.debug = debug;
        if (!('serial' in navigator)) {
            throw new Error('Web Serial API is not supported in this browser.');
        }
        this.port = null;
        this.VID = 0;
        this.PID = 0;
        this.reader = null;
        this.writer = null;
        this.isOpen = false;
        this._readBuffer = [];              // Buffer for incoming bytes
        this._maxBufferLength = maxBufferLength;
        this._readingLoopPromise = null;
        this._closing = false;
        this._writeMutex = Promise.resolve();
        this.onDisconnect = null;
        this._fatalErrorHandled = false;    // Track if disconnect was already handled
        this._abortController = null;       // For aborting read operations
    }

    _handleFatalError(error) {
        if (this._fatalErrorHandled) return; // Prevent duplicate handling
        this._fatalErrorHandled = true;
        if (this.debug) console.warn('Serial fatal error:', error);
        if (this.onDisconnect) this.onDisconnect(error);
        this.isOpen = false;
    }

    /**
     * Opens a serial port and begins listening.
     * @param {{
     *     baudRate: number,
     *     dataBits?: 7 | 8,
     *     stopBits?: 1 | 2,
     *     parity?: 'none' | 'even' | 'odd',
     *     flowControl?: 'hardware' | 'none',
     *     port?: SerialPort
     * }} [openOptions] - Options for opening the serial port.
     * @return {Promise<void>}
     */
    async begin(openOptions = { baudRate: 115200 }) {
        if (typeof openOptions !== 'object') throw new Error('Invalid options object.');
        if (typeof openOptions.baudRate === 'undefined') openOptions.baudRate = 115200;
        if (typeof openOptions.dataBits === 'undefined') openOptions.dataBits = 8;
        if (typeof openOptions.stopBits === 'undefined') openOptions.stopBits = 1;
        if (typeof openOptions.parity === 'undefined') openOptions.parity = "none";
        if (typeof openOptions.flowControl === 'undefined') openOptions.flowControl = "none";

        // Ensure Web Serial API is supported
        if (!('serial' in navigator)) {
            throw new Error('Web Serial API not supported in this browser. Use Chromium-based browser.');
        }
        // If already open, prevent re-opening (user should call end() first for a new port)
        if (this.isOpen) {
            throw new Error('Serial port already open. Call end() before opening a new port.');
        }
        try {
            // Use provided port or request user to select a serial port (requires a user gesture in page)
            if (openOptions.port) {
                this.port = openOptions.port
            } else {
                // @ts-ignore
                this.port = await navigator.serial.requestPort();
            }
            // Open the port with given options (baudRate is required)
            if (!this.port.connected || !this.port.readable || !this.port.writable) {
                if (this.debug) console.log(`Requesting serial port with options:`, openOptions);
                // Add timeout for port.open() - some devices can hang here
                const openPromise = this.port.open(openOptions);
                const openTimeout = new Promise((_, reject) => {
                    setTimeout(() => reject(new Error('Port open timeout - device may be unresponsive')), 10000);
                });
                await Promise.race([openPromise, openTimeout]);
            }
            this.isOpen = true;
            this._fatalErrorHandled = false; // Reset for new connection

            // Handle hardware disconnect
            const onDisconnect = () => {
                if (this.port) {
                    this.port.removeEventListener('disconnect', onDisconnect);
                }
                if (!this._closing) {
                    this._handleFatalError(new Error("Device disconnected"));
                }
            };
            this.port.addEventListener('disconnect', onDisconnect);

        } catch (err) {
            // If user cancels the port selection or open fails, ensure state is reset
            this.port = null;
            this.isOpen = false;
            throw err;  // Propagate error to caller
        }

        // Set up an asynchronous read loop to continuously read incoming data
        this._closing = false;
        const reader = this.port.readable.getReader();
        this.reader = reader;
        this._readingLoopPromise = (async () => {
            try {
                // Loop until the stream is closed or an error occurs
                while (!this._closing) {
                    // Simply await the read - we rely on reader.cancel() in end() to break out
                    // Note: reader.read() is NOT abortable, only cancelable via reader.cancel()
                    const { value, done } = await reader.read();
                    
                    if (done) {
                        // Stream is closed (port disconnected or reader cancelled)
                        break;
                    }
                    if (this._closing) {
                        // Check again after read completes
                        break;
                    }
                    if (value) {
                        // `value` is a Uint8Array of bytes read from the serial device
                        for (let byte of value) {
                            this._readBuffer.push(byte);
                            // If buffer exceeds max length, remove oldest byte
                            if (this._readBuffer.length > this._maxBufferLength) {
                                this._readBuffer.shift();
                            }
                        }
                    }
                }
            } catch (error) {
                // Reading error (possible causes: non-fatal read error or manual cancellation)
                if (this._closing) {
                    // If we are in the process of closing, ignore errors from cancellation
                    // (They are expected when cancelling the reader)
                } else {
                    console.error('Serial read error:', error);
                    this._handleFatalError(error);
                }
            } finally {
                // Release the reader lock so that the port can be closed
                try { reader.releaseLock(); } catch (e) { /* ignore */ }
            }
        })();
    }

    /**
     * Closes the serial port and stops listening.
     * @return {Promise<void>}
     */
    async end() {
        if (!this.isOpen || !this.port) {
            return;  // Not open, nothing to do
        }
        this._closing = true;
        
        // Set a maximum timeout for the entire close operation
        const closeTimeout = 3000; // 3 seconds max
        const closePromise = this._performClose();
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Close timeout')), closeTimeout);
        });
        
        try {
            await Promise.race([closePromise, timeoutPromise]);
        } catch (e) {
            if (this.debug) console.warn('Serial close error/timeout:', e.message);
        } finally {
            // Force reset state regardless of what happened
            this.isOpen = false;
            this.port = null;
            this.reader = null;
            this._readingLoopPromise = null;
            this._closing = false;
            this._readBuffer = [];
        }
    }
    
    /**
     * Internal method that performs the actual close operations
     * @private
     */
    async _performClose() {
        try {
            if (this.debug) console.log('Closing serial port...');
            // Cancel the reader to break out of any pending read operation
            if (this.reader) {
                try { await this.reader.cancel(); } catch (e) { /* ignore cancel errors */ }
                // Note: reader.releaseLock() is called in the read loop's finally block.
            }
            // Wait for the read loop to finish up if it's still running (with timeout)
            if (this._readingLoopPromise) {
                const loopTimeout = new Promise(resolve => setTimeout(resolve, 1000));
                try { 
                    await Promise.race([this._readingLoopPromise, loopTimeout]); 
                } catch (e) { /* ignore errors from loop */ }
            }
            // Close the serial port
            if (this.port) {
                try { await this.port.close(); } catch (e) { /* ignore close errors */ }
            }
        } finally {
            // State reset is handled by the calling method
        }
    }

    /**
     * Returns the number of bytes available in the receive buffer.
     * @return {number}
     */
    available() {
        return this._readBuffer.length;
    }

    /**
     * Reads the oldest byte from the receive buffer.
     * @return {number} Next byte (0-255) or -1 if no data is available.
     */
    read() {
        if (this._readBuffer.length === 0) {
            return -1;  // No data available, emulate Arduino Serial.read() behavior
        }
        const byte = this._readBuffer.shift();
        // Convert byte (Uint8) to Number 0-255
        return (byte & 0xff);
    }

    /**
     * Peeks at the oldest byte in the receive buffer without removing it.
     * @return {number} Next byte (0-255) or -1 if no data is available.
     */
    peek(offset = 0) {
        if (this._readBuffer.length === 0) {
            return -1;  // No data available, emulate Arduino Serial.peek() behavior
        }
        if (offset < 0 || offset >= this._readBuffer.length) {
            return -2;  // Out of bounds
        }
        const byte = this._readBuffer[offset];
        // Convert byte (Uint8) to Number 0-255
        return (byte & 0xff);
    }




    /**
     * Reads until a certain number of bytes are available or a timeout occurs.
     * @param {number} count - Number of bytes to wait for.
     * @param {number} timeoutMs - Maximum time to wait in milliseconds.
     * @return {Promise<Uint8Array>} - Promise that resolves to a Uint8Array of the bytes read.
     */
    async readBytes(count = 1, timeoutMs = 1000) {
        const deadline = Date.now() + timeoutMs;
        while (this._readBuffer.length < count) {
            if (Date.now() >= deadline) {
                throw new Error(`Timeout waiting for ${count} bytes.`);
            }
            await new Promise(resolve => setTimeout(resolve, 10));
        } // @ts-ignore
        return this._readBuffer.splice(0, count);
    }

    /**
     * Reads until a certain string is encountered or a timeout occurs.
     * @param {string} searchString - String to search for.
     * @param {number} timeoutMs - Maximum time to wait in milliseconds.
     * @return {Promise<string>} - Promise that resolves to the string read.
     */
    async readUntil(searchString = '\n', timeoutMs = 1000) {
        const searchBytes = new TextEncoder().encode(searchString);
        const searchLength = searchBytes.length;
        const buffer = [];
        const deadline = Date.now() + timeoutMs;
        while (true) {
            if (this._readBuffer.length >= searchLength) {
                const end = this._readBuffer.length - searchLength + 1;
                for (let i = 0; i < end; i++) {
                    const slice = this._readBuffer.slice(i, i + searchLength);
                    if (slice.every((value, index) => value === searchBytes[index])) {
                        const preMatch = this._readBuffer.splice(0, i);
                        this._readBuffer.splice(0, searchLength);
                        const result = new Uint8Array([...buffer, ...preMatch]);
                        return new TextDecoder().decode(result);
                    }
                }
            }
            if (Date.now() >= deadline) {
                throw new Error(`Timeout waiting for "${searchString}".`);
            }
            if (this._readBuffer.length > 0) {
                buffer.push(this._readBuffer.shift());
                if (buffer.length > searchLength) {
                    buffer.shift();
                }
            } else {
                await new Promise(resolve => setTimeout(resolve, 10));
            }
        }
    }


    /**
     * Reads a complete line (delimited by \n) from the buffer, if available.
     * @return {string|null}
     */
    readLine() {
        const newlineIndex = this._readBuffer.indexOf(10); // ASCII '\n'
        if (newlineIndex === -1) return null;

        const lineBytes = this._readBuffer.splice(0, newlineIndex + 1);
        return new TextDecoder().decode(new Uint8Array(lineBytes)).trim();
    }

    /**
     * Reads and returns all available buffered data as a string.
     * @return {string}
     */
    readAll() {
        const all = new TextDecoder().decode(new Uint8Array(this._readBuffer));
        this._readBuffer = [];
        return all;
    }

    /**
     * Writes data to the serial port.
     * Accepts string, ArrayBuffer/Uint8Array, or number (single byte or will be converted to string).
     * @param {string|ArrayBuffer|Uint8Array|number} data - Data to send.
     * @return {Promise<void>}
     */
    async write(data) {
        if (this.debug) console.log('Serial write:', data);
        
        // Use a mutex to prevent concurrent writes from trying to lock the stream simultaneously
        const currentWrite = this._writeMutex.then(async () => {
            if (!this.isOpen || !this.port) {
                throw new Error('Cannot write: serial port is not open.');
            }
            // Prepare data as Uint8Array
            let buffer;
            if (data instanceof Uint8Array) {
                buffer = data;
            } else if (data instanceof ArrayBuffer) {
                buffer = new Uint8Array(data);
            } else if (typeof data === 'number') {
                // If number is within byte range, send as single byte; otherwise send its string representation
                if (data >= 0 && data < 256 && Number.isInteger(data)) {
                    buffer = new Uint8Array([data]);
                } else {
                    const text = String(data);
                    buffer = new TextEncoder().encode(text);
                }
            } else {
                // Convert other types (string, etc.) to bytes
                const text = String(data);
                buffer = new TextEncoder().encode(text);
            }
            
            // Check if locked before trying to get writer (optional, but good for debugging)
            if (this.port.writable.locked) {
                // This shouldn't happen with the mutex unless something else locked it
                if (this.debug) console.warn('Stream locked, waiting in mutex...');
            }

            // Write to the serial output stream
            const writer = this.port.writable.getWriter();
            try {
                await writer.write(buffer);
            } finally {
                // Release the lock so other writes or closure can happen
                writer.releaseLock();
            }
        });

        // Update mutex to wait for this write
        this._writeMutex = currentWrite.catch(() => {});
        
        return currentWrite;
    }

    /**
     * Writes text to the serial port (without newline), like Arduino Serial.print().
     * @param {*} data - Data to convert to string and send.
     * @return {Promise<void>}
     */
    async print(data) {
        // Just call write with the data (it will be converted to string/bytes in write)
        await this.write(data);
    }

    /**
     * Writes text to the serial port followed by a newline (\\n), like Arduino Serial.println().
     * @param {*} data - Data to send, converted to string.
     * @return {Promise<void>}
     */
    async println(data = '') {
        // Convert data to string (if not already) and append newline
        const text = String(data) + '\n';
        await this.write(text);
    }
}