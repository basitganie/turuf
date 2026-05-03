import {
  Card, Suit, TrickCard,
  createDeck, shuffleDeck, dealCards,
  determineTrickWinner, rankValue, pickBestCard
} from "./gameLogic.js";
import { logger } from "./logger.js";

export interface PlayerProfile {
  id: string;
  name: string;
  wins: number;
  losses: number;
  kourts: number;
  teraanWins: number;
  teraanLosses: number;
  gamesPlayed: number;
}

export interface RoomPlayer {
  socketId: string;
  profile: PlayerProfile;
  seatIndex: number;
  isHost: boolean;
  isConnected: boolean;
}

export type GamePhase =
  | "waiting"
  | "splitting"
  | "trump_choice"
  | "playing"
  | "game_over";

export interface GameRoom {
  code: string;
  isPublic: boolean;
  players: RoomPlayer[];
  phase: GamePhase;
  deck: Card[];
  hands: Card[][];
  dealer: number;
  trumpChooser: number;
  trumpSuit: Suit | null;
  currentTrick: TrickCard[];
  trickWins: [number, number];
  currentLeader: number;
  currentPlayer: number;
  ledSuit: Suit | null;
  teraan: boolean;
  message: string;
  revealedCard: Card | null;
  lastTrickWinner: number | null;
  createdAt: number;
}

const rooms = new Map<string, GameRoom>();

function generateRoomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  do {
    code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  } while (rooms.has(code));
  return code;
}

export function createRoom(socketId: string, profile: PlayerProfile, isPublic = false): GameRoom {
  const code = generateRoomCode();
  const room: GameRoom = {
    code,
    isPublic,
    players: [{ socketId, profile, seatIndex: 0, isHost: true, isConnected: true }],
    phase: "waiting",
    deck: [],
    hands: [[], [], [], []],
    dealer: -1,
    trumpChooser: -1,
    trumpSuit: null,
    currentTrick: [],
    trickWins: [0, 0],
    currentLeader: -1,
    currentPlayer: -1,
    ledSuit: null,
    teraan: false,
    message: "",
    revealedCard: null,
    lastTrickWinner: null,
    createdAt: Date.now(),
  };
  rooms.set(code, room);
  return room;
}

export function joinRoom(code: string, socketId: string, profile: PlayerProfile): { room: GameRoom; seat: number } | null {
  const room = rooms.get(code);
  if (!room) return null;
  if (room.phase !== "waiting") return null;
  if (room.players.length >= 4) return null;

  const existingPlayer = room.players.find((p) => p.profile.id === profile.id);
  if (existingPlayer) {
    existingPlayer.socketId = socketId;
    existingPlayer.isConnected = true;
    return { room, seat: existingPlayer.seatIndex };
  }

  const seat = room.players.length;
  room.players.push({ socketId, profile, seatIndex: seat, isHost: false, isConnected: true });
  return { room, seat };
}

export function getRoom(code: string): GameRoom | undefined {
  return rooms.get(code);
}

export function getRoomBySocket(socketId: string): GameRoom | undefined {
  for (const room of rooms.values()) {
    if (room.players.some((p) => p.socketId === socketId)) return room;
  }
  return undefined;
}

export function disconnectPlayer(socketId: string): { room: GameRoom; player: RoomPlayer } | undefined {
  const room = getRoomBySocket(socketId);
  if (!room) return undefined;
  const player = room.players.find((p) => p.socketId === socketId);
  if (!player) return undefined;
  player.isConnected = false;
  if (room.phase === "waiting" && room.players.every((p) => !p.isConnected)) {
    rooms.delete(room.code);
  }
  return { room, player };
}

export function startGame(code: string): GameRoom | null {
  const room = rooms.get(code);
  if (!room || room.players.length < 4) return null;

  const deck = shuffleDeck(createDeck());
  const tempHands: Card[][] = [[], [], [], []];
  let deckRem = [...deck];

  for (let p = 0; p < 4; p++) {
    for (let i = 0; i < 4; i++) {
      tempHands[p].push(deckRem.shift()!);
    }
  }

  let highCard = tempHands[0][0];
  let dealer = 0;
  for (let p = 0; p < 4; p++) {
    for (const c of tempHands[p]) {
      if (rankValue(c.rank) > rankValue(highCard.rank)) {
        highCard = c;
        dealer = p;
      }
    }
  }

  const trumpChooser = (dealer + 1) % 4;

  room.deck = deckRem;
  room.hands = [[], [], [], []];
  room.dealer = dealer;
  room.trumpChooser = trumpChooser;
  room.trumpSuit = null;
  room.currentTrick = [];
  room.trickWins = [0, 0];
  room.currentLeader = -1;
  room.currentPlayer = -1;
  room.ledSuit = null;
  room.teraan = false;
  room.revealedCard = null;
  room.lastTrickWinner = null;
  room.phase = "splitting";
  room.message = `Player ${dealer} is Dealer. Player ${trumpChooser} is Trump Chooser.`;

  return room;
}

