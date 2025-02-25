const WebSocket = require("ws");
const express = require("express");
const http = require("http");

const app = express();
const server = http.createServer(app); // Create an HTTP server
const wss = new WebSocket.Server({ server }); // Attach WebSocket to HTTP server

const PORT = process.env.PORT || 8080; // Use dynamic port for Render

// Add a basic HTTP route for Render to detect the server
app.get("/", (req, res) => {
  res.send("WebSocket server is running!");
});

let waitingPlayer = null;
const rooms = {};

wss.on("connection", (socket) => {
    console.log("New WebSocket connection established!");
    socket.on("message", (message) => {
        const data = JSON.parse(message);
        switch (data.type) {
            case "FIND_STRANGER": handleStrangerMatch(socket); break;
            case "CREATE_ROOM": handleCreateRoom(socket); break;
            case "JOIN_ROOM": handleJoinRoom(socket, data.roomId); break;
            case "MOVE": handleMove(socket, data.move); break;
        }
    });

    socket.on("close", () => handleDisconnect(socket));
});

// Start the server explicitly on 0.0.0.0
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});

// Rest of your functions remain unchanged
function handleStrangerMatch(socket) {
    if (!waitingPlayer) {
        waitingPlayer = socket;
        sendSafe(socket, { type: "WAITING_FOR_PLAYER" });
    } else {
        createRoom(waitingPlayer, socket);
        waitingPlayer = null;
    }
}

function createRoom(player1, player2) {
    const roomId = generateRoomId();
    rooms[roomId] = {
        player1, player2,
        p1Move: null, p2Move: null,
        p1Score: 0, p2Score: 0,
        rounds: 0
    };
    player1.room = roomId;
    player2.room = roomId;
    sendSafe(player1, { type: "MATCH_FOUND", roomId, player: "p1" });
    sendSafe(player2, { type: "MATCH_FOUND", roomId, player: "p2" });
}

function handleCreateRoom(socket) {
    const roomId = generateRoomId();
    rooms[roomId] = {
        player1: socket, player2: null,
        p1Move: null, p2Move: null,
        p1Score: 0, p2Score: 0,
        rounds: 0
    };
    socket.room = roomId;
    sendSafe(socket, { type: "ROOM_CREATED", roomId });
}

function handleJoinRoom(socket, roomId) {
    if (rooms[roomId] && !rooms[roomId].player2) {
        rooms[roomId].player2 = socket;
        socket.room = roomId;
        
        sendSafe(rooms[roomId].player1, { type: "MATCH_FOUND", roomId, player: "p1" });
        sendSafe(rooms[roomId].player2, { type: "MATCH_FOUND", roomId, player: "p2" });

        sendSafe(rooms[roomId].player1, { type: "ROUND_START", round: 1 });
        sendSafe(rooms[roomId].player2, { type: "ROUND_START", round: 1 });
    } else {
        sendSafe(socket, { type: "ROOM_INVALID" });
    }
}

function handleMove(socket, move) {
    if (!socket.room) return;
    const roomId = socket.room;
    const room = rooms[roomId];
    if (!room) return;

    if (socket === room.player1) {
        if (room.p1Move !== null) return;
        room.p1Move = move;
    } else if (socket === room.player2) {
        if (room.p2Move !== null) return;
        room.p2Move = move;
    }

    if (room.p1Move && room.p2Move) {
        checkRound(roomId);
    }
}

function checkRound(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    setTimeout(() => { 
        let winner = "draw";

        if ((room.p1Move === "rock" && room.p2Move === "scissors") ||
            (room.p1Move === "paper" && room.p2Move === "rock") ||
            (room.p1Move === "scissors" && room.p2Move === "paper")) {
            winner = "p1";
            room.p1Score++;
        } else if (room.p1Move !== room.p2Move) {
            winner = "p2";
            room.p2Score++;
        }

        sendSafe(room.player1, { type: "ROUND_RESULT", winner, p1Move: room.p1Move, p2Move: room.p2Move });
        sendSafe(room.player2, { type: "ROUND_RESULT", winner, p1Move: room.p2Move, p2Move: room.p1Move });

        sendSafe(room.player1, { type: "ROUND_END", round: room.rounds + 1 });
        sendSafe(room.player2, { type: "ROUND_END", round: room.rounds + 1 });

        room.p1Move = null;
        room.p2Move = null;
        room.rounds++;

        if (room.rounds >= 3) {
            const finalWinner = room.p1Score > room.p2Score ? "p1" :
                                room.p1Score < room.p2Score ? "p2" : "draw";
            sendSafe(room.player1, { type: "GAME_OVER", winner: finalWinner });
            sendSafe(room.player2, { type: "GAME_OVER", winner: finalWinner });
            delete rooms[roomId];
        }
    }, 1000);
}

function handleDisconnect(socket) {
    if (socket.room && rooms[socket.room]) {
        const room = rooms[socket.room];
        const opponent = room.player1 === socket ? room.player2 : room.player1;
        if (opponent) sendSafe(opponent, { type: "PLAYER_LEFT" });
        delete rooms[socket.room];
    }
}

function generateRoomId() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function sendSafe(socket, message) {
    if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(message));
    }
}