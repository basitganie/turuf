import { createServer } from "http";
import { networkInterfaces } from "os";
import { Server as SocketIOServer } from "socket.io";
import app from "./app.js";
import { logger } from "./lib/logger.js";
import { setupSocketIO } from "./lib/socketHandler.js";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

function getLocalIPs(): string[] {
  const nets = networkInterfaces();
  const results: string[] = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family === "IPv4" && !net.internal) {
        results.push(net.address);
      }
    }
  }
  return results;
}

const httpServer = createServer(app);

const io = new SocketIOServer(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
  path: "/api/socket.io",
});

setupSocketIO(io);

httpServer.listen(port, "0.0.0.0", () => {
  const ips = getLocalIPs();

  logger.info({ port }, "Server listening with Socket.IO");

  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║          TURUF GAME SERVER  ♠ ♥ ♦ ♣              ║");
  console.log("╠══════════════════════════════════════════════════╣");
  console.log(`║  Port   : ${String(port).padEnd(39)}║`);

  if (ips.length === 0) {
    console.log("║  IP     : No network interfaces found             ║");
  } else {
    for (const ip of ips) {
      const line = `http://${ip}:${port}`;
      console.log(`║  ▶  ${line.padEnd(45)}║`);
    }
  }

  console.log("╠══════════════════════════════════════════════════╣");
  console.log("║  Share the ▶ address above with friends on the   ║");
  console.log("║  same WiFi Hotspot to play Turuf together!        ║");
  console.log("╚══════════════════════════════════════════════════╝\n");
});
