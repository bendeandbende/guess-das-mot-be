import {
  SubscribeMessage,
  WebSocketGateway,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

const PREPARATION_TIME_MS = 5000;
const DRAWING_TIME_MS = 10000; // FOR TESTING
interface Player {
  id: string;
  name: string;
}

interface Game {
  id: string;
  players: Player[];
  drawer: Player | null;
  word: string;
  status: 'INACTIVE' | 'ACTIVE' | 'PREPARING' | 'DRAWING' | 'FINISHED';
  round: number;
  drawingQueue: Player[];
}

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class GameGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer() server: Server;
  private games: Map<string, Game> = new Map();
  private drawingTimers: Map<string, NodeJS.Timeout> = new Map();

  afterInit() {
    console.log('WebSocket server initialized');
  }

  handleConnection(client: Socket) {
    console.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    console.log(`Client disconnected: ${client.id}`);
    this.removePlayerFromGame(client.id);
  }

  @SubscribeMessage('joinGame')
  handleJoinGame(
    client: Socket,
    payload: { gameId: string; playerName: string },
  ) {
    const { gameId, playerName } = payload;
    let game = this.games.get(gameId);

    if (!game) {
      game = {
        id: gameId,
        players: [],
        drawer: null,
        word: '',
        status: 'INACTIVE',
        round: 0,
        drawingQueue: [],
      };
      this.games.set(gameId, game);
    }

    const player: Player = { id: client.id, name: playerName };
    game.players.push(player);

    client.join(gameId);
    this.server.to(gameId).emit('gameUpdate', game);
  }

  @SubscribeMessage('startGame')
  handleStartGame(client: Socket, payload: { gameId: string }) {
    const game = this.games.get(payload.gameId);
    if (game && game.players[0].id === client.id) {
      game.status = 'ACTIVE';
      game.round = 1;
      game.drawingQueue = [...game.players];
      this.startDrawingRound(game);
    }
  }

  @SubscribeMessage('startDrawing')
  handleStartDrawing(
    client: Socket,
    payload: { gameId: string; word: string },
  ) {
    const game = this.games.get(payload.gameId);
    if (game && game.drawer && game.drawer.id === client.id) {
      game.word = payload.word;
      game.status = 'DRAWING';
      this.server.to(payload.gameId).emit('gameUpdate', game);
      this.server
        .to(payload.gameId)
        .emit('drawingStarted', { word: game.word });
      this.startDrawingTimer(game);
    }
  }

  @SubscribeMessage('guessWord')
  handleGuessWord(client: Socket, payload: { gameId: string; guess: string }) {
    const game = this.games.get(payload.gameId);
    if (game) {
      this.server
        .to(payload.gameId)
        .emit('guess', { playerId: client.id, guess: payload.guess });
      if (game.word === payload.guess) {
        this.server
          .to(payload.gameId)
          .emit('correctGuess', { playerId: client.id, guess: payload.guess });
      }
    }
  }

  @SubscribeMessage('drawingData')
  handleDrawingData(client: Socket, payload: { gameId: string; data: any }) {
    this.server.to(payload.gameId).emit('drawingData', payload);
  }

  private startDrawingRound(game: Game) {
    if (game.round > 3) {
      game.status = 'FINISHED';
      this.server.to(game.id).emit('gameUpdate', game);
      return;
    }

    if (game.drawingQueue.length === 0) {
      game.round++;
      if (game.round > 3) {
        game.status = 'FINISHED';
        this.server.to(game.id).emit('gameUpdate', game);
        return;
      }
      game.drawingQueue = [...game.players];
    }

    game.drawer = game.drawingQueue.shift() || null;
    game.status = 'PREPARING';
    this.server.to(game.id).emit('gameUpdate', game);
  }

  private startDrawingTimer(game: Game) {
    const timer = setTimeout(() => {
      this.endDrawingRound(game);
    }, DRAWING_TIME_MS);

    this.drawingTimers.set(game.id, timer);
  }

  private endDrawingRound(game: Game) {
    this.drawingTimers.delete(game.id);
    game.word = '';
    game.status = 'PREPARING';
    game.drawer = null;
    this.server.to(game.id).emit('gameUpdate', game);

    setTimeout(() => {
      this.startDrawingRound(game);
    }, PREPARATION_TIME_MS);
  }

  private removePlayerFromGame(playerId: string) {
    for (const [gameId, game] of this.games.entries()) {
      const playerIndex = game.players.findIndex(
        (player) => player.id === playerId,
      );
      if (playerIndex !== -1) {
        game.players.splice(playerIndex, 1);
        game.drawingQueue = game.drawingQueue.filter(
          (player) => player.id !== playerId,
        );
        if (game.players.length === 0) {
          this.games.delete(gameId);
        } else {
          if (game.drawer && game.drawer.id === playerId) {
            clearTimeout(this.drawingTimers.get(gameId));
            this.drawingTimers.delete(gameId);
            this.endDrawingRound(game);
          }
          this.server.to(gameId).emit('gameUpdate', game);
        }
        break;
      }
    }
  }
}