export function performSplit(code: string, position: number): GameRoom | null {
  const room = rooms.get(code);
  if (!room || room.phase !== "splitting") return null;

  const top = room.deck.slice(0, position);
  const bottom = room.deck.slice(position);
  const newDeck = [...bottom, ...top];

  const result = dealCards(newDeck, [[], [], [], []], 5, room.trumpChooser);
  room.deck = result.deck;
  room.hands = result.hands;
  room.phase = "trump_choice";
  room.message = "Trump Chooser: declare a suit or delay?";

  return room;
}

export function chooseTrump(code: string, suit: Suit): GameRoom | null {
  const room = rooms.get(code);
  if (!room || room.phase !== "trump_choice") return null;

  const r1 = dealCards(room.deck, room.hands, 4, room.trumpChooser);
  const r2 = dealCards(r1.deck, r1.hands, 4, room.trumpChooser);

  room.deck = r2.deck;
  room.hands = r2.hands;
  room.trumpSuit = suit;
  room.phase = "playing";
  room.currentLeader = room.trumpChooser;
  room.currentPlayer = room.trumpChooser;
  room.currentTrick = [];
  room.ledSuit = null;
  room.message = `Trump is ${suit.toUpperCase()}! Player ${room.trumpChooser} leads.`;

  return room;
}

export function delayTrump(code: string): GameRoom | null {
  const room = rooms.get(code);
  if (!room || room.phase !== "trump_choice") return null;

  const r1 = dealCards(room.deck, room.hands, 4, room.trumpChooser);
  const r2 = dealCards(r1.deck, r1.hands, 4, room.trumpChooser);

  const tcHand = r2.hands[room.trumpChooser];
  const nthIdx = Math.floor(tcHand.length / 2);
  const revealed = tcHand[nthIdx];

  room.deck = r2.deck;
  room.hands = r2.hands;
  room.trumpSuit = revealed.suit;
  room.revealedCard = revealed;
  room.phase = "playing";
  room.currentLeader = room.trumpChooser;
  room.currentPlayer = room.trumpChooser;
  room.currentTrick = [];
  room.ledSuit = null;
  room.message = `Trump revealed: ${revealed.suit.toUpperCase()}! Player ${room.trumpChooser} leads.`;

  return room;
}

export function playCard(code: string, playerIndex: number, card: Card): { room: GameRoom; trickComplete: boolean; winner?: number } | null {
  const room = rooms.get(code);
  if (!room || room.phase !== "playing") return null;
  if (room.currentPlayer !== playerIndex) return null;

  const hand = room.hands[playerIndex];
  const cardInHand = hand.find((c) => c.id === card.id);
  if (!cardInHand) return null;

  room.hands[playerIndex] = hand.filter((c) => c.id !== card.id);
  room.currentTrick.push({ card: cardInHand, playerIndex });

  if (room.currentTrick.length === 0) {
    room.ledSuit = cardInHand.suit;
  } else if (room.currentTrick.length === 1) {
    room.ledSuit = cardInHand.suit;
  }

  if (room.currentTrick.length === 1) {
    room.ledSuit = cardInHand.suit;
  }

  const nextPlayer = room.currentTrick.length < 4 ? (playerIndex + 1) % 4 : -1;
  room.currentPlayer = nextPlayer;

  if (room.currentTrick.length >= 4) {
    const winner = determineTrickWinner(room.currentTrick, room.trumpSuit);
    const winTeam = winner % 2;
    room.trickWins[0] += winTeam === 0 ? 1 : 0;
    room.trickWins[1] += winTeam === 1 ? 1 : 0;
    room.lastTrickWinner = winner;
    return { room, trickComplete: true, winner };
  }

  return { room, trickComplete: false };
}

