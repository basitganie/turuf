export type Suit = "clubs" | "spades" | "diamonds" | "hearts";
export type Rank =
  | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10"
  | "J" | "Q" | "K" | "A";

export interface Card {
  suit: Suit;
  rank: Rank;
  id: string;
}

export interface TrickCard {
  card: Card;
  playerIndex: number;
}

const RANK_ORDER: Rank[] = ["2","3","4","5","6","7","8","9","10","J","Q","K","A"];

export function rankValue(rank: Rank): number {
  return RANK_ORDER.indexOf(rank);
}

export function createDeck(): Card[] {
  const suits: Suit[] = ["clubs", "spades", "diamonds", "hearts"];
  const ranks: Rank[] = ["2","3","4","5","6","7","8","9","10","J","Q","K","A"];
  const deck: Card[] = [];
  for (const suit of suits) {
    for (const rank of ranks) {
      deck.push({ suit, rank, id: `${suit}_${rank}` });
    }
  }
  return deck;
}

export function shuffleDeck(deck: Card[]): Card[] {
  const d = [...deck];
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

export function dealCards(
  deck: Card[],
  currentHands: Card[][],
  count: number,
  tc: number
): { hands: Card[][]; deck: Card[] } {
  const newHands = currentHands.map((h) => [...h]);
  const deckCopy = [...deck];
  const order = [tc, (tc + 2) % 4, (tc + 1) % 4, (tc + 3) % 4];
  for (let i = 0; i < count; i++) {
    for (const p of order) {
      if (deckCopy.length > 0) newHands[p].push(deckCopy.shift()!);
    }
  }
  return { hands: newHands, deck: deckCopy };
}

export function determineTrickWinner(trick: TrickCard[], trumpSuit: Suit | null): number {
  const led = trick[0].card.suit;
  let winner = trick[0];
  for (let i = 1; i < trick.length; i++) {
    const c = trick[i];
    const winIsTrump = trumpSuit ? winner.card.suit === trumpSuit : false;
    const cIsTrump = trumpSuit ? c.card.suit === trumpSuit : false;
    if (winIsTrump && cIsTrump) {
      if (rankValue(c.card.rank) > rankValue(winner.card.rank)) winner = c;
    } else if (cIsTrump && !winIsTrump) {
      winner = c;
    } else if (!winIsTrump && c.card.suit === led) {
      if (rankValue(c.card.rank) > rankValue(winner.card.rank)) winner = c;
    }
  }
  return winner.playerIndex;
}

export function pickBestCard(hand: Card[], ledSuit: Suit | null, trumpSuit: Suit | null): Card {
  if (!ledSuit) {
    const trumpCards = trumpSuit ? hand.filter((c) => c.suit === trumpSuit) : [];
    if (trumpCards.length > 0 && Math.random() < 0.35) {
      return trumpCards.sort((a, b) => rankValue(b.rank) - rankValue(a.rank))[0];
    }
    const nonTrump = trumpSuit ? hand.filter((c) => c.suit !== trumpSuit) : hand;
    const pool = nonTrump.length > 0 ? nonTrump : hand;
    return pool.sort((a, b) => rankValue(b.rank) - rankValue(a.rank))[0];
  }
  const ledCards = hand.filter((c) => c.suit === ledSuit);
  if (ledCards.length > 0) {
    return ledCards.sort((a, b) => rankValue(b.rank) - rankValue(a.rank))[0];
  }
  const trumpCards = trumpSuit ? hand.filter((c) => c.suit === trumpSuit) : [];
  if (trumpCards.length > 0) {
    return trumpCards.sort((a, b) => rankValue(a.rank) - rankValue(b.rank))[0];
  }
  return hand.sort((a, b) => rankValue(a.rank) - rankValue(b.rank))[0];
}

export function canPlayCard(card: Card, hand: Card[], ledSuit: Suit | null): boolean {
  if (!ledSuit) return true;
  const hasLedSuit = hand.some((c) => c.suit === ledSuit);
  if (hasLedSuit) return card.suit === ledSuit;
  return true;
}
