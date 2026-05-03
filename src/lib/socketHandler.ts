import { Server as SocketIOServer, Socket } from "socket.io";
import { logger } from "./logger.js";
import {
  createRoom, joinRoom, getRoom, getRoomBySocket,
  disconnectPlayer, startGame, performSplit, chooseTrump,
  delayTrump, playCard, resolveTrick, declareTeraan, startNextGame,
  getSafeRoom, rooms,
  type PlayerProfile,
} from "./gameManager.js";
import type { Suit, Card } from "./gameLogic.js";

function broadcastPublicRooms(io: SocketIOServer) {
  const now = Date.now();
  const publicRooms = [];
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
      players: room.players.map((p) => ({ name: p.profile.name, wins: p.profile.wins, gamesPlayed: p.profile.gamesPlayed })),
      createdAt: room.createdAt,
    });
  }
  io.to("global_lobby").emit("rooms_updated", publicRooms.sort((a, b) => b.createdAt - a.createdAt));
}

export function setupSocketIO(io: SocketIOServer) {
  io.on("connection", (socket: Socket) => {
    logger.info({ socketId: socket.id }, "Client connected");

    socket.on("join_global_lobby", () => {
      socket.join("global_lobby");
      broadcastPublicRooms(io);
    });

    socket.on("leave_global_lobby", () => {
      socket.leave("global_lobby");
    });

    socket.on("create_room", (data: { profile: PlayerProfile; isPublic?: boolean } | PlayerProfile, callback: (data: { code: string; seat: number }) => void) => {
      const profile = "name" in data && !("profile" in data) ? data as PlayerProfile : (data as { profile: PlayerProfile; isPublic?: boolean }).profile;
      const isPublic = (data as { isPublic?: boolean }).isPublic ?? false;
      const room = createRoom(socket.id, profile, isPublic);
      socket.join(room.code);
      logger.info({ code: room.code, player: profile.name, isPublic }, "Room created");
      callback({ code: room.code, seat: 0 });
      io.to(room.code).emit("room_update", getSafeRoom(room, 0));
      if (isPublic) broadcastPublicRooms(io);
    });

    socket.on("join_room", (data: { code: string; profile: PlayerProfile }, callback: (data: { success: boolean; seat?: number; error?: string }) => void) => {
      const result = joinRoom(data.code, socket.id, data.profile);
      if (!result) {
        callback({ success: false, error: "Room not found, full, or game already started." });
        return;
      }
      const { room, seat } = result;
      socket.join(room.code);
      logger.info({ code: room.code, player: data.profile.name, seat }, "Player joined room");
      callback({ success: true, seat });
      room.players.forEach((p) => {
        io.to(p.socketId).emit("room_update", getSafeRoom(room, p.seatIndex));
      });
      if (room.isPublic) broadcastPublicRooms(io);
    });

    socket.on("start_game", (code: string) => {
      const room = getRoom(code);
      if (!room) return;
      const hostPlayer = room.players.find((p) => p.socketId === socket.id);
      if (!hostPlayer?.isHost) return;
      if (room.players.length < 4) {
        socket.emit("error_msg", "Need 4 players to start.");
        return;
      }
      const started = startGame(code);
      if (!started) return;
      logger.info({ code, dealer: started.dealer, trumpChooser: started.trumpChooser }, "Game started");
      started.players.forEach((p) => {
        io.to(p.socketId).emit("game_state", getSafeRoom(started, p.seatIndex));
      });
      broadcastPublicRooms(io);
    });

    socket.on("split_deck", (data: { code: string; position: number }) => {
      const room = getRoom(data.code);
      if (!room) return;
      const player = room.players.find((p) => p.socketId === socket.id);
      if (!player || player.seatIndex !== room.trumpChooser) return;
      const updated = performSplit(data.code, data.position);
      if (!updated) return;
      updated.players.forEach((p) => {
        io.to(p.socketId).emit("game_state", getSafeRoom(updated, p.seatIndex));
      });
    });

    socket.on("choose_trump", (data: { code: string; suit: Suit }) => {
      const room = getRoom(data.code);
      if (!room) return;
      const player = room.players.find((p) => p.socketId === socket.id);
      if (!player || player.seatIndex !== room.trumpChooser) return;
      const updated = chooseTrump(data.code, data.suit);
      if (!updated) return;
      updated.players.forEach((p) => {
        io.to(p.socketId).emit("game_state", getSafeRoom(updated, p.seatIndex));
      });
    });

    socket.on("delay_trump", (code: string) => {
      const room = getRoom(code);
      if (!room) return;
      const player = room.players.find((p) => p.socketId === socket.id);
      if (!player || player.seatIndex !== room.trumpChooser) return;
      const updated = delayTrump(code);
      if (!updated) return;
      updated.players.forEach((p) => {
        io.to(p.socketId).emit("game_state", getSafeRoom(updated, p.seatIndex));
      });
    });

    socket.on("play_card", (data: { code: string; card: Card }) => {
      const room = getRoom(data.code);
      if (!room) return;
      const player = room.players.find((p) => p.socketId === socket.id);
      if (!player) return;
      const result = playCard(data.code, player.seatIndex, data.card);
      if (!result) return;
      const { room: updatedRoom, trickComplete, winner } = result;
      updatedRoom.players.forEach((p) => {
        io.to(p.socketId).emit("game_state", getSafeRoom(updatedRoom, p.seatIndex));
      });
      if (trickComplete && winner !== undefined) {
        setTimeout(() => {
          const resolved = resolveTrick(data.code, winner);
          if (!resolved) return;
          const { room: resolvedRoom, gameOver, winningTeam, result: resultMsg } = resolved;
          resolvedRoom.players.forEach((p) => {
            io.to(p.socketId).emit("game_state", getSafeRoom(resolvedRoom, p.seatIndex));
          });
          if (gameOver) {
            io.to(data.code).emit("game_over", { winningTeam, result: resultMsg });
          }
        }, 1500);
      }
    });

    socket.on("declare_teraan", (code: string) => {
      const room = getRoom(code);
      if (!room) return;
      const player = room.players.find((p) => p.socketId === socket.id);
      if (!player || player.seatIndex !== room.trumpChooser) return;
      const updated = declareTeraan(code);
      if (!updated) return;
      updated.players.forEach((p) => {
        io.to(p.socketId).emit("game_state", getSafeRoom(updated, p.seatIndex));
      });
    });

    socket.on("next_game", (code: string) => {
      const room = getRoom(code);
      if (!room) return;
      const player = room.players.find((p) => p.socketId === socket.id);
      if (!player?.isHost) return;
      const updated = startNextGame(code);
      if (!updated) return;
      updated.players.forEach((p) => {
        io.to(p.socketId).emit("game_state", getSafeRoom(updated, p.seatIndex));
      });
    });

    socket.on("disconnect", () => {
      logger.info({ socketId: socket.id }, "Client disconnected");
      const result = disconnectPlayer(socket.id);
      if (result) {
        const { room } = result;
        if (room.phase !== "game_over") {
          io.to(room.code).emit("player_disconnected", {
            name: result.player.profile.name,
            seat: result.player.seatIndex,
          });
        }
        room.players.forEach((p) => {
          if (p.isConnected) {
            io.to(p.socketId).emit("room_update", getSafeRoom(room, p.seatIndex));
          }
        });
        if (room.isPublic) broadcastPublicRooms(io);
      }
    });
  });
}
