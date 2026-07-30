// Minimal FreeSWITCH Event Socket Library (ESL) client over a raw TCP socket, using the
// "inbound" connection mode to run a single `api originate` command.
// Docs: https://developer.signalwire.com/freeswitch/FreeSWITCH-Explained/Modules/mod_event_socket/

const net = require("net");

function originateCall({ host, port, password, toNumber, gateway, callerId }) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port: Number(port) || 8021 }, () => {});
    let buffer = "";
    let stage = "connecting"; // connecting -> authed -> done
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error("FreeSWITCH ESL connection timed out"));
    }, 10000);

    socket.on("data", (chunk) => {
      buffer += chunk.toString();

      if (stage === "connecting" && buffer.includes("auth/request")) {
        socket.write(`auth ${password}\n\n`);
        stage = "authing";
        buffer = "";
        return;
      }
      if (stage === "authing" && buffer.includes("Reply-Text: +OK")) {
        const origination = `originate {origination_caller_id_name='${callerId || "Tech-Life AI HR"}'}sofia/gateway/${gateway || "default"}/${toNumber} &park()`;
        socket.write(`api ${origination}\n\n`);
        stage = "originating";
        buffer = "";
        return;
      }
      if (stage === "originating") {
        clearTimeout(timeout);
        const success = /\+OK/.test(buffer) && !/-ERR/.test(buffer);
        socket.end();
        if (success) resolve({ ok: true, raw: buffer });
        else reject(new Error("FreeSWITCH rejected the originate command: " + buffer.slice(0, 300)));
      }
    });

    socket.on("error", (err) => { clearTimeout(timeout); reject(err); });
  });
}

function testLogin({ host, port, password }) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port: Number(port) || 8021 }, () => {});
    let buffer = "";
    let authSent = false;
    const timeout = setTimeout(() => { socket.destroy(); reject(new Error("Connection timed out")); }, 8000);

    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      if (!authSent && buffer.includes("auth/request")) {
        authSent = true;
        socket.write(`auth ${password}\n\n`);
        buffer = "";
        return;
      }
      if (authSent) {
        clearTimeout(timeout);
        socket.end();
        if (buffer.includes("Reply-Text: +OK")) resolve({ ok: true });
        else reject(new Error("FreeSWITCH rejected the ESL password"));
      }
    });
    socket.on("error", (err) => { clearTimeout(timeout); reject(err); });
  });
}

module.exports = { originateCall, testLogin };
