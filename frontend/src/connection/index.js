import { PLCEditor } from "../utils/types.js";
import SimulationConnection from "./drivers/SimulationConnection.js";
import RestConnection from "./drivers/RestConnection.js";
import SerialConnection from "./drivers/SerialConnection.js";
import SocketSerialConnection from "./drivers/SocketSerialConnection.js";

/** @typedef { SimulationConnection | RestConnection | SerialConnection | SocketSerialConnection } ConnectionBase * @type { ConnectionBase } */
export let ConnectionBase

/**
 * @typedef {{ target: 'simulation' }} ConnectionOption_Simulation
 * @typedef {{ target: 'rest', host?: string }} ConnectionOption_Rest
 * @typedef {{ target: 'serial', baudrate?: number, debug?: boolean, port?: any }} ConnectionOption_Serial
 * @typedef {{ target: 'socket-serial', baudrate?: number, debug?: boolean, portPath?: string, serverUrl?: string }} ConnectionOption_SocketSerial
 * @typedef { ConnectionOption_Simulation | ConnectionOption_Rest | ConnectionOption_Serial | ConnectionOption_SocketSerial } ConnectionOptions
 * @type { ConnectionOptions } */
export let ConnectionOptions

/**
 * Fetch server capabilities
 * @returns {Promise<{ localDeviceAccess: boolean, serial: boolean, network: boolean, socketIO: { namespaces: string[] }, version: string } | null>}
 */
export async function fetchServerCapabilities() {
    try {
        const response = await fetch('/api/capabilities')
        if (!response.ok) return null
        return await response.json()
    } catch {
        return null
    }
}

/**
 * Initialize the connection
 * @type { (options: ConnectionOptions, editor: PLCEditor) => Promise<ConnectionBase> }
 */
export async function initializeConnection(options, editor) {
    const { target } = options;
    /** @type { ConnectionBase | null } */
    let connection
    if (target === "simulation") {
        connection = new SimulationConnection(editor);
        await connection.connect();
        return connection;
    } else if (target === "rest") {
        const { host } = options;
        if (!host) throw new Error("REST host URL is required");
        connection = new RestConnection(host);
        await connection.connect();
        return connection;
    } else if (target === "serial") {
        const { baudrate, debug, port } = options;
        connection = new SerialConnection(baudrate, debug);
        await connection.connect(port);
        return connection;
    } else if (target === "socket-serial") {
        const { baudrate, debug, portPath, serverUrl } = options;
        connection = new SocketSerialConnection(baudrate, debug);
        await connection.connect({ path: portPath, serverUrl });
        return connection;
    } else {
        throw new Error(`Unsupported connection target: ${target}`);
    }
}

/**
 * Disconnect the active connection
 * @type { (connection: ConnectionBase | null) => Promise<void> }
 */
export async function disconnectConnection(connection) {
    if (connection && typeof connection.disconnect === "function") {
        await connection.disconnect();
    }
}