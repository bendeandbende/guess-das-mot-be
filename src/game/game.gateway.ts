import {
  SubscribeMessage,
  WebSocketGateway,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

interface Player {
  id: string;
  name: string;
}

interface Game {
  id: string;
  players: Player[];
  drawer: Player;
  word: string;
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
      };
      this.games.set(gameId, game);
    }

    const player: Player = { id: client.id, name: playerName };
    game.players.push(player);

    if (!game.drawer) {
      game.drawer = player;
    }

    client.join(gameId);
    this.server.to(gameId).emit('gameUpdate', game);
  }

  @SubscribeMessage('startDrawing')
  handleStartDrawing(
    client: Socket,
    payload: { gameId: string; word: string },
  ) {
    console.log('START');
    const game = this.games.get(payload.gameId);
    if (game && game.drawer.id === client.id) {
      game.word = payload.word;
      this.server
        .to(payload.gameId)
        .emit('drawingStarted', { word: game.word });
    }
  }

  @SubscribeMessage('guessWord')
  handleGuessWord(client: Socket, payload: { gameId: string; guess: string }) {
    const game = this.games.get(payload.gameId);
    if (game && game.word === payload.guess) {
      this.server
        .to(payload.gameId)
        .emit('correctGuess', { playerId: client.id, guess: payload.guess });
    } else {
      this.server
        .to(payload.gameId)
        .emit('incorrectGuess', { playerId: client.id, guess: payload.guess });
    }
  }

  @SubscribeMessage('drawingData')
  handleDrawingData(client: Socket, payload: { gameId: string; data: any }) {
    console.log('DRAWING');
    this.server.to(payload.gameId).emit('drawingData', payload);
  }

  private removePlayerFromGame(playerId: string) {
    for (const [gameId, game] of this.games.entries()) {
      const playerIndex = game.players.findIndex(
        (player) => player.id === playerId,
      );
      if (playerIndex !== -1) {
        game.players.splice(playerIndex, 1);
        if (game.players.length === 0) {
          this.games.delete(gameId);
        } else {
          if (game.drawer.id === playerId) {
            game.drawer = game.players[0];
          }
          this.server.to(gameId).emit('gameUpdate', game);
        }
        break;
      }
    }
  }
}
