# Network Discovery

With backend device access enabled, Scan sends a UDP broadcast on the selected IPv4 interface. The destination is calculated from that interface's address and netmask; this is not a TCP port sweep and does not cross routers. Manual IP and TCP port probing remains available for devices without discovery or on routed networks.

## Protocol Version 1

The default discovery port is UDP 19617. The backend binds an ephemeral port to the selected interface and broadcasts one UTF-8 JSON object:

```json
{"magic":"VOVKPLC_DISCOVER","version":1,"session":"0123456789abcdef0123456789abcdef","id":1,"nonce":"fedcba9876543210fedcba9876543210"}
```

`session` identifies the backend session, `id` increases for each scan, and `nonce` is freshly random for each scan. Both hex strings are 128 bits. A supporting device responds by unicast to the request's source IP and port:

```json
{"magic":"VOVKPLC_DEVICE","version":1,"session":"0123456789abcdef0123456789abcdef","id":1,"nonce":"fedcba9876543210fedcba9876543210","uid":"device-uid","port":19616,"info":"[VovkPLCRuntime,...]"}
```

The response IP is the TCP endpoint, `port` is its programming port, and `info` is the short PLC information response. The backend accepts only matching responses, validates their size and format, and deduplicates by UID and endpoint. Results are unverified; use Probe or Connect to check that the endpoint responds to the PLC protocol. UID characters are limited to letters, digits, `.`, `_`, `:` and `-`.

The Node VirtualPLC implements this responder, including bounded per-source rate limiting and a short-lived, bounded cache that rejects repeated or older IDs for a session. Multiple instances can share the discovery port and advertise different TCP ports. Devices with a custom discovery port require corresponding backend configuration; the editor currently scans port 19617 only.

## Security

Discovery and TCP programming are unauthenticated and unencrypted. Session IDs, sequence numbers and nonces correlate replies and reject some stale traffic, but do not prevent impersonation or replay by an observer; they are not authentication. Any reachable client can program or configure the VirtualPLC. Run it and the backend only on a trusted isolated network or behind an authenticated encrypted tunnel and firewall. Never expose them directly to the Internet.

## Firmware Support

The VirtualPLC supports discovery and a subset of the PLC TCP command protocol. The ESP32-C3 Wi-Fi example currently supports USB programming only; Wi-Fi connectivity alone does not provide either TCP programming or UDP discovery. Other devices need their own compatible TCP transport and discovery responder.