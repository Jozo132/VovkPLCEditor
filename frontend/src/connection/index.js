import { PLCEditor } from "../utils/types.js";
import SimulationConnection from "./drivers/SimulationConnection.js";
import RestConnection from "./drivers/RestConnection.js";
import SerialConnection from "./drivers/SerialConnection.js";

/** @typedef { SimulationConnection | RestConnection | SerialConnection } ConnectionBase * @type { ConnectionBase } */
export let ConnectionBase

/**
 * @typedef {{ target: 'simulation' }} ConnectionOption_Simulation
 * @typedef {{ target: 'rest', host?: string }} ConnectionOption_Rest
 * @typedef {{ target: 'serial', baudrate?: number, debug?: boolean, port?: any }} ConnectionOption_Serial
 * @typedef { ConnectionOption_Simulation | ConnectionOption_Rest | ConnectionOption_Serial } ConnectionOptions
 * @type { ConnectionOptions } */
export let ConnectionOptions

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