export function resolveTrick(code: string, winner: number): {
  room: GameRoom;
  gameOver: boolean;
  winningTeam: number;
  result: string;
} | null {
  const room = rooms.get(code);
  if (!room) return null;

  const [w0, w1] = room.trickWins;
  const total = w0 + w1;
  let gameOver = false;
  let winningTeam = -1;
  let result = "";

  if (room.teraan) {
    if (winner % 2 !== room.trumpChooser % 2 || total === 13) {
      gameOver = true;
      if (winner % 2 === room.trumpChooser % 2 && total === 13 && w0 + w1 === 13) {
        winningTeam = room.trumpChooser % 2;
        result = "TERAAN! Trump Chooser's team won all 13 tricks!";
      } else {
        winningTeam = 1 - (room.trumpChooser % 2);
        result = "TERAAN for opponents! Trump Chooser's team lost a trick!";
      }
    }
  } else if (w0 >= 7) {
    gameOver = true;
    winningTeam = 0;
    result = w1 === 0 ? `KOURT! Team 1 wins 7-0!` : `Team 1 wins ${w0}-${w1}!`;
  } else if (w1 >= 7) {
    gameOver = true;
    winningTeam = 1;
    result = w0 === 0 ? `KOURT! Team 2 wins 7-0!` : `Team 2 wins ${w1}-${w0}!`;
  } else if (total === 13) {
    gameOver = true;
    winningTeam = w0 > w1 ? 0 : 1;
    result = `Team ${winningTeam + 1} wins ${Math.max(w0, w1)}-${Math.min(w0, w1)}!`;
  }

  if (gameOver) {
    room.phase = "game_over";
    room.message = result;
  } else {
    room.currentTrick = [];
    room.ledSuit = null;
    room.currentLeader = winner;
    room.currentPlayer = winner;
    room.message = `Player ${winner} (Team ${(winner % 2) + 1}) wins the trick! ${w0}-${w1}`;
  }

  return { room, gameOver, winningTeam, result };
}

export function declareTeraan(code: string): GameRoom | null {
  const room = rooms.get(code);
  if (!room || room.phase !== "playing") return null;
  if (room.trickWins[0] !== 0 || room.trickWins[1] !== 0) return null;
  room.teraan = true;
  room.message = "TERAAN declared! Win all 13 tricks or lose!";
  return room;
}

export function startNextGame(code: string): GameRoom | null {
  const room = rooms.get(code);
  if (!room || room.phase !== "game_over") return null;

  const tcTeam = room.trumpChooser % 2;
  const winTeam = room.trickWins[0] > room.trickWins[1] ? 0 : 1;
  const newTrumpChooser = winTeam === tcTeam ? room.trumpChooser : (room.trumpChooser + 2) % 4;

  const currentDeck = room.deck.length >= 20 ? room.deck : shuffleDeck(createDeck());

  room.deck = currentDeck;
  room.hands = [[], [], [], []];
  room.trumpChooser = newTrumpChooser;
  room.dealer = (newTrumpChooser + 3) % 4;
  room.trumpSuit = null;
  room.currentTrick = [];
  room.trickWins = [0, 0];
  room.currentLeader = -1;
  room.currentPlayer = -1;
  room.ledSuit = null;
  room.teraan = false;
  room.revealedCard = null;
  room.lastTrickWinner = null;
  room.phase = "splitting";
  room.message = `New game! Player ${newTrumpChooser} is Trump Chooser.`;

  return room;
}

export function getSafeRoom(room: GameRoom, forPlayerIndex?: number) {
  return {
    code: room.code,
    phase: room.phase,
    players: room.players.map((p) => ({
      name: p.profile.name,
      seatIndex: p.seatIndex,
      isHost: p.isHost,
      isConnected: p.isConnected,
      stats: {
        wins: p.profile.wins,
        losses: p.profile.losses,
        gamesPlayed: p.profile.gamesPlayed,
        kourts: p.profile.kourts,
      },
    })),
    dealer: room.dealer,
    trumpChooser: room.trumpChooser,
    trumpSuit: room.trumpSuit,
    currentTrick: room.currentTrick,
    trickWins: room.trickWins,
    currentLeader: room.currentLeader,
    currentPlayer: room.currentPlayer,
    ledSuit: room.ledSuit,
    teraan: room.teraan,
    message: room.message,
    revealedCard: room.revealedCard,
    lastTrickWinner: room.lastTrickWinner,
    hand: forPlayerIndex !== undefined ? room.hands[forPlayerIndex] : [],
    handCounts: room.hands.map((h) => h.length),
  };
}

export { rooms };
