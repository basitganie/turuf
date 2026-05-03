import { Router } from "express";
import { rooms } from "../lib/gameManager.js";

const router = Router();

router.get("/rooms", (_req, res) => {
  const publicRooms = [];
  const now = Date.now();

  for (const room of rooms.values()) {
    if (!room.isPublic) continue;
    if (room.phase !== "waiting") continue;
    if (room.players.length >= 4) continue;
    if (now - room.createdAt > 60 * 60 * 1000) continue;

    const host = room.players.find((p) => p.isHost);
    publicRooms.push({
      code: room.code,
      hostName: host?.profile.name ?? "Unknown",
      hostWins: host?.profile.wins ?? 0,
      hostGames: host?.profile.gamesPlayed ?? 0,
      playerCount: room.players.filter((p) => p.isConnected).length,
      players: room.players.map((p) => ({
        name: p.profile.name,
        wins: p.profile.wins,
        gamesPlayed: p.profile.gamesPlayed,
      })),
      createdAt: room.createdAt,
    });
  }

  publicRooms.sort((a, b) => b.createdAt - a.createdAt);
  res.json({ rooms: publicRooms });
});

export default router;
