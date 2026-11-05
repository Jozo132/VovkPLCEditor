# VovkPLCEditor
This is a PLC editor interface used together with devices running VovkPLCRuntime 

## Ethernet Connection

Run the Node.js backend with device access enabled (`npm start`), select Ethernet, and enter the PLC's IPv4 address and TCP port. Probe checks for a PLC information response; Scan broadcasts discovery on the selected interface and lists devices that support it. The initial TCP port value is 2000; the Node VirtualPLC uses 19616 by default. Connect after selecting a result or entering an address.

The PLC must expose the VovkPLC command protocol over TCP. Wi-Fi connectivity by itself is not sufficient: the current ESP32-C3 Wi-Fi example supports USB programming only. The TCP protocol and backend device access are not authenticated or encrypted; use a trusted, isolated network. See [NETWORK_DISCOVERY.md](NETWORK_DISCOVERY.md) and the [VirtualPLC instructions](lib/VovkPLCRuntime/README.md#nodejs-virtualplc), including the manager for running multiple independent PLCs in one Node.js process.
