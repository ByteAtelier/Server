const dgram = require("dgram");

const sock = dgram.createSocket("udp4");

sock.on("listening", () => {
  const a = sock.address();
  console.log(`UDP listening on ${a.address}:${a.port}`);
});

sock.on("message", (msg, rinfo) => {
  console.log(
    `RECV ${rinfo.address}:${rinfo.port} ->`,
    msg.toString("hex"),
    msg.toString()
  );

  // 原样回显
  sock.send(msg, rinfo.port, rinfo.address);
});

sock.bind(25565, "0.0.0.0");