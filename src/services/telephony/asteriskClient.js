// Minimal Asterisk Manager Interface (AMI) client over a raw TCP socket.
// AMI is a simple line-based text protocol (key: value pairs, blocks separated by a
// blank line), so no external dependency is needed to speak it.
// Docs: https://docs.asterisk.org/Asterisk_20_Documentation/API_Documentation/AMI_Actions/Originate/

const net = require("net");

function originateCall({ host, port, username, secret, context, toNumber, callerId, variables = {} }) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port: Number(port) || 5038 }, () => {});
    let buffer = "";
    let loggedIn = false;
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error("Asterisk AMI connection timed out"));
    }, 10000);

    function send(action) {
      const lines = Object.entries(action).map(([k, v]) => `${k}: ${v}`);
      socket.write(lines.join("\r\n") + "\r\n\r\n");
    }

    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      if (!loggedIn && /Response: Success/.test(buffer) && /Message: Authentication accepted/.test(buffer)) {
        loggedIn = true;
        send({
          Action: "Originate",
          Channel: `SIP/${toNumber}@${context || "trunk"}`,
          Context: context || "from-internal",
          Exten: toNumber,
          Priority: 1,
          CallerID: callerId || "Tech-Life AI HR",
          Timeout: 30000,
          Async: "true",
          ...Object.fromEntries(Object.entries(variables).map(([k, v]) => [`Variable`, `${k}=${v}`])),
        });
      } else if (loggedIn && /Response: (Success|Error)/.test(buffer)) {
        clearTimeout(timeout);
        const success = /Response: Success/.test(buffer);
        send({ Action: "Logoff" });
        socket.end();
        if (success) resolve({ ok: true, raw: buffer });
        else reject(new Error("Asterisk rejected the Originate action: " + buffer.slice(0, 300)));
      }
    });

    socket.on("error", (err) => { clearTimeout(timeout); reject(err); });
    socket.on("connect", () => {
      send({ Action: "Login", Username: username, Secret: secret });
    });
  });
}

function testLogin({ host, port, username, secret }) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port: Number(port) || 5038 }, () => {});
    let buffer = "";
    const timeout = setTimeout(() => { socket.destroy(); reject(new Error("Connection timed out")); }, 8000);

    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      if (/Response: Success/.test(buffer) && /Message: Authentication accepted/.test(buffer)) {
        clearTimeout(timeout);
        socket.write("Action: Logoff\r\n\r\n");
        socket.end();
        resolve({ ok: true });
      } else if (/Response: Error/.test(buffer)) {
        clearTimeout(timeout);
        socket.destroy();
        reject(new Error("Authentication rejected by Asterisk: " + buffer.slice(0, 200)));
      }
    });
    socket.on("error", (err) => { clearTimeout(timeout); reject(err); });
    socket.on("connect", () => socket.write(`Action: Login\r\nUsername: ${username}\r\nSecret: ${secret}\r\n\r\n`));
  });
}

module.exports = { originateCall, testLogin };